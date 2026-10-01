import { z } from "zod";
import {
  envelopeShape,
  fail,
  parseJson,
  parseSchema,
  ProtocolFailure,
  type ProtocolDiagnostic,
} from "./diagnostics.js";

export type Runner = "codex" | "agy";
const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const responseSchema = z.strictObject({
  marker: z.literal("QUORUM_OK"),
  sum: z.literal(5),
});
export const responseJsonSchema = z.toJSONSchema(responseSchema);
export const probePrompt =
  'Return only JSON with marker "QUORUM_OK" and sum equal to 2 + 3. Do not use tools, read files, or change files.';

const usageSchema = z.object({
  input_tokens: tokens,
  output_tokens: tokens,
  cached_input_tokens: tokens.optional(),
  cache_write_input_tokens: tokens.optional(),
  reasoning_output_tokens: tokens.optional(),
  thinking_tokens: tokens.optional(),
  cache_read_tokens: tokens.optional(),
  total_tokens: tokens.optional(),
});
const eventSchema = z.object({ type: z.string() });
const itemSchema = z.object({
  type: z.enum(["agent_message", "reasoning"]),
  text: z.string().optional(),
});

export type ProbeResult =
  | {
      ok: true;
      response: z.infer<typeof responseSchema>;
      usage: z.infer<typeof usageSchema>;
    }
  | {
      ok: false;
      reason: "EXECUTION_FAILED" | "INVALID_PROTOCOL";
      diagnostic?: ProtocolDiagnostic;
      envelope_shape?: Record<string, string>;
    };

function messageFromItem(
  record: unknown,
  eventType: string,
): string | undefined {
  if (!["item.started", "item.updated", "item.completed"].includes(eventType)) {
    fail("events", "INVALID_SEQUENCE");
  }
  const { item } = parseSchema(
    z.object({ item: itemSchema }),
    record,
    "events",
  );
  if (eventType !== "item.completed" || item.type !== "agent_message")
    return undefined;
  if (item.text === undefined) fail("events", "INCOMPLETE_TURN");
  return item.text;
}

function codexOutput(stdout: string) {
  const records = stdout
    .trim()
    .split("\n")
    .map((line) => parseJson(line, "output_json"));
  const messages: string[] = [];
  const completions: z.infer<typeof usageSchema>[] = [];
  let started = false;
  let thread = false;
  for (const record of records) {
    const event = parseSchema(eventSchema, record, "events");
    if (completions.length > 0) fail("events", "INVALID_SEQUENCE");
    if (event.type === "thread.started" && !thread && !started) {
      thread = true;
    } else if (event.type === "turn.started" && thread && !started) {
      started = true;
    } else if (event.type.startsWith("item.") && started) {
      const message = messageFromItem(record, event.type);
      if (message !== undefined) messages.push(message);
    } else if (event.type === "turn.completed" && started) {
      completions.push(
        parseSchema(z.object({ usage: usageSchema }), record, "usage").usage,
      );
    } else {
      fail("events", "INVALID_SEQUENCE");
    }
  }
  if (messages.length !== 1 || completions.length !== 1)
    fail("events", "INCOMPLETE_TURN");
  const text = messages[0];
  const usage = completions[0];
  if (text === undefined || usage === undefined)
    fail("events", "INCOMPLETE_TURN");
  return {
    response: parseSchema(
      responseSchema,
      parseJson(text, "response_json"),
      "response_schema",
    ),
    usage,
  };
}

function agyOutput(value: unknown) {
  const envelope = parseSchema(
    z.record(z.string(), z.unknown()),
    value,
    "envelope",
  );
  parseSchema(z.literal("SUCCESS"), envelope.status, "status");
  parseSchema(z.string(), envelope.response, "envelope");
  const usage = parseSchema(usageSchema, envelope.usage, "usage");
  return {
    response: parseSchema(
      responseSchema,
      envelope.structured_output,
      "response_schema",
    ),
    usage,
  };
}

export function validateProbe(options: {
  runner: Runner;
  stdout: string;
  exitCode: number | null;
  interrupted?: boolean;
}): ProbeResult {
  if (options.exitCode !== 0 || options.interrupted) {
    return { ok: false, reason: "EXECUTION_FAILED" };
  }
  let shape: Record<string, string> | undefined;
  try {
    const agy =
      options.runner === "agy"
        ? parseJson(options.stdout, "output_json")
        : undefined;
    if (options.runner === "agy") shape = envelopeShape(agy);
    const result =
      options.runner === "codex" ? codexOutput(options.stdout) : agyOutput(agy);
    return { ok: true, ...result };
  } catch (error) {
    // Never echo untrusted runner output or provider diagnostics into reports.
    return {
      ok: false,
      reason: "INVALID_PROTOCOL",
      ...(error instanceof ProtocolFailure
        ? { diagnostic: error.diagnostic }
        : {}),
      ...(shape ? { envelope_shape: shape } : {}),
    };
  }
}

export function probeArguments(options: {
  runner: Runner;
  model: string;
  schemaPath: string;
}): string[] {
  if (options.runner === "codex") {
    return [
      "exec",
      "--model",
      options.model,
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--json",
      "--output-schema",
      options.schemaPath,
      probePrompt,
    ];
  }
  return [
    "--model",
    options.model,
    "--sandbox",
    "--mode",
    "plan",
    "--print-timeout",
    "60s",
    "--output-format",
    "json",
    "--json-schema",
    options.schemaPath,
    "--print",
    probePrompt,
  ];
}
