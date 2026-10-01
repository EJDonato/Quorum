import { failure, type Outcome } from "../contracts/errors.js";

function encode(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (typeof value !== "object" || seen.has(value) || seen.size >= 100)
    throw new TypeError("Not a bounded acyclic JSON value");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new TypeError("Not a plain JSON object");
  }
  seen.add(value);
  const result = Array.isArray(value)
    ? encodeArray(value, seen)
    : encodeObject(value, seen);
  seen.delete(value);
  return result;
}

function encodeArray(value: unknown[], seen: Set<object>): string {
  if (Reflect.ownKeys(value).length !== value.length + 1)
    throw new TypeError("Sparse or extended array");
  const items = Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor))
      throw new TypeError("Sparse array or accessor");
    const item: unknown = descriptor.value;
    return encode(item, seen);
  });
  return `[${items.join(",")}]`;
}

function encodeObject(value: object, seen: Set<object>): string {
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new TypeError("Symbol keys are not JSON");
  if (Object.getOwnPropertyNames(value).length !== Object.keys(value).length)
    throw new TypeError("Hidden fields are not JSON");
  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor))
        throw new TypeError("Accessors are not JSON");
      const item: unknown = descriptor.value;
      return `${JSON.stringify(key)}:${encode(item, seen)}`;
    });
  return `{${entries.join(",")}}`;
}

export function canonicalSerialize(value: unknown): Outcome<string> {
  try {
    return { ok: true, value: encode(value, new Set()) };
  } catch (error) {
    if (error instanceof TypeError)
      return failure(
        "INVALID_INPUT",
        "Canonical serialization requires a finite, acyclic JSON value.",
      );
    throw error;
  }
}
