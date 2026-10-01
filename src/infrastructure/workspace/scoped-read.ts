import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { failure, type Outcome } from "../../contracts/errors.js";

// No links at any component; recheck both pathname and descriptor before returning.
// Enforced execution additionally requires a host-owned, frozen input snapshot.
export async function inspectPath(root: string, relativePath: string) {
  const requested = resolve(root);
  if ((await lstat(requested)).isSymbolicLink()) throw new Error("Linked root");
  const base = await realpath(requested);
  if (relativePath === ".") return lstat(base);
  let path = base;
  for (const component of relativePath.split("/")) {
    if (!component || component === "." || component === "..")
      throw new Error("Invalid component");
    path = join(path, component);
    if ((await lstat(path)).isSymbolicLink()) throw new Error("Linked path");
  }
  if ((await realpath(path)) !== path) throw new Error("Replaced parent");
  return lstat(path);
}

export async function readScopedBytes(options: {
  root: string;
  relativePath: string;
}): Promise<Outcome<Buffer>> {
  try {
    const before = await inspectPath(options.root, options.relativePath);
    if (!before.isFile() || before.size > 2_000_000)
      return failure("SCOPE_DENIED", "Only bounded regular files may be read.");
    const handle = await open(
      join(options.root, options.relativePath),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino)
        return failure("SCOPE_DENIED", "File changed during scoped read.");
      const bytes = Buffer.alloc(2_000_001);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const after = await inspectPath(options.root, options.relativePath);
      if (
        bytesRead !== before.size ||
        bytesRead > 2_000_000 ||
        after.ino !== opened.ino ||
        after.dev !== opened.dev ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      )
        return failure("SCOPE_DENIED", "File changed during scoped read.");
      return { ok: true, value: bytes.subarray(0, bytesRead) };
    } finally {
      await handle.close();
    }
  } catch {
    return failure(
      "SCOPE_DENIED",
      "File is missing, linked, or outside a stable snapshot.",
    );
  }
}

export async function readScopedFile(options: {
  root: string;
  relativePath: string;
}): Promise<Outcome<string>> {
  const bytes = await readScopedBytes(options);
  return bytes.ok ? { ok: true, value: bytes.value.toString("utf8") } : bytes;
}
