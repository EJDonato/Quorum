import {
  ballotEvidenceReferencesSchema,
  ballotRequirementsSchema,
  type BallotRequirements,
} from "../contracts/ballot-input.js";
import { ballotSchema, type Ballot } from "../contracts/ballot.js";
import { checkResultSchema } from "../contracts/checks.js";
import type { CandidateManifest } from "../contracts/candidate.js";
import { sessionStateSchema, type SessionState } from "../contracts/session.js";
import { failure, type Outcome } from "../contracts/errors.js";
import { computeBallot, type BallotFacts } from "../domain/ballots.js";
import { verifyCandidateIdentity } from "./candidates.js";
import { readEvidence, type EvidencePort } from "./evidence.js";
import { readFinalReview } from "./review-evidence.js";

export interface BallotPorts extends EvidencePort {
  // Must verify frozen policy/input identity, complete tasks/design/acceptance
  // evidence, budget reconciliation, scope, source/tree, and observed enforcement.
  // No production implementation exists; fake approval is restricted to tests.
  verifyPrerequisites: (context: {
    session: SessionState;
    candidate: CandidateManifest;
    requirements: BallotRequirements;
  }) => Promise<Outcome<void>>;
}

async function loadFacts(options: {
  facts: BallotFacts;
  rawRefs: unknown;
  ports: BallotPorts;
}): Promise<Outcome<BallotFacts>> {
  const refs = ballotEvidenceReferencesSchema.safeParse(options.rawRefs);
  if (!refs.success)
    return failure("INVALID_INPUT", "Invalid ballot evidence references.");
  for (const evidence of refs.data) {
    if (evidence.kind === "check") {
      const check = await readEvidence({
        ref: evidence.ref,
        schema: checkResultSchema,
        port: options.ports,
      });
      if (!check.ok) return check;
      options.facts.checks.push({ ref: evidence.ref, record: check.value });
    } else {
      const review = await readFinalReview({
        ref: evidence.ref,
        requestRef: evidence.request_ref,
        invocationRef: evidence.invocation_ref,
        port: options.ports,
      });
      if (!review.ok) return review;
      options.facts.reviews.push({
        ref: evidence.ref,
        requestRef: evidence.request_ref,
        invocationRef: evidence.invocation_ref,
        record: review.value,
      });
    }
  }
  return { ok: true, value: options.facts };
}

// Host application API only; absent from CLI and broker role tool inventories.
export async function evaluateBallot(options: {
  session: unknown;
  candidate: unknown;
  requirements: unknown;
  evidenceRefs: unknown;
  ports: BallotPorts;
}): Promise<Outcome<Ballot>> {
  const session = sessionStateSchema.safeParse(options.session);
  const candidate = verifyCandidateIdentity(options.candidate, options.ports);
  const requirements = ballotRequirementsSchema.safeParse(options.requirements);
  if (!session.success || !requirements.success)
    return failure(
      "INVALID_INPUT",
      "Malformed session or ballot requirements.",
    );
  if (!candidate.ok) return candidate;
  const facts = await loadFacts({
    facts: {
      session: session.data,
      candidate: candidate.value,
      requirements: requirements.data,
      checks: [],
      reviews: [],
      prerequisitesComplete: false,
    },
    rawRefs: options.evidenceRefs,
    ports: options.ports,
  });
  if (!facts.ok) return facts;
  const prerequisites = await options.ports.verifyPrerequisites({
    session: session.data,
    candidate: candidate.value,
    requirements: requirements.data,
  });
  if (!prerequisites.ok) return prerequisites;
  const computed = computeBallot({
    ...facts.value,
    prerequisitesComplete: true,
  });
  const parsed = ballotSchema.safeParse(computed);
  if (!parsed.success)
    return failure(
      "EVIDENCE_INVALID",
      "Computed ballot violates its contract.",
    );
  return { ok: true, value: parsed.data };
}
