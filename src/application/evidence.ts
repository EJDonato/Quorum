import type { z } from "zod";
import type { ArtifactReference } from "../contracts/ballot-input.js";
import { digest } from "../contracts/primitives.js";
import { failure, type Outcome } from "../contracts/errors.js";
import type { CanonicalHashPort } from "./candidates.js";

export interface EvidencePort extends CanonicalHashPort {
  readArtifact: (ref: ArtifactReference) => Promise<Outcome<unknown>>;
}

export async function readEvidence<T>(options: {
  ref: ArtifactReference;
  schema: z.ZodType<T>;
  port: EvidencePort;
}): Promise<Outcome<T>> {
  const stored = await options.port.readArtifact(options.ref);
  if (!stored.ok) return stored;
  // Hash raw stored data before parsing: a parser must never strip forged fields.
  const hashed = options.port.digest(stored.value);
  if (!hashed.ok) return hashed;
  if (
    !digest.safeParse(hashed.value).success ||
    hashed.value !== options.ref.digest
  )
    return failure(
      "EVIDENCE_INVALID",
      "Evidence bytes do not match the host artifact reference.",
    );
  const record = options.schema.safeParse(stored.value);
  if (!record.success)
    return failure(
      "EVIDENCE_INVALID",
      "Evidence record is malformed or has an unsupported version.",
    );
  return { ok: true, value: record.data };
}
