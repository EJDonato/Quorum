import { randomUUID } from "node:crypto";
import {
  finalizationIntentSchema,
  type FinalizationIntent,
} from "../contracts/finalization.js";
import { failure, type Outcome } from "../contracts/errors.js";
import { readRecord } from "../infrastructure/storage/records.js";
import { writeArtifact } from "../infrastructure/storage/artifacts.js";
import type { FinalizeOptions } from "./finalize.js";

export async function getIntent(
  options: FinalizeOptions,
): Promise<Outcome<{ intent: FinalizationIntent; recovered: boolean }>> {
  const saved = await readRecord({
    dir: options.artifactsDir,
    name: "finalization.json",
    schema: finalizationIntentSchema,
  });
  if (!saved.ok) return saved;
  if (saved.value) {
    const intent = saved.value;
    if (
      (options.commitMessage !== undefined &&
        options.commitMessage !== intent.message) ||
      (options.authorName !== undefined &&
        options.authorName !== intent.author_name) ||
      (options.authorEmail !== undefined &&
        options.authorEmail !== intent.author_email) ||
      intent.session_id !== options.sessionId ||
      intent.candidate_id !== options.candidateId ||
      intent.tree.oid !== options.treeOid ||
      intent.parent.oid !== options.baseSha ||
      intent.tree.format !== options.objectFormat ||
      intent.parent.format !== options.objectFormat ||
      JSON.stringify(intent.evidence_refs) !==
        JSON.stringify(options.evidenceRefs)
    )
      return failure(
        "EVIDENCE_INVALID",
        "Saved finalization intent conflicts with this request.",
      );
    return { ok: true, value: { intent, recovered: true } };
  }
  const parsed = finalizationIntentSchema.safeParse({
    schema_version: "1.0.0",
    transaction_id: options.transactionId ?? randomUUID().replaceAll("-", ""),
    session_id: options.sessionId,
    candidate_id: options.candidateId,
    tree: { format: options.objectFormat, oid: options.treeOid },
    parent: { format: options.objectFormat, oid: options.baseSha },
    evidence_refs: options.evidenceRefs,
    message:
      options.commitMessage ??
      `quorum: verified candidate ${options.candidateId}\n\nQuorum-Session: ${options.sessionId}`,
    author_name: options.authorName ?? "Quorum",
    author_email: options.authorEmail ?? "quorum@local",
    timestamp: (options.now ?? new Date()).toISOString(),
  });
  if (!parsed.success)
    return failure("INVALID_INPUT", "Invalid finalization intent.");
  const write = await writeArtifact({
    baseDir: options.artifactsDir,
    relativePath: "finalization.json",
    content: JSON.stringify(parsed.data, null, 2) + "\n",
  });
  return write.ok
    ? { ok: true, value: { intent: parsed.data, recovered: false } }
    : write;
}
