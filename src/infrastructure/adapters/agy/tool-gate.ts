import { z } from "zod";
import { open, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { failure, type Outcome } from "../../../contracts/errors.js";

export const preToolUsePayloadSchema = z
  .object({
    toolCall: z.object({
      name: z.string().min(1).max(256),
      args: z.record(z.string(), z.unknown()).default({}),
    }),
    stepIdx: z.number().int().nonnegative().optional(),
    conversationId: z.string().optional(),
  })
  .passthrough();

export type PreToolUsePayload = z.infer<typeof preToolUsePayloadSchema>;

export const toolGateDecisionSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("allow"),
  }),
  z.strictObject({
    decision: z.literal("deny"),
    reason: z.string().min(1).max(1024),
  }),
]);

export type ToolGateDecision = z.infer<typeof toolGateDecisionSchema>;

export const DEFAULT_BROKER_TOOLS = Object.freeze(
  new Set([
    "repo.read",
    "repo.search",
    "artifact.read",
    "draft.apply_patch",
    "checks.run",
    "role.submit",
    "scope.request",
  ]),
);

export function evaluateAgyToolGate(
  input: unknown,
  allowedTools: ReadonlySet<string> = DEFAULT_BROKER_TOOLS,
): ToolGateDecision {
  const parsed = preToolUsePayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      decision: "deny",
      reason: "Malformed PreToolUse hook payload received by Quorum tool gate.",
    };
  }
  const toolName = parsed.data.toolCall.name;
  if (!allowedTools.has(toolName)) {
    return {
      decision: "deny",
      reason: `Unauthorized tool '${toolName}'. Quorum enforces broker-only tools.`,
    };
  }
  return { decision: "allow" };
}

export function generateAgyHooksConfig(
  hookCommand: string,
  timeoutSeconds = 5,
): Record<string, unknown> {
  return {
    "quorum-broker-gate": {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: hookCommand,
              timeout: timeoutSeconds,
            },
          ],
        },
      ],
    },
  };
}

export async function installAgyToolGateHooks(
  workspaceDir: string,
  hookCommand: string,
  timeoutSeconds = 5,
): Promise<Outcome<string>> {
  try {
    const agentsDir = join(workspaceDir, ".agents");
    await mkdir(agentsDir, { recursive: true, mode: 0o700 });
    const hooksPath = join(agentsDir, "hooks.json");
    const tempPath = join(agentsDir, `hooks.${Date.now()}.tmp`);
    const config = generateAgyHooksConfig(hookCommand, timeoutSeconds);
    const content = JSON.stringify(config, null, 2) + "\n";
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, hooksPath);
    return { ok: true, value: hooksPath };
  } catch (error) {
    return failure(
      "STORAGE_FAILED",
      `Failed to write Antigravity hooks.json: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export async function runAgyToolGateCli(
  stdin: NodeJS.ReadableStream = process.stdin,
  stdout: NodeJS.WritableStream = process.stdout,
  allowedTools: ReadonlySet<string> = DEFAULT_BROKER_TOOLS,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  let payload: unknown;
  try {
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    payload = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  const decision = evaluateAgyToolGate(payload, allowedTools);
  stdout.write(JSON.stringify(decision) + "\n");
}
