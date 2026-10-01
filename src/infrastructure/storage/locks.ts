import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { failure, type Outcome } from "../../contracts/errors.js";
import {
  opaqueId,
  schemaVersion,
  utcTimestamp,
} from "../../contracts/primitives.js";
import { isProcessAlive } from "../process/liveness.js";

export const lockSchema = z.strictObject({
  schema_version: schemaVersion,
  session_id: opaqueId,
  holder_pid: z.number().int().positive(),
  nonce: opaqueId,
  created_at: utcTimestamp,
  expires_at: utcTimestamp,
});

export const leaseSchema = z.strictObject({
  schema_version: schemaVersion,
  session_id: opaqueId,
  acquired_at: utcTimestamp,
  status: z.enum(["ACTIVE", "BLOCKED", "CANCELLED", "COMPLETED", "ABORTED"]),
});

export type LockRecord = z.infer<typeof lockSchema>;
export type LeaseRecord = z.infer<typeof leaseSchema>;

async function syncParentDirectory(filePath: string): Promise<void> {
  const dirHandle = await open(dirname(filePath), "r");
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}

async function writeDurableFile(
  path: string,
  content: string,
  mode: number,
): Promise<Outcome<void>> {
  try {
    const handle = await open(path, "wx", mode);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncParentDirectory(path);
    return { ok: true, value: undefined };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return failure("LOCKED", "Target file already exists.");
    }
    return failure("STORAGE_FAILED", "Failed to write lock or lease file.");
  }
}

export async function readLockFile(path: string): Promise<Outcome<LockRecord>> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = lockSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return failure("EVIDENCE_INVALID", "Corrupt or invalid lock record.");
    }
    return { ok: true, value: parsed.data };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return failure("STORAGE_FAILED", "Lock file does not exist.");
    }
    return failure("STORAGE_FAILED", "Unable to read lock file.");
  }
}

async function resolveContendedLock(
  lockPath: string,
  record: LockRecord,
): Promise<Outcome<{ nonce: string }>> {
  const existing = await readLockFile(lockPath);
  if (!existing.ok) {
    return failure("LOCKED", "Command lock is held or malformed.");
  }

  const holderAlive = isProcessAlive(existing.value.holder_pid);
  if (holderAlive) {
    return failure(
      "LOCKED",
      `Active process ${existing.value.holder_pid} holds session lock.`,
    );
  }

  try {
    await unlink(lockPath);
    await syncParentDirectory(lockPath);
  } catch {
    return failure("LOCKED", "Failed to clear stale lock.");
  }

  const secondWrite = await writeDurableFile(
    lockPath,
    JSON.stringify(record, null, 2) + "\n",
    0o600,
  );
  if (!secondWrite.ok)
    return failure("LOCKED", "Contended lock acquisition failed.");
  return { ok: true, value: { nonce: record.nonce } };
}

export async function acquireCommandLock(
  lockPath: string,
  options: {
    sessionId: string;
    ttlMs?: number;
    now?: Date;
  },
): Promise<Outcome<{ nonce: string }>> {
  const now = options.now ?? new Date();
  const ttl = options.ttlMs ?? 30_000;
  const expiresAt = new Date(now.getTime() + ttl);
  const nonce = randomUUID().replaceAll("-", "");

  const record: LockRecord = {
    schema_version: "1.0.0",
    session_id: options.sessionId,
    holder_pid: process.pid,
    nonce,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  const initialWrite = await writeDurableFile(
    lockPath,
    JSON.stringify(record, null, 2) + "\n",
    0o600,
  );
  if (initialWrite.ok) return { ok: true, value: { nonce } };

  return resolveContendedLock(lockPath, record);
}

export async function releaseCommandLock(
  lockPath: string,
  nonce: string,
): Promise<Outcome<void>> {
  const current = await readLockFile(lockPath);
  if (!current.ok) {
    return current.error.message === "Lock file does not exist."
      ? { ok: true, value: undefined }
      : current;
  }
  if (current.value.nonce !== nonce) {
    return failure("LOCKED", "Cannot release lock held by another nonce.");
  }
  try {
    await unlink(lockPath);
    await syncParentDirectory(lockPath);
    return { ok: true, value: undefined };
  } catch {
    return failure("STORAGE_FAILED", "Failed to unlink command lock.");
  }
}

export async function acquireSessionLease(
  leasePath: string,
  sessionId: string,
  options?: { now?: Date },
): Promise<Outcome<void>> {
  const now = options?.now ?? new Date();
  const lease: LeaseRecord = {
    schema_version: "1.0.0",
    session_id: sessionId,
    acquired_at: now.toISOString(),
    status: "ACTIVE",
  };
  const write = await writeDurableFile(
    leasePath,
    JSON.stringify(lease, null, 2) + "\n",
    0o600,
  );
  if (!write.ok)
    return failure("LOCKED", "Repository is leased to another session.");
  return { ok: true, value: undefined };
}

export async function readSessionLease(
  leasePath: string,
): Promise<Outcome<LeaseRecord | null>> {
  try {
    const raw = await readFile(leasePath, "utf8");
    const parsed = leaseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return failure("EVIDENCE_INVALID", "Corrupt session lease record.");
    }
    return { ok: true, value: parsed.data };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: null };
    }
    return failure("STORAGE_FAILED", "Unable to read lease file.");
  }
}

export async function updateSessionLeaseStatus(
  leasePath: string,
  sessionId: string,
  status: LeaseRecord["status"],
): Promise<Outcome<void>> {
  const existing = await readSessionLease(leasePath);
  if (!existing.ok) return existing;
  if (existing.value === null || existing.value.session_id !== sessionId) {
    return failure("LOCKED", "No active lease for this session ID.");
  }
  try {
    await unlink(leasePath);
    return writeDurableFile(
      leasePath,
      JSON.stringify({ ...existing.value, status }, null, 2) + "\n",
      0o600,
    );
  } catch {
    return failure("STORAGE_FAILED", "Failed to update lease record.");
  }
}

export async function releaseSessionLease(
  leasePath: string,
  sessionId: string,
): Promise<Outcome<void>> {
  const existing = await readSessionLease(leasePath);
  if (!existing.ok) return existing;
  if (existing.value === null) return { ok: true, value: undefined };
  if (existing.value.session_id !== sessionId) {
    return failure("LOCKED", "Cannot release lease owned by another session.");
  }
  try {
    await unlink(leasePath);
    await syncParentDirectory(leasePath);
    return { ok: true, value: undefined };
  } catch {
    return failure("STORAGE_FAILED", "Failed to unlink session lease.");
  }
}
