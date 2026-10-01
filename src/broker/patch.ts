import { createHash, randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failure, type Outcome } from "../contracts/errors.js";
import type { DraftApplyPatchOutput } from "../contracts/tools.js";
import { runProcess } from "../infrastructure/process/runner.js";
import {
  isPathAuthorized,
  isToolAllowed,
  type BrokerAuthContext,
} from "./authorizer.js";

const ISOLATED_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ATTR_NOSYSTEM: "1",
};

export async function computeDraftDigest(
  draftDir: string,
): Promise<Outcome<string>> {
  const add = await runProcess({
    executable: "git",
    args: ["add", "-A"],
    cwd: draftDir,
    env: ISOLATED_ENV,
  });
  if (!add.ok || add.value.exitCode !== 0) {
    return failure("STORAGE_FAILED", "Failed to stage draft workspace files.");
  }

  const writeTree = await runProcess({
    executable: "git",
    args: ["write-tree"],
    cwd: draftDir,
    env: ISOLATED_ENV,
  });
  if (!writeTree.ok || writeTree.value.exitCode !== 0) {
    return failure("STORAGE_FAILED", "Failed to write draft tree object.");
  }

  const treeOid = writeTree.value.stdout.trim();
  const hex = createHash("sha256").update(treeOid).digest("hex");
  return { ok: true, value: `sha256:${hex}` };
}

function cleanDiffPath(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("a/") || cleaned.startsWith("b/")) {
    cleaned = cleaned.slice(2);
  }
  return cleaned;
}

export function extractPatchPaths(patch: string): Outcome<string[]> {
  const lines = patch.split("\n");
  const paths = new Set<string>();

  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const candidate = line.slice(4).trim();
      if (candidate === "/dev/null" || candidate === "") continue;
      paths.add(cleanDiffPath(candidate));
    }
  }

  if (paths.size === 0) {
    return failure("INVALID_INPUT", "Malformed patch: no file paths found.");
  }
  return { ok: true, value: Array.from(paths) };
}

export async function applyDraftPatch(options: {
  draftDir: string;
  patch: string;
  expectedDraftDigest: string;
  context: BrokerAuthContext;
}): Promise<Outcome<DraftApplyPatchOutput>> {
  const toolCheck = isToolAllowed("draft.apply_patch", options.context);
  if (!toolCheck.ok) return toolCheck;

  const currentDigest = await computeDraftDigest(options.draftDir);
  if (!currentDigest.ok) return currentDigest;
  if (currentDigest.value !== options.expectedDraftDigest) {
    return failure(
      "STALE_INPUT",
      "Draft digest does not match expected digest.",
    );
  }

  const paths = extractPatchPaths(options.patch);
  if (!paths.ok) return paths;

  for (const path of paths.value) {
    const auth = isPathAuthorized(path, options.context);
    if (!auth.ok) return auth;
  }

  return applyPatchWithTempFile(options.draftDir, options.patch, paths.value);
}

async function applyPatchWithTempFile(
  draftDir: string,
  patch: string,
  changedPaths: string[],
): Promise<Outcome<DraftApplyPatchOutput>> {
  const patchFile = join(tmpdir(), `.quorum-patch-${randomUUID()}.diff`);
  try {
    await writeFile(patchFile, patch, { mode: 0o600 });

    const applyCheck = await runProcess({
      executable: "git",
      args: ["apply", "--check", patchFile],
      cwd: draftDir,
      env: ISOLATED_ENV,
    });
    if (!applyCheck.ok || applyCheck.value.exitCode !== 0) {
      return failure("INVALID_INPUT", "Patch does not apply cleanly to draft.");
    }

    const apply = await runProcess({
      executable: "git",
      args: ["apply", patchFile],
      cwd: draftDir,
      env: ISOLATED_ENV,
    });
    if (!apply.ok || apply.value.exitCode !== 0) {
      return failure("INVALID_INPUT", "Failed to apply patch to draft.");
    }

    const newDigest = await computeDraftDigest(draftDir);
    if (!newDigest.ok) return newDigest;

    return {
      ok: true,
      value: {
        draft_digest: newDigest.value,
        changed_paths: changedPaths,
      },
    };
  } finally {
    try {
      await unlink(patchFile);
    } catch {
      // Ignored if file already removed
    }
  }
}
