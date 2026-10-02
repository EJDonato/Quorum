import { z } from "zod";
import type {
  DirectPromptProgressReporter,
  DirectPromptRequest,
} from "../../application/direct-prompt.js";
import type { Outcome } from "../../contracts/errors.js";
import type { ProcessRunOptions, ProcessRunResult } from "../process/runner.js";

export type DirectPromptProcess = (
  options: ProcessRunOptions,
) => Promise<Outcome<ProcessRunResult>>;

export const codexEventSchema = z.object({
  type: z.string(),
  thread_id: z.string().optional(),
  item: z
    .object({
      type: z.string(),
      text: z.string().optional(),
      command: z.string().optional(),
    })
    .optional(),
});

interface CompletionOptions {
  request: DirectPromptRequest;
  process: DirectPromptProcess;
  signal?: AbortSignal;
  onProgress?: DirectPromptProgressReporter;
}

export async function runDirectCompletion(
  options: CompletionOptions,
): Promise<Outcome<ProcessRunResult>> {
  const { request, process, signal, onProgress } = options;
  let lastActivityAt = Date.now();
  const startedAt = lastActivityAt;
  const report = (message: string, phase: "working" | "tool" = "working") => {
    lastActivityAt = Date.now();
    onProgress?.({ phase, message });
  };
  const heartbeat = setInterval(() => {
    if (Date.now() - lastActivityAt < 15_000) return;
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1_000));
    report(`Still working (${elapsed}s elapsed).`);
  }, 5_000);
  heartbeat.unref();
  try {
    return await process({
      executable: request.executable,
      args: directPromptArgs(request),
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      maxOutputBytes: 1_048_576,
      ...(request.runner === "codex"
        ? { onStdoutLine: (line: string) => reportCodexLine(line, report) }
        : {}),
      ...(signal ? { signal } : {}),
    });
  } finally {
    clearInterval(heartbeat);
  }
}

export function directPromptArgs(request: DirectPromptRequest): string[] {
  if (request.runner === "agy") {
    const sessionArgs = request.conversationId
      ? ["--conversation", request.conversationId]
      : [];
    return [
      "--sandbox",
      "--mode",
      "plan",
      "--model",
      request.model,
      "--print-timeout",
      `${Math.ceil(request.timeoutMs / 1_000)}s`,
      "--output-format",
      "json",
      ...sessionArgs,
      "--print",
      request.prompt,
    ];
  }
  if (request.conversationId)
    return [
      "exec",
      "resume",
      "--model",
      request.model,
      "-c",
      'sandbox_mode="read-only"',
      "--skip-git-repo-check",
      "--json",
      request.conversationId,
      request.prompt,
    ];
  return [
    "exec",
    "--model",
    request.model,
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--json",
    request.prompt,
  ];
}

function reportCodexLine(
  line: string,
  report: (message: string, phase?: "working" | "tool") => void,
): void {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    return;
  }
  const event = codexEventSchema.safeParse(value);
  if (!event.success) return;
  if (event.data.type === "thread.started") report("Runner session started.");
  if (event.data.type === "turn.started") report("Analyzing the request.");
  if (event.data.type !== "item.started" || !event.data.item) return;
  const item = event.data.item;
  if (item.type === "reasoning") report("Planning the next step.");
  if (item.type === "command_execution")
    report(describeReadOnlyCommand(item.command), "tool");
  if (item.type === "web_search") report("Searching the web.", "tool");
  if (item.type === "mcp_tool_call") report("Using a connected tool.", "tool");
}

function describeReadOnlyCommand(command?: string): string {
  if (!command) return "Running a read-only command.";
  const normalized = command.replace(/[\u0000-\u001f\u007f]/gu, " ");
  const paths = extractDisplayPaths(normalized);
  const detail = paths.length ? `: ${paths.join(", ")}` : ".";
  if (/\b(?:rg|grep|find)\b/u.test(normalized))
    return `Searching repository${detail}`;
  if (/\b(?:cat|head|tail|sed)\b/u.test(normalized))
    return `Reading files${detail}`;
  if (/\bgit\b/u.test(normalized)) return `Inspecting Git state${detail}`;
  if (/\b(?:ls|tree)\b/u.test(normalized)) return `Listing files${detail}`;
  return "Running a read-only command.";
}

function extractDisplayPaths(command: string): string[] {
  const matches = command.matchAll(
    /["']?((?:\.?\.?\/|\/)?(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:c|css|go|html|java|js|json|jsx|md|mjs|py|rs|sh|ts|tsx|txt|yaml|yml))["']?/gu,
  );
  const paths = [...matches]
    .map((match) => match[1])
    .filter((path): path is string => Boolean(path));
  return [...new Set(paths)].slice(0, 3);
}
