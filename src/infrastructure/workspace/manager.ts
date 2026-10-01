import { ensurePrivateDirectory } from "./directories.js";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { failure, type Outcome } from "../../contracts/errors.js";
import {
  opaqueId,
  schemaVersion,
  utcTimestamp,
} from "../../contracts/primitives.js";
import { createIsolatedDraft } from "../git/operations.js";

export const workspaceMetaSchema = z.strictObject({
  schema_version: schemaVersion,
  session_id: opaqueId,
  source_root: z.string().min(1),
  base_sha: z.string().min(1),
  created_at: utcTimestamp,
  owner_pid: z.number().int().positive(),
  workspace_available: z.boolean(),
});

export type WorkspaceMeta = z.infer<typeof workspaceMetaSchema>;

export interface WorkspacePaths {
  workspaceDir: string;
  draftDir: string;
  metaDir: string;
  metaFile: string;
}

export function getWorkspacePaths(
  rootDir: string,
  sessionId: string,
): WorkspacePaths {
  const workspaceDir = resolve(rootDir, ".quorum", "workspaces", sessionId);
  return {
    workspaceDir,
    draftDir: join(workspaceDir, "draft"),
    metaDir: join(workspaceDir, "meta"),
    metaFile: join(workspaceDir, "meta", "workspace.json"),
  };
}

export function validateSafeWorkspacePath(
  rootDir: string,
  targetPath: string,
): Outcome<string> {
  const resolvedRoot = resolve(rootDir);
  const resolvedTarget = resolve(targetPath);
  const rel = relative(resolvedRoot, resolvedTarget);

  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return failure("SCOPE_DENIED", "Path escapes designated workspace root.");
  }
  return { ok: true, value: resolvedTarget };
}

export async function createSessionWorkspace(options: {
  rootDir: string;
  sessionId: string;
  sourceDir: string;
  baseSha: string;
  now?: Date;
}): Promise<Outcome<WorkspacePaths>> {
  if (!opaqueId.safeParse(options.sessionId).success)
    return failure("INVALID_INPUT", "Invalid workspace session ID.");
  const paths = getWorkspacePaths(options.rootDir, options.sessionId);
  const safeCheck = validateSafeWorkspacePath(
    options.rootDir,
    paths.workspaceDir,
  );
  if (!safeCheck.ok) return safeCheck;

  try {
    await ensurePrivateDirectory(
      options.rootDir,
      `.quorum/workspaces/${options.sessionId}/meta`,
    );
    await ensurePrivateDirectory(
      options.rootDir,
      `.quorum/workspaces/${options.sessionId}/draft`,
    );

    const draftInit = await createIsolatedDraft({
      sourceDir: options.sourceDir,
      draftDir: paths.draftDir,
      baseSha: options.baseSha,
    });
    if (!draftInit.ok) return draftInit;

    const meta: WorkspaceMeta = {
      schema_version: "1.0.0",
      session_id: options.sessionId,
      source_root: resolve(options.sourceDir),
      base_sha: options.baseSha,
      created_at: (options.now ?? new Date()).toISOString(),
      owner_pid: process.pid,
      workspace_available: true,
    };

    const { writeArtifact } = await import("../storage/artifacts.js");
    const metaWrite = await writeArtifact({
      baseDir: paths.metaDir,
      relativePath: "workspace.json",
      content: JSON.stringify(meta, null, 2) + "\n",
    });
    if (!metaWrite.ok) return metaWrite;

    return { ok: true, value: paths };
  } catch {
    return failure(
      "STORAGE_FAILED",
      "Failed to create session workspace directories.",
    );
  }
}

export async function readWorkspaceMeta(
  metaFilePath: string,
): Promise<Outcome<WorkspaceMeta>> {
  try {
    const raw = await readFile(metaFilePath, "utf8");
    const parsed = workspaceMetaSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return failure(
        "EVIDENCE_INVALID",
        "Corrupted or invalid workspace metadata.",
      );
    }
    return { ok: true, value: parsed.data };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return failure("STORAGE_FAILED", "Workspace metadata does not exist.");
    }
    return failure("STORAGE_FAILED", "Unable to read workspace metadata.");
  }
}

export { cleanSessionWorkspace } from "./cleanup.js";
