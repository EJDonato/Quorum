import { randomUUID } from "node:crypto";
import { failure, type Outcome } from "../contracts/errors.js";
import {
  commitReceiptSchema,
  type CommitReceipt,
} from "../contracts/receipt.js";
import { readSourceRepositoryInfo } from "../infrastructure/git/operations.js";
import { runProcess } from "../infrastructure/process/runner.js";
import {
  readArtifact,
  writeArtifact,
} from "../infrastructure/storage/artifacts.js";

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
  commitMessage?: string;
  authorName?: string;
  authorEmail?: string;
  now?: Date;
  transactionId?: string;
}

export interface FinalizeResult {
  receipt: CommitReceipt;
  recovered: boolean;
}

const ISOLATED_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ATTR_NOSYSTEM: "1",
};

export async function finalizeSession(
  options: FinalizeOptions,
): Promise<Outcome<FinalizeResult>> {
  const sourceInfo = await readSourceRepositoryInfo(options.sourceDir);
  if (!sourceInfo.ok) return sourceInfo;
  if (sourceInfo.value.headSha !== options.baseSha) {
    return failure(
      "SOURCE_DIVERGED",
      "Source repository HEAD diverged before finalization.",
    );
  }

  const existingReceipt = await readArtifact({
    baseDir: options.artifactsDir,
    relativePath: "receipt.json",
  });
  if (existingReceipt.ok) {
    const parsed = commitReceiptSchema.safeParse(
      JSON.parse(existingReceipt.value.content.toString("utf8")),
    );
    if (parsed.success && parsed.data.candidate_id === options.candidateId) {
      return { ok: true, value: { receipt: parsed.data, recovered: true } };
    }
  }

  return executeFinalizationTransaction(options);
}

async function createCommitAndRef(
  options: FinalizeOptions,
  meta: { msg: string; author: string; email: string; now: string },
): Promise<Outcome<string>> {
  const commitRes = await runProcess({
    executable: "git",
    args: [
      "commit-tree",
      options.treeOid,
      "-p",
      options.baseSha,
      "-m",
      meta.msg,
    ],
    cwd: options.draftDir,
    env: {
      ...ISOLATED_ENV,
      GIT_AUTHOR_NAME: meta.author,
      GIT_AUTHOR_EMAIL: meta.email,
      GIT_AUTHOR_DATE: meta.now,
      GIT_COMMITTER_NAME: meta.author,
      GIT_COMMITTER_EMAIL: meta.email,
      GIT_COMMITTER_DATE: meta.now,
    },
  });
  if (!commitRes.ok || commitRes.value.exitCode !== 0) {
    return failure(
      "STORAGE_FAILED",
      "Failed to create deterministic commit object.",
    );
  }
  const commitOid = commitRes.value.stdout.trim();
  const updateRef = await runProcess({
    executable: "git",
    args: ["update-ref", `refs/heads/quorum/${options.sessionId}`, commitOid],
    cwd: options.draftDir,
    env: ISOLATED_ENV,
  });
  if (!updateRef.ok || updateRef.value.exitCode !== 0) {
    return failure(
      "STORAGE_FAILED",
      "Failed to update session branch reference.",
    );
  }
  return { ok: true, value: commitOid };
}

async function executeFinalizationTransaction(
  options: FinalizeOptions,
): Promise<Outcome<FinalizeResult>> {
  const txId = options.transactionId ?? randomUUID().replaceAll("-", "");
  const now = (options.now ?? new Date()).toISOString();
  const msg =
    options.commitMessage ??
    `quorum: verified candidate ${options.candidateId}`;
  const author = options.authorName ?? "Quorum";
  const email = options.authorEmail ?? "quorum@local";

  const intent = {
    schema_version: "1.0.0",
    transaction_id: txId,
    session_id: options.sessionId,
    candidate_id: options.candidateId,
    tree_oid: options.treeOid,
    base_sha: options.baseSha,
    timestamp: now,
  };
  const intentWrite = await writeArtifact({
    baseDir: options.artifactsDir,
    relativePath: "finalization.json",
    content: JSON.stringify(intent, null, 2) + "\n",
  });
  if (!intentWrite.ok) return intentWrite;

  const commitRes = await createCommitAndRef(options, {
    msg,
    author,
    email,
    now,
  });
  if (!commitRes.ok) return commitRes;

  const receipt: CommitReceipt = {
    schema_version: "1.0.0",
    transaction_id: txId,
    session_id: options.sessionId,
    candidate_id: options.candidateId,
    commit: { format: options.objectFormat, oid: commitRes.value },
    tree: { format: options.objectFormat, oid: options.treeOid },
    parent: { format: options.objectFormat, oid: options.baseSha },
    evidence_refs: options.evidenceRefs,
  };

  const receiptWrite = await writeArtifact({
    baseDir: options.artifactsDir,
    relativePath: "receipt.json",
    content: JSON.stringify(receipt, null, 2) + "\n",
  });
  if (!receiptWrite.ok) return receiptWrite;

  return { ok: true, value: { receipt, recovered: false } };
}
