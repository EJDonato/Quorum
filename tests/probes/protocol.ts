import { z } from "zod";

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
  | { ok: false; reason: "EXECUTION_FAILED" | "INVALID_PROTOCOL" };

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function messageFromItem(
  record: unknown,
  eventType: string,
): string | undefined {
  if (!["item.started", "item.updated", "item.completed"].includes(eventType)) {
    throw new Error("Unknown item event");
  }
  const { item } = z.object({ item: itemSchema }).parse(record);
  if (eventType !== "item.completed" || item.type !== "agent_message")
    return undefined;
  if (item.text === undefined) throw new Error("Missing message");
  return item.text;
}

function codexOutput(stdout: string) {
  const records = stdout.trim().split("\n").map(parseJson);
  const messages: string[] = [];
  const completions: z.infer<typeof usageSchema>[] = [];
  let started = false;
  let thread = false;
  for (const record of records) {
    const event = eventSchema.parse(record);
    if (completions.length > 0) throw new Error("Trailing event");
    if (event.type === "thread.started" && !thread && !started) {
      thread = true;
    } else if (event.type === "turn.started" && thread && !started) {
      started = true;
    } else if (event.type.startsWith("item.") && started) {
      const message = messageFromItem(record, event.type);
      if (message !== undefined) messages.push(message);
    } else if (event.type === "turn.completed" && started) {
      completions.push(z.object({ usage: usageSchema }).parse(record).usage);
    } else {
      throw new Error("Unknown, failed, or reordered event");
    }
  }
  if (messages.length !== 1 || completions.length !== 1)
    throw new Error("Incomplete turn");
  const text = messages[0];
  const usage = completions[0];
  if (text === undefined || usage === undefined)
    throw new Error("Incomplete output");
  return { response: responseSchema.parse(parseJson(text)), usage };
}

function agyOutput(stdout: string) {
  const envelope = z
    .object({
      status: z.literal("SUCCESS"),
      response: z.string(),
      usage: usageSchema,
    })
    .parse(parseJson(stdout));
  return {
    response: responseSchema.parse(parseJson(envelope.response)),
    usage: envelope.usage,
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
  try {
    const result =
      options.runner === "codex"
        ? codexOutput(options.stdout)
        : agyOutput(options.stdout);
    return { ok: true, ...result };
  } catch {
    // Never echo untrusted runner output or provider diagnostics into reports.
    return { ok: false, reason: "INVALID_PROTOCOL" };
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
