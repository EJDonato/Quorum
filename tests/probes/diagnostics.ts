import { z } from "zod";

export type Stage =
  | "output_json"
  | "envelope"
  | "status"
  | "response_json"
  | "response_schema"
  | "usage"
  | "events";
export interface ProtocolDiagnostic {
  stage: Stage;
  code:
    | "MALFORMED_JSON"
    | "SCHEMA_MISMATCH"
    | "INVALID_SEQUENCE"
    | "INCOMPLETE_TURN";
  fields: string[];
}
const knownFields = new Set([
  "type",
  "item",
  "text",
  "status",
  "response",
  "structured_output",
  "marker",
  "sum",
  "usage",
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "reasoning_output_tokens",
  "thinking_tokens",
  "cache_read_tokens",
  "total_tokens",
]);
export class ProtocolFailure extends Error {
  constructor(readonly diagnostic: ProtocolDiagnostic) {
    super("Runner protocol validation failed");
  }
}
export function fail(stage: Stage, code: ProtocolDiagnostic["code"]): never {
  throw new ProtocolFailure({ stage, code, fields: [] });
}
export function parseJson(text: string, stage: Stage): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return fail(stage, "MALFORMED_JSON");
  }
}
export function parseSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  stage: Stage,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fields = new Set<string>();
  for (const issue of parsed.error.issues) {
    // Neither Zod messages nor unknown field names are safe diagnostics.
    if (issue.code === "unrecognized_keys") fields.add("unknown_field");
    for (const part of issue.path) {
      fields.add(
        typeof part === "string" && knownFields.has(part)
          ? part
          : "unknown_field",
      );
    }
  }
  throw new ProtocolFailure({
    stage,
    code: "SCHEMA_MISMATCH",
    fields: [...fields].slice(0, 8),
  });
}
export function envelopeShape(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const object = z.record(z.string(), z.unknown()).parse(value);
  const shape: Record<string, string> = {};
  for (const field of [
    "status",
    "response",
    "usage",
    "structured_output",
    "result",
  ]) {
    const item = object[field];
    shape[field] = !Object.hasOwn(object, field)
      ? "absent"
      : item === null
        ? "null"
        : Array.isArray(item)
          ? "array"
          : typeof item;
  }
  return shape;
}
