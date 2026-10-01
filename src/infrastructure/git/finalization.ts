import { failure, type Outcome } from "../../contracts/errors.js";
import type { FinalizationIntent } from "../../contracts/finalization.js";
import { runProcess } from "../process/runner.js";

// Do not inherit GIT_DIR, injected Git config, hooks, credentials, or author data.
const env = {
  PATH: process.env.PATH,
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ATTR_NOSYSTEM: "1",
};
async function git(draftDir: string, args: string[], extra = {}) {
  return runProcess({
    executable: "git",
    args: ["-c", "core.hooksPath=/dev/null", ...args],
    cwd: draftDir,
    env: { ...env, ...extra },
  });
}

export async function constructCommit(
  draftDir: string,
  intent: FinalizationIntent,
): Promise<Outcome<string>> {
  const result = await git(
    draftDir,
    [
      "commit-tree",
      intent.tree.oid,
      "-p",
      intent.parent.oid,
      "-m",
      intent.message,
    ],
    {
      GIT_AUTHOR_NAME: intent.author_name,
      GIT_AUTHOR_EMAIL: intent.author_email,
      GIT_AUTHOR_DATE: intent.timestamp,
      GIT_COMMITTER_NAME: intent.author_name,
      GIT_COMMITTER_EMAIL: intent.author_email,
      GIT_COMMITTER_DATE: intent.timestamp,
    },
  );
  if (!result.ok || result.value.exitCode !== 0)
    return failure("STORAGE_FAILED", "Failed to construct recorded commit.");
  return { ok: true, value: result.value.stdout.trim() };
}

export async function verifyCommit(options: {
  draftDir: string;
  oid: string;
  intent: FinalizationIntent;
}): Promise<Outcome<void>> {
  const result = await git(options.draftDir, [
    "show",
    "-s",
    "--format=%T%n%P",
    options.oid,
  ]);
  if (
    !result.ok ||
    result.value.exitCode !== 0 ||
    result.value.stdout.trim() !==
      `${options.intent.tree.oid}\n${options.intent.parent.oid}`
  )
    return failure(
      "EVIDENCE_INVALID",
      "Commit does not have the approved tree and single parent.",
    );
  return { ok: true, value: undefined };
}

export async function installSessionRef(options: {
  draftDir: string;
  oid: string;
  intent: FinalizationIntent;
  requireExisting?: boolean;
}): Promise<Outcome<void>> {
  const ref = `refs/heads/quorum/${options.intent.session_id}`;
  const existing = await git(options.draftDir, [
    "show-ref",
    "--verify",
    "--hash",
    ref,
  ]);
  if (!existing.ok) return existing;
  if (existing.value.exitCode === 0) {
    return existing.value.stdout.trim() === options.oid
      ? { ok: true, value: undefined }
      : failure(
          "EVIDENCE_INVALID",
          "Session branch already points to another commit.",
        );
  }
  if (options.requireExisting)
    return failure(
      "EVIDENCE_INVALID",
      "Recorded receipt has no matching session branch.",
    );
  // Only create a missing branch; never overwrite a conflicting branch.
  const result = await git(options.draftDir, [
    "update-ref",
    ref,
    options.oid,
    "0".repeat(options.intent.tree.format === "sha1" ? 40 : 64),
  ]);
  if (!result.ok || result.value.exitCode !== 0)
    return failure("STORAGE_FAILED", "Session branch compare-and-swap failed.");
  return { ok: true, value: undefined };
}
