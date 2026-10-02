import { z } from "zod";

export const agyProbeFailureSchema = z.enum([
  "LAUNCH_FAILED",
  "TIMED_OUT",
  "OUTPUT_LIMIT",
  "CANCELLED",
  "INVALID_PROTOCOL",
  "UNEXPECTED_REQUEST",
  "REMOTE_ERROR",
  "EARLY_EXIT",
]);
export type AgyProbeFailure = z.infer<typeof agyProbeFailureSchema>;

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const agyUsageSchema = z
  .strictObject({
    input_tokens: tokenCount,
    output_tokens: tokenCount,
    thinking_tokens: tokenCount,
    cache_read_tokens: tokenCount,
    total_tokens: tokenCount,
  })
  .refine(
    (u) =>
      u.thinking_tokens <= u.output_tokens &&
      u.total_tokens === u.input_tokens + u.output_tokens,
    {
      message:
        "Thinking tokens must be subset of output, total must be input + output",
    },
  );
export type AgyUsage = z.infer<typeof agyUsageSchema>;

export const agyInitPayloadSchema = z.strictObject({
  cwd: z.string().min(1).max(4096),
  tools: z.array(z.string().min(1).max(128)).max(256),
  permission_mode: z.string().min(1).max(64),
});

export const agyInitEventSchema = z.strictObject({
  event: z.literal("init"),
  conversation_id: z.string().min(1).max(128),
  init: agyInitPayloadSchema,
});

export const agyCommandResultEventSchema = z.strictObject({
  event: z.literal("command_result"),
  command: z.strictObject({
    name: z.string().min(1).max(64),
    data: z.unknown(),
  }),
});

export const agyResultPayloadSchema = z.strictObject({
  conversation_id: z.string().max(128),
  status: z.enum(["SUCCESS", "ERROR"]),
  response: z.string(),
  error: z.string().optional(),
  duration_seconds: z.number().nonnegative(),
  num_turns: z.number().int().nonnegative(),
  usage: agyUsageSchema,
  command: z.unknown().optional(),
  structured_output: z.unknown().optional(),
});

export const agyResultEventSchema = z.strictObject({
  event: z.literal("result"),
  result: agyResultPayloadSchema,
});

export type AgyReceiveOutcome = {
  done: boolean;
  failure: AgyProbeFailure | null;
};

export class AgyOfflineProtocol {
  initialized = false;
  completed = false;
  conversationId: string | null = null;
  tools: string[] | null = null;
  usage: AgyUsage | null = null;
  status: "SUCCESS" | "ERROR" | null = null;
  readonly events: string[] = [];

  constructor(readonly options: { initOnly?: boolean } = {}) {}

  receive(value: unknown): AgyReceiveOutcome {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return this.fail("INVALID_PROTOCOL");
    }
    const envelope = z
      .object({ event: z.string().optional() })
      .safeParse(value);
    if (!envelope.success || !envelope.data.event) {
      return this.fail("INVALID_PROTOCOL");
    }
    if (this.events.length >= 256) return this.fail("OUTPUT_LIMIT");
    const eventType = envelope.data.event;
    this.events.push(eventType);

    if (eventType === "init") {
      return this.handleInit(value);
    }
    if (eventType === "command_result") {
      return this.handleCommandResult(value);
    }
    if (eventType === "result") {
      return this.handleResult(value);
    }
    return { done: false, failure: null };
  }

  private handleInit(value: unknown): AgyReceiveOutcome {
    if (this.initialized) return this.fail("INVALID_PROTOCOL");
    const parsed = agyInitEventSchema.safeParse(value);
    if (!parsed.success) return this.fail("INVALID_PROTOCOL");
    this.initialized = true;
    this.conversationId = parsed.data.conversation_id;
    this.tools = [...parsed.data.init.tools].sort();
    return { done: Boolean(this.options.initOnly), failure: null };
  }

  private handleCommandResult(value: unknown): AgyReceiveOutcome {
    const parsed = agyCommandResultEventSchema.safeParse(value);
    if (!parsed.success) return this.fail("INVALID_PROTOCOL");
    return { done: false, failure: null };
  }

  private handleResult(value: unknown): AgyReceiveOutcome {
    if (this.completed) return this.fail("INVALID_PROTOCOL");
    const parsed = agyResultEventSchema.safeParse(value);
    if (!parsed.success) return this.fail("INVALID_PROTOCOL");
    this.completed = true;
    this.status = parsed.data.result.status;
    this.usage = parsed.data.result.usage;
    return { done: true, failure: null };
  }

  private fail(failure: AgyProbeFailure): AgyReceiveOutcome {
    return { done: false, failure };
  }
}
