import {
  preparationIdentitySchema,
  preparationSnapshotSchema,
  type PreparationSnapshot,
} from "../contracts/test-specification.js";
import { failure, type Outcome } from "../contracts/errors.js";
import { digest } from "../contracts/primitives.js";
import type { CanonicalHashPort } from "./candidates.js";

export function createPreparationSnapshot(
  raw: unknown,
  port: CanonicalHashPort,
): Outcome<PreparationSnapshot> {
  const identity = preparationIdentitySchema.safeParse(raw);
  if (!identity.success)
    return failure("INVALID_INPUT", "Malformed preparation identity.");
  const { tree, baseline_tree, phase } = identity.data;
  if (
    tree.format !== baseline_tree.format ||
    (phase === "baseline" && tree.oid !== baseline_tree.oid)
  )
    return failure(
      "EVIDENCE_INVALID",
      "Baseline tree or object format differs.",
    );
  const hashed = port.digest(identity.data);
  if (!hashed.ok) return hashed;
  if (!digest.safeParse(hashed.value).success)
    return failure("EVIDENCE_INVALID", "Invalid preparation digest.");
  return {
    ok: true,
    value: {
      schema_version: "1.0.0",
      input_digest: hashed.value,
      identity: identity.data,
    },
  };
}

export function verifyPreparationSnapshot(
  raw: unknown,
  port: CanonicalHashPort,
): Outcome<PreparationSnapshot> {
  const parsed = preparationSnapshotSchema.safeParse(raw);
  if (!parsed.success)
    return failure("EVIDENCE_INVALID", "Malformed preparation snapshot.");
  const recreated = createPreparationSnapshot(parsed.data.identity, port);
  if (!recreated.ok) return recreated;
  return recreated.value.input_digest === parsed.data.input_digest
    ? recreated
    : failure("EVIDENCE_INVALID", "Preparation digest differs from identity.");
}
