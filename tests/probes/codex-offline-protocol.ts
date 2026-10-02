import { z } from "zod";

export const probeFailureSchema = z.enum([
  "LAUNCH_FAILED",
  "TIMED_OUT",
  "OUTPUT_LIMIT",
  "CANCELLED",
  "INVALID_PROTOCOL",
  "UNEXPECTED_REQUEST",
  "REMOTE_ERROR",
  "EARLY_EXIT",
]);
export type ProbeFailure = z.infer<typeof probeFailureSchema>;
const initializeResult = z.object({ userAgent: z.string().min(1) });
const threadResult = z.object({ thread: z.object({ id: z.string().min(1) }) });
export const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    reasoningOutputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .refine(
    (u) =>
      u.cachedInputTokens <= u.inputTokens &&
      u.reasoningOutputTokens <= u.outputTokens &&
      u.totalTokens === u.inputTokens + u.outputTokens,
  );

export function initialMessage() {
  return {
    id: 1,
    method: "initialize",
    params: {
      clientInfo: { name: "quorum_offline_probe", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    },
  };
}

export function threadMessage(cwd: string) {
  return {
    id: 2,
    method: "thread/start",
    params: {
      cwd,
      model: "quorum-fixture-model",
      modelProvider: "quorum_fixture",
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      environments: [],
      selectedCapabilityRoots: [],
      dynamicTools: [
        {
          type: "namespace",
          name: "repo",
          description: "Inert Quorum fixture",
          tools: [
            {
              type: "function",
              name: "read",
              description: "Read the fixed synthetic fixture",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          ],
        },
      ],
    },
  };
}

// Experimental discovery only. A registration response is not an exclusive inventory.
export class OfflineProtocol {
  initialized = false;
  registered = false;
  completed = false;
  usage: z.infer<typeof usageSchema> | null = null;
  readonly methods: string[] = [];
  private expectedId = 1;
  private threadId: string | null = null;
  private turnId: string | null = null;

  constructor(
    private readonly options: { cwd: string; fakeProvider: boolean },
  ) {}

  receive(value: unknown): {
    send: unknown[];
    done: boolean;
    failure: ProbeFailure | null;
  } {
    const envelope = z
      .object({
        id: z.union([z.string(), z.number()]).optional(),
        method: z.string().optional(),
        result: z.unknown().optional(),
        error: z.unknown().optional(),
        params: z.unknown().optional(),
      })
      .safeParse(value);
    if (!envelope.success) return this.fail("INVALID_PROTOCOL");
    const message = envelope.data;
    if (message.method) {
      if (message.id !== undefined) return this.fail("UNEXPECTED_REQUEST");
      if (this.methods.length >= 256) return this.fail("OUTPUT_LIMIT");
      this.methods.push(
        [
          "thread/started",
          "thread/tokenUsage/updated",
          "turn/started",
          "turn/completed",
          "remoteControl/status/changed",
          "error",
        ].includes(message.method)
          ? message.method
          : "other",
      );
      return this.notification(message.method, message.params);
    }
    if (message.id !== this.expectedId || message.error !== undefined)
      return this.fail(
        message.error !== undefined ? "REMOTE_ERROR" : "INVALID_PROTOCOL",
      );
    return this.response(message.result);
  }

  private response(result: unknown) {
    if (this.expectedId === 1) {
      if (!initializeResult.safeParse(result).success)
        return this.fail("INVALID_PROTOCOL");
      this.initialized = true;
      this.expectedId = 2;
      return {
        send: [
          { method: "initialized", params: {} },
          threadMessage(this.options.cwd),
        ],
        done: false,
        failure: null,
      };
    }
    if (this.expectedId === 2) {
      const parsed = threadResult.safeParse(result);
      if (!parsed.success) return this.fail("INVALID_PROTOCOL");
      this.registered = true;
      this.threadId = parsed.data.thread.id;
      this.expectedId = 3;
      if (!this.options.fakeProvider)
        return { send: [], done: true, failure: null };
      return {
        send: [
          {
            id: 3,
            method: "turn/start",
            params: {
              threadId: this.threadId,
              input: [
                {
                  type: "text",
                  text: "Reply with QUORUM_FIXTURE_OK. Do not use tools.",
                },
              ],
            },
          },
        ],
        done: false,
        failure: null,
      };
    }
    const parsed = z
      .object({ turn: z.object({ id: z.string().min(1) }) })
      .safeParse(result);
    if (!parsed.success || this.expectedId !== 3)
      return this.fail("INVALID_PROTOCOL");
    this.expectedId = 4;
    this.turnId = parsed.data.turn.id;
    return { send: [], done: false, failure: null };
  }

  private notification(method: string, params: unknown) {
    if (method === "error") return this.fail("REMOTE_ERROR");
    if (method === "thread/tokenUsage/updated") {
      const parsed = z
        .object({
          threadId: z.literal(this.threadId),
          tokenUsage: z.object({ total: usageSchema }),
        })
        .safeParse(params);
      if (
        !parsed.success ||
        (this.usage &&
          parsed.data.tokenUsage.total.totalTokens < this.usage.totalTokens)
      )
        return this.fail("INVALID_PROTOCOL");
      this.usage = parsed.data.tokenUsage.total;
    }
    if (method === "turn/completed") {
      const parsed = z
        .object({
          threadId: z.literal(this.threadId),
          turn: z.object({
            id: z.literal(this.turnId),
            status: z.literal("completed"),
          }),
        })
        .safeParse(params);
      if (
        !this.options.fakeProvider ||
        this.expectedId !== 4 ||
        !parsed.success ||
        !this.usage
      )
        return this.fail("INVALID_PROTOCOL");
      this.completed = true;
      return { send: [], done: true, failure: null };
    }
    return { send: [], done: false, failure: null };
  }

  private fail(failure: ProbeFailure) {
    return { send: [], done: false, failure };
  }
}
