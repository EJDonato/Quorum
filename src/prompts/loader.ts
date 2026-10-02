import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Outcome } from "../contracts/errors.js";
import { canonicalDigest } from "../infrastructure/artifacts/digests.js";
import {
  CANONICAL_PROMPT_TEMPLATES,
  type PromptTemplateName,
} from "./defaults.js";

export type RolePhaseInput = {
  role: "planner" | "architect" | "security" | "qa" | "developer" | "refactor";
  phase:
    | "planning"
    | "architecture"
    | "design"
    | "test_authoring"
    | "implementation"
    | "final";
};

export interface LoadPromptOptions {
  customDir?: string;
  readFileFn?: (path: string) => Promise<string>;
}

export interface SystemPromptContext {
  taskId?: string | null;
  responseSchemaRef?: string;
  grants?: {
    tools?: string[];
    readPaths?: string[];
    writePaths?: string[];
  };
  instructions?: string;
}

export function resolveTemplateKey(input: RolePhaseInput): PromptTemplateName {
  if (input.role === "planner") return "planner";
  if (input.role === "architect") return "architect";
  if (input.role === "security") return "security";
  if (input.role === "developer") return "developer";
  if (input.role === "refactor") return "refactor";
  if (input.role === "qa") {
    return input.phase === "test_authoring" ? "qa-author" : "qa-review";
  }
  throw new Error(
    `Unknown role/phase combination: ${String(input.role)} / ${String(input.phase)}`,
  );
}

export async function loadTemplate(
  name: PromptTemplateName,
  options: LoadPromptOptions = {},
): Promise<string> {
  if (!options.customDir) {
    return CANONICAL_PROMPT_TEMPLATES[name];
  }
  const read = options.readFileFn ?? ((p: string) => readFile(p, "utf8"));
  const filePath = join(options.customDir, `${name}.md`);
  try {
    const content = await read(filePath);
    return content.trim();
  } catch {
    return CANONICAL_PROMPT_TEMPLATES[name];
  }
}

export async function loadRolePrompt(
  input: RolePhaseInput,
  options: LoadPromptOptions = {},
): Promise<string> {
  const key = resolveTemplateKey(input);
  return loadTemplate(key, options);
}

function formatContextLines(context: SystemPromptContext): string[] {
  const lines: string[] = [];
  if (context.taskId) lines.push(`Assigned Task: ${context.taskId}`);
  if (context.responseSchemaRef) {
    lines.push(`Response Schema: ${context.responseSchemaRef}`);
  }
  if (context.grants?.tools && context.grants.tools.length > 0) {
    lines.push(`Granted Tools: ${context.grants.tools.join(", ")}`);
  }
  if (context.grants?.readPaths && context.grants.readPaths.length > 0) {
    lines.push(`Readable Paths: ${context.grants.readPaths.join(", ")}`);
  }
  if (context.grants?.writePaths && context.grants.writePaths.length > 0) {
    lines.push(`Writable Paths: ${context.grants.writePaths.join(", ")}`);
  }
  if (context.instructions) {
    lines.push(`Instructions:\n${context.instructions}`);
  }
  return lines;
}

export async function buildSystemPrompt(
  input: RolePhaseInput,
  context?: SystemPromptContext,
  options?: LoadPromptOptions,
): Promise<string> {
  const preamble = await loadTemplate("preamble", options);
  const rolePrompt = await loadRolePrompt(input, options);
  const sections: string[] = [preamble, rolePrompt];

  if (context) {
    const lines = formatContextLines(context);
    if (lines.length > 0) sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}

export function computePersonaDigest(
  templates: Record<PromptTemplateName, string> = CANONICAL_PROMPT_TEMPLATES,
): Outcome<string> {
  return canonicalDigest(templates);
}
