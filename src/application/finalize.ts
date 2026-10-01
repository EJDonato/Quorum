import type { SessionState } from "../contracts/session.js";
import { getIntent } from "./finalization-intent.js";
import { readRecord } from "../infrastructure/storage/records.js";
import { failure, type Outcome } from "../contracts/errors.js";
import {
  type FinalizationIntent,
  finalizationObjectSchema,
} from "../contracts/finalization.js";
import {
  commitReceiptSchema,
  type CommitReceipt,
} from "../contracts/receipt.js";
import {
  readSourceRepositoryInfo,
  writeDraftTree,
} from "../infrastructure/git/operations.js";
import {
  constructCommit,
  installSessionRef,
  verifyCommit,
} from "../infrastructure/git/finalization.js";
import { writeArtifact } from "../infrastructure/storage/artifacts.js";
import { evaluateBallot } from "./evaluate-ballot.js";

export type BallotEvaluation = Parameters<typeof evaluateBallot>[0];
export interface FinalizeOptions {
  sessionId: string;
  sourceDir: string;
  draftDir: string;
  artifactsDir: string;
  candidateId: string;
  treeOid: string;
  baseSha: string;
  objectFormat: "sha1" | "sha256";
  evidenceRefs: Array<{ artifact_id: string; digest: string }>;
  verification?: BallotEvaluation;
  loadSession?: () => Promise<Outcome<SessionState>>;
  commitMessage?: string;
  authorName?: string;
  authorEmail?: string;
  now?: Date;
  transactionId?: string;
  // Trusted fault-injection boundary, never a model tool.
  checkpoint?: (stage: "intent" | "object" | "ref") => Promise<Outcome<void>>;
}
export interface FinalizeResult {
  receipt: CommitReceipt;
  recovered: boolean;
}

async function authorizeFinalization(options: FinalizeOptions) {
  if (!options.verification || !options.loadSession)
    return failure(
      "CAPABILITY_MISSING",
      "Finalization requires host evidence and prerequisite verification.",
    );
  const session = await options.loadSession();
  if (!session.ok) return session;
  const ballot = await evaluateBallot({
    ...options.verification,
    session: session.value,
  });
  if (!ballot.ok) return ballot;
  if (
    !ballot.value.quorum_achieved ||
    ballot.value.session_id !== options.sessionId ||
    ballot.value.candidate_id !== options.candidateId ||
    JSON.stringify(ballot.value.evidence) !==
      JSON.stringify(options.evidenceRefs)
  )
    return failure(
      "EVIDENCE_INVALID",
      "Current ballot does not authorize this transaction.",
    );
  const candidate = options.verification.candidate;
  // evaluateBallot has already validated this record; parse again to access typed identity.
  const { candidateManifestSchema } = await import("../contracts/candidate.js");
  const parsed = candidateManifestSchema.safeParse(candidate);
  if (
    !parsed.success ||
    parsed.data.identity.tree.oid !== options.treeOid ||
    parsed.data.identity.base_commit.oid !== options.baseSha ||
    parsed.data.identity.tree.format !== options.objectFormat
  )
    return failure(
      "EVIDENCE_INVALID",
      "Transaction differs from the approved candidate.",
    );
  const source = await readSourceRepositoryInfo(options.sourceDir);
  if (!source.ok) return source;
  if (
    source.value.headSha !== options.baseSha ||
    source.value.objectFormat !== options.objectFormat
  )
    return failure(
      "SOURCE_DIVERGED",
      "Source HEAD diverged before finalization.",
    );
  const tree = await writeDraftTree(options.draftDir);
  if (!tree.ok) return tree;
  return tree.value.treeOid === options.treeOid
    ? { ok: true as const, value: undefined }
    : failure("STALE_INPUT", "Draft tree changed after approval.");
}

export async function finalizeSession(
  options: FinalizeOptions,
): Promise<Outcome<FinalizeResult>> {
  const authorized = await authorizeFinalization(options);
  if (!authorized.ok) return authorized;
  const saved = await getIntent(options);
  if (!saved.ok) return saved;
  return finishTransaction(options, saved.value);
}

async function finishTransaction(
  options: FinalizeOptions,
  saved: {
    intent: FinalizationIntent;
    recovered: boolean;
  },
): Promise<Outcome<FinalizeResult>> {
  const { intent } = saved;
  const intentPoint = await checkpoint(options, "intent");
  if (!intentPoint.ok) return intentPoint;
  const commit = await constructCommit(options.draftDir, intent);
  if (!commit.ok) return commit;
  const verified = await verifyCommit({
    draftDir: options.draftDir,
    oid: commit.value,
    intent,
  });
  if (!verified.ok) return verified;
  const objectRecord = await persistCommitObject(options, intent, commit.value);
  if (!objectRecord.ok) return objectRecord;
  const objectPoint = await checkpoint(options, "object");
  if (!objectPoint.ok) return objectPoint;
  const receipt = makeReceipt(intent, commit.value);
  const previous = await readRecord({
    dir: options.artifactsDir,
    name: "receipt.json",
    schema: commitReceiptSchema,
  });
  if (!previous.ok) return previous;
  if (
    previous.value &&
    JSON.stringify(previous.value) !== JSON.stringify(receipt)
  )
    return failure(
      "EVIDENCE_INVALID",
      "Receipt conflicts with recorded intent and Git objects.",
    );
  // Recheck both prerequisites and source/tree immediately before the reference effect.
  const authorized = await authorizeFinalization(options);
  if (!authorized.ok) return authorized;
  const ref = await installSessionRef({
    draftDir: options.draftDir,
    oid: commit.value,
    intent,
    requireExisting: previous.value !== null,
  });
  if (!ref.ok) return ref;
  const refPoint = await checkpoint(options, "ref");
  if (!refPoint.ok) return refPoint;
  return publishReceipt(options, receipt, saved.recovered);
}

async function checkpoint(
  options: FinalizeOptions,
  stage: "intent" | "object" | "ref",
): Promise<Outcome<void>> {
  return options.checkpoint
    ? options.checkpoint(stage)
    : { ok: true, value: undefined };
}

function makeReceipt(intent: FinalizationIntent, oid: string): CommitReceipt {
  return {
    schema_version: "1.0.0",
    transaction_id: intent.transaction_id,
    session_id: intent.session_id,
    candidate_id: intent.candidate_id,
    commit: { format: intent.tree.format, oid: oid },
    tree: intent.tree,
    parent: intent.parent,
    evidence_refs: intent.evidence_refs,
  };
}

async function persistCommitObject(
  options: FinalizeOptions,
  intent: FinalizationIntent,
  oid: string,
) {
  const record = finalizationObjectSchema.safeParse({
    schema_version: "1.0.0",
    transaction_id: intent.transaction_id,
    commit: { format: intent.tree.format, oid },
    tree: intent.tree,
    parent: intent.parent,
  });
  if (!record.success)
    return failure("EVIDENCE_INVALID", "Invalid commit object identity.");
  return writeArtifact({
    baseDir: options.artifactsDir,
    relativePath: "finalization-object.json",
    content: JSON.stringify(record.data, null, 2) + "\n",
  });
}

async function publishReceipt(
  options: FinalizeOptions,
  receipt: CommitReceipt,
  recovered: boolean,
): Promise<Outcome<FinalizeResult>> {
  const authorized = await authorizeFinalization(options);
  if (!authorized.ok) return authorized;
  const write = await writeArtifact({
    baseDir: options.artifactsDir,
    relativePath: "receipt.json",
    content: JSON.stringify(receipt, null, 2) + "\n",
  });
  return write.ok ? { ok: true, value: { receipt, recovered } } : write;
}
