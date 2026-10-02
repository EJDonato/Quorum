import { z } from "zod";
import type {
  DirectPromptPort,
  DirectPromptRequest,
  DirectPromptResponse,
} from "../../application/direct-prompt.js";
import { failure, type Outcome } from "../../contracts/errors.js";
import { runProcess, type ProcessRunResult } from "../process/runner.js";
import {
  codexEventSchema,
  runDirectCompletion,
  type DirectPromptProcess,
} from "./direct-prompt-progress.js";

type ProcessPort = DirectPromptProcess;

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

export function createDirectPromptRunner(
  process: ProcessPort = runProcess,
): DirectPromptPort {
  return async (request, signal, onProgress) => {
    const valid = validateRequest(request);
    if (!valid.ok) return valid;
    onProgress?.({ phase: "checking", message: "Checking runner version." });
    const version = await executeVersion(request, process, signal);
    if (!version.ok) return version;
    onProgress?.({
      phase: "starting",
      message: `Starting ${request.model} in read-only mode.`,
    });
    const completion = await runDirectCompletion({
      request,
      process,
      ...(signal ? { signal } : {}),
      ...(onProgress ? { onProgress } : {}),
    });
    if (!completion.ok) return completion;
    onProgress?.({ phase: "finishing", message: "Processing response." });
    const text = parseCompletion(request.runner, completion.value);
    if (!text.ok) return text;
    onProgress?.({ phase: "finishing", message: "Response ready." });
    return {
      ok: true,
      value: {
        runner: request.runner,
        runnerVersion: version.value,
        model: request.model,
        text: text.value.value,
        conversationId: text.value.conversationId,
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
    request.timeoutMs > 600_000 ||
    (request.conversationId !== undefined &&
      !/^[A-Za-z0-9-]{1,128}$/u.test(request.conversationId))
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

function parseCompletion(
  runner: "agy" | "codex",
  result: ProcessRunResult,
): Outcome<{ value: string; conversationId: string }> {
  if (runner === "agy") return parseAgyCompletion(result);
  if (result.exitCode !== 0)
    return failure("CAPABILITY_MISSING", "Codex direct prompt failed.");
  return parseCodexCompletion(result.stdout);
}

function parseAgyCompletion(
  result: ProcessRunResult,
): Outcome<{ value: string; conversationId: string }> {
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
    return {
      ok: true,
      value: {
        value: parsed.data.response.trim(),
        conversationId: parsed.data.conversation_id,
      },
    };
  } catch {
    return failure("EVIDENCE_INVALID", "Agy returned malformed JSON.");
  }
}

function parseCodexCompletion(
  raw: string,
): Outcome<{ value: string; conversationId: string }> {
  const messages: string[] = [];
  let completed = false;
  let conversationId: string | null = null;
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
    if (event.data.type === "thread.started" && event.data.thread_id)
      conversationId = event.data.thread_id;
    if (
      event.data.type === "item.completed" &&
      event.data.item?.type === "agent_message"
    ) {
      const text = event.data.item.text?.trim();
      if (text) messages.push(text);
    }
  }
  return completed && messages.length > 0 && conversationId
    ? {
        ok: true,
        value: { value: messages.join("\n\n"), conversationId },
      }
    : failure("EVIDENCE_INVALID", "Codex completion was missing a response.");
}

export type { DirectPromptResponse };
