import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { failure, type Outcome } from "../../contracts/errors.js";
import { repositoryPath } from "../../contracts/primitives.js";

export function computeSha256(content: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(content);
  return `sha256:${hash.digest("hex")}`;
}

export function validateSafeRelativePath(
  baseDir: string,
  relativePath: string,
): Outcome<string> {
  const pathParsed = repositoryPath.safeParse(relativePath);
  if (!pathParsed.success) {
    return failure("INVALID_INPUT", "Artifact path is malformed or invalid.");
  }
  const resolved = resolve(baseDir, relativePath);
  const resolvedBase = resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + "/") && resolved !== resolvedBase) {
    return failure("INVALID_INPUT", "Artifact path escapes base directory.");
  }
  return { ok: true, value: resolved };
}

async function syncDirectory(dirPath: string): Promise<void> {
  const handle = await open(dirPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeArtifact(options: {
  baseDir: string;
  relativePath: string;
  content: string | Buffer;
}): Promise<
  Outcome<{ relativePath: string; digest: string; fullPath: string }>
> {
  const safe = validateSafeRelativePath(options.baseDir, options.relativePath);
  if (!safe.ok) return safe;

  const targetPath = safe.value;
  const parentDir = dirname(targetPath);
  const digest = computeSha256(options.content);
  const tempPath = `${targetPath}.tmp.${randomUUID().replaceAll("-", "")}`;

  try {
    await mkdir(parentDir, { recursive: true });
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(options.content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(tempPath, 0o444);
    await rename(tempPath, targetPath);
    await syncDirectory(parentDir);
    return {
      ok: true,
      value: {
        relativePath: options.relativePath,
        digest,
        fullPath: targetPath,
      },
    };
  } catch (error) {
    return failure(
      "STORAGE_FAILED",
      `Failed to write immutable artifact: ${(error as Error).message}`,
    );
  }
}

export async function readArtifact(options: {
  baseDir: string;
  relativePath: string;
  expectedDigest?: string;
}): Promise<Outcome<{ content: Buffer; digest: string }>> {
  const safe = validateSafeRelativePath(options.baseDir, options.relativePath);
  if (!safe.ok) return safe;

  try {
    const content = await readFile(safe.value);
    const digest = computeSha256(content);
    if (
      options.expectedDigest !== undefined &&
      digest !== options.expectedDigest
    ) {
      return failure(
        "EVIDENCE_INVALID",
        `Artifact digest mismatch for ${options.relativePath}`,
      );
    }
    return { ok: true, value: { content, digest } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return failure(
        "STORAGE_FAILED",
        `Artifact not found: ${options.relativePath}`,
      );
    }
    return failure(
      "STORAGE_FAILED",
      `Failed to read artifact: ${(error as Error).message}`,
    );
  }
}
