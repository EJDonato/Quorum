import { z } from "zod";
import type {
  DirectPromptPort,
  DirectPromptRequest,
  DirectPromptResponse,
} from "../../application/direct-prompt.js";
import { failure, type Outcome } from "../../contracts/errors.js";
import {
  runProcess,
  type ProcessRunOptions,
  type ProcessRunResult,
} from "../process/runner.js";

type ProcessPort = (
  options: ProcessRunOptions,
) => Promise<Outcome<ProcessRunResult>>;

const agyResultSchema = z.strictObject({
  conversation_id: z.string(),
  status: z.literal("SUCCESS"),
  response: z.string().min(1).max(1_048_576),
  duration_seconds: z.number().nonnegative(),
  num_turns: z.number().int().positive(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    thinking_tokens: z.number().int().nonnegative(),
    cache_read_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
});

const agyErrorSchema = z
  .object({
    status: z.literal("ERROR"),
    error: z.string().min(1).max(2048),
  })
  .passthrough();

const codexEventSchema = z.object({
  type: z.string(),
  item: z.object({ type: z.string(), text: z.string().optional() }).optional(),
});

export function createDirectPromptRunner(
  process: ProcessPort = runProcess,
): DirectPromptPort {
  return async (request, signal) => {
    const valid = validateRequest(request);
    if (!valid.ok) return valid;
    const version = await executeVersion(request, process, signal);
    if (!version.ok) return version;
    const completion = await process({
      executable: request.executable,
      args: promptArgs(request),
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      maxOutputBytes: 1_048_576,
      ...(signal ? { signal } : {}),
    });
    if (!completion.ok) return completion;
    const text = parseCompletion(request.runner, completion.value);
    if (!text.ok) return text;
    return {
      ok: true,
      value: {
        runner: request.runner,
        runnerVersion: version.value,
        model: request.model,
        text: text.value,
      },
    };
  };
}

function validateRequest(request: DirectPromptRequest): Outcome<void> {
  if (
    !request.prompt.trim() ||
    request.prompt.length > 65_536 ||
    !/^\d+\.\d+\.\d+$/u.test(request.expectedVersion) ||
    !/^[A-Za-z0-9._-]{1,128}$/u.test(request.model) ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 1_000 ||
    request.timeoutMs > 600_000
  )
    return failure("INVALID_INPUT", "Direct prompt options are invalid.");
  return { ok: true, value: undefined };
}

async function executeVersion(
  request: DirectPromptRequest,
  process: ProcessPort,
  signal?: AbortSignal,
): Promise<Outcome<string>> {
  const result = await process({
    executable: request.executable,
    args: ["--version"],
    cwd: request.cwd,
    timeoutMs: Math.min(request.timeoutMs, 5_000),
    maxOutputBytes: 65_536,
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  const version = extractVersion(request.runner, result.value);
  if (!version || version !== request.expectedVersion)
    return failure(
      "CAPABILITY_MISSING",
      `Expected ${request.runner} ${request.expectedVersion}; installed version did not match.`,
    );
  return { ok: true, value: version };
}

function extractVersion(
  runner: "agy" | "codex",
  result: ProcessRunResult,
): string | null {
  if (result.exitCode !== 0) return null;
  const expression =
    runner === "codex"
      ? /^(?:codex-cli )?(\d+\.\d+\.\d+)\s*$/u
      : /^(\d+\.\d+\.\d+)\s*$/u;
  return expression.exec(result.stdout)?.[1] ?? null;
}

function promptArgs(request: DirectPromptRequest): string[] {
  if (request.runner === "agy")
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
      "--print",
      request.prompt,
    ];
  return [
    "exec",
    "--model",
    request.model,
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--json",
    request.prompt,
  ];
}

function parseCompletion(
  runner: "agy" | "codex",
  result: ProcessRunResult,
): Outcome<string> {
  if (runner === "agy") return parseAgyCompletion(result);
  if (result.exitCode !== 0)
    return failure("CAPABILITY_MISSING", "Codex direct prompt failed.");
  return parseCodexCompletion(result.stdout);
}

function parseAgyCompletion(result: ProcessRunResult): Outcome<string> {
  try {
    const value = JSON.parse(result.stdout) as unknown;
    const runnerError = agyErrorSchema.safeParse(value);
    if (runnerError.success)
      return failure(
        "CAPABILITY_MISSING",
        `Agy reported: ${runnerError.data.error}`,
      );
    const parsed = agyResultSchema.safeParse(value);
    if (!parsed.success)
      return failure("EVIDENCE_INVALID", "Agy returned an invalid response.");
    if (result.exitCode !== 0)
      return failure("CAPABILITY_MISSING", "Agy direct prompt failed.");
    return { ok: true, value: parsed.data.response.trim() };
  } catch {
    return failure("EVIDENCE_INVALID", "Agy returned malformed JSON.");
  }
}

function parseCodexCompletion(raw: string): Outcome<string> {
  const messages: string[] = [];
  let completed = false;
  for (const line of raw.split(/\r?\n/u).filter(Boolean)) {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      return failure("EVIDENCE_INVALID", "Codex returned malformed JSONL.");
    }
    const event = codexEventSchema.safeParse(value);
    if (!event.success)
      return failure("EVIDENCE_INVALID", "Codex returned an invalid event.");
    if (event.data.type === "turn.failed" || event.data.type === "error")
      return failure("CAPABILITY_MISSING", "Codex reported a failed turn.");
    if (event.data.type === "turn.completed") completed = true;
    if (
      event.data.type === "item.completed" &&
      event.data.item?.type === "agent_message"
    ) {
      const text = event.data.item.text?.trim();
      if (text) messages.push(text);
    }
  }
  return completed && messages.length > 0
    ? { ok: true, value: messages.join("\n\n") }
    : failure("EVIDENCE_INVALID", "Codex completion was missing a response.");
}

export type { DirectPromptResponse };
