import {
  candidateIdentitySchema,
  candidateManifestSchema,
  type CandidateManifest,
} from "../contracts/candidate.js";
import { digest } from "../contracts/primitives.js";
import { failure, type Outcome } from "../contracts/errors.js";

export interface CanonicalHashPort {
  digest: (value: unknown) => Outcome<string>;
}

export function createCandidateIdentity(
  raw: unknown,
  port: CanonicalHashPort,
): Outcome<CandidateManifest> {
  const identity = candidateIdentitySchema.safeParse(raw);
  if (!identity.success)
    return failure("INVALID_INPUT", "Invalid candidate identity payload.");
  const hashed = port.digest(identity.data);
  if (!hashed.ok) return hashed;
  if (!digest.safeParse(hashed.value).success)
    return failure("EVIDENCE_INVALID", "Hash port returned an invalid digest.");
  return {
    ok: true,
    value: {
      schema_version: "1.0.0",
      candidate_id: hashed.value,
      identity: identity.data,
    },
  };
}

export function verifyCandidateIdentity(
  raw: unknown,
  port: CanonicalHashPort,
): Outcome<CandidateManifest> {
  const parsed = candidateManifestSchema.safeParse(raw);
  if (!parsed.success)
    return failure("EVIDENCE_INVALID", "Malformed candidate manifest.");
  const recomputed = createCandidateIdentity(parsed.data.identity, port);
  if (!recomputed.ok) return recomputed;
  if (recomputed.value.candidate_id !== parsed.data.candidate_id)
    return failure(
      "EVIDENCE_INVALID",
      "Candidate identity digest does not match its payload.",
    );
  return { ok: true, value: parsed.data };
}
