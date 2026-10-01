import { createHash } from "node:crypto";
import { canonicalSerialize } from "../../domain/canonical.js";
import type { Outcome } from "../../contracts/errors.js";

export function canonicalDigest(value: unknown): Outcome<string> {
  const serialized = canonicalSerialize(value);
  if (!serialized.ok) return serialized;
  return {
    ok: true,
    value: `sha256:${createHash("sha256").update(serialized.value, "utf8").digest("hex")}`,
  };
}
