import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { failure, type Outcome } from "../../contracts/errors.js";
import { opaqueId } from "../../contracts/primitives.js";
import {
  acquireCommandLock,
  readSessionLease,
  releaseCommandLock,
} from "../storage/locks.js";
import { getWorkspacePaths, readWorkspaceMeta } from "./manager.js";
import { inspectPath } from "./scoped-read.js";

export async function cleanSessionWorkspace(options: {
  rootDir: string;
  sessionId: string;
  leaseStatus?: string;
}): Promise<Outcome<void>> {
  if (!opaqueId.safeParse(options.sessionId).success)
    return failure("INVALID_INPUT", "Invalid workspace session ID.");
  const lockPath = join(options.rootDir, ".quorum", "command.lock");
  try {
    await inspectPath(options.rootDir, ".quorum");
  } catch {
    return failure("SCOPE_DENIED", "Workspace root is unavailable or linked.");
  }
  const lock = await acquireCommandLock(lockPath, {
    sessionId: options.sessionId,
  });
  if (!lock.ok) return lock;
  const result = await cleanOwnedDraft(options);
  const released = await releaseCommandLock(lockPath, lock.value.nonce);
  return released.ok ? result : released;
}

async function cleanOwnedDraft(options: {
  rootDir: string;
  sessionId: string;
  leaseStatus?: string;
}): Promise<Outcome<void>> {
  const lease = await readSessionLease(
    join(options.rootDir, ".quorum", "lease.json"),
  );
  if (!lease.ok) return lease;
  // Caller-supplied status can restrict cleanup but cannot authorize deletion.
  if (lease.value?.status === "ACTIVE" || options.leaseStatus === "ACTIVE")
    return failure(
      "LOCKED",
      "Cannot clean while a repository session is active.",
    );
  const paths = getWorkspacePaths(options.rootDir, options.sessionId);
  try {
    await inspectPath(
      options.rootDir,
      `.quorum/workspaces/${options.sessionId}/meta/workspace.json`,
    );
    const meta = await readWorkspaceMeta(paths.metaFile);
    if (!meta.ok) return meta;
    if (
      meta.value.session_id !== options.sessionId ||
      !meta.value.workspace_available ||
      resolve(meta.value.source_root) === resolve(paths.draftDir)
    )
      return failure(
        "SCOPE_DENIED",
        "Workspace ownership metadata does not match.",
      );
    const rel = `.quorum/workspaces/${options.sessionId}/draft`;
    const before = await inspectPath(options.rootDir, rel);
    if (!before.isDirectory())
      return failure("SCOPE_DENIED", "Draft is not an owned directory.");
    const quarantine = `cleanup-${randomUUID()}`;
    const target = join(paths.workspaceDir, quarantine);
    await rename(paths.draftDir, target);
    const moved = await inspectPath(
      options.rootDir,
      `.quorum/workspaces/${options.sessionId}/${quarantine}`,
    );
    if (moved.dev !== before.dev || moved.ino !== before.ino)
      return failure(
        "SCOPE_DENIED",
        "Draft changed during cleanup; quarantined content preserved.",
      );
    await rm(target, { recursive: true });
    return { ok: true, value: undefined };
  } catch {
    return failure(
      "SCOPE_DENIED",
      "Cleanup requires intact ownership and unlinked workspace paths.",
    );
  }
}
