import { z } from "zod";
import { count, versionLabel } from "../../contracts/primitives.js";
import { failure } from "../../contracts/errors.js";

const wireUsage = z.object({
  input_tokens: count,
  output_tokens: count,
  total_tokens: count,
  input_tokens_details: z.object({ cached_tokens: count }),
  output_tokens_details: z.object({ reasoning_tokens: count }),
});
const wireResponse = z.object({
  status: z.enum(["completed", "incomplete"]),
  model: versionLabel,
  usage: wireUsage,
  output: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("message"),
          role: z.literal("assistant"),
          content: z
            .array(
              z.object({
                type: z.literal("output_text"),
                text: z.string().max(65536),
              }),
            )
            .max(64),
        }),
        z.object({
          type: z.literal("reasoning"),
          summary: z
            .array(
              z.object({
                type: z.literal("summary_text"),
                text: z.string().max(65536),
              }),
            )
            .max(64),
        }),
      ]),
    )
    .max(64),
});

export function decodeResponsesCompletion(options: {
  value: unknown;
  model: string;
  digest: string;
}) {
  const parsed = wireResponse.safeParse(options.value);
  if (!parsed.success || parsed.data.model !== options.model)
    return failure(
      "EVIDENCE_INVALID",
      "Provider output, model identity or usage is unsupported.",
    );
  const usage = parsed.data.usage;
  const output = parsed.data.output
    .flatMap((item) =>
      item.type === "message" ? item.content.map((part) => part.text) : [],
    )
    .join("");
  if (
    output.length > 65536 ||
    usage.total_tokens !== usage.input_tokens + usage.output_tokens
  )
    return failure(
      "EVIDENCE_INVALID",
      "Provider output or token totals violate the response contract.",
    );
  return {
    ok: true as const,
    value: {
      payload_digest: options.digest,
      status: parsed.data.status,
      output,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cached_input_tokens: usage.input_tokens_details.cached_tokens,
        reasoning_tokens: usage.output_tokens_details.reasoning_tokens,
        charged_tokens: usage.total_tokens,
        accounting_complete: true,
      },
    },
  };
}
