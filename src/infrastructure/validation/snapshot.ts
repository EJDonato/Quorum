import { execFile } from "node:child_process";
import { mkdir, chmod, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { failure, type Outcome } from "../../contracts/errors.js";
import { repositoryPath, gitObject } from "../../contracts/primitives.js";
import { inspectPath } from "../workspace/scoped-read.js";

function git(options: {
  repository: string;
  args: string[];
  maxBytes: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        ...options.args,
      ],
      {
        cwd: options.repository,
        timeout: 10_000,
        maxBuffer: options.maxBytes,
        encoding: "buffer",
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_NO_REPLACE_OBJECTS: "1",
        },
      },
      (error, stdout) =>
        error
          ? reject(new Error("Snapshot Git operation failed"))
          : resolve(stdout),
    );
  });
}

export async function exportCheckSnapshot(options: {
  repository: string;
  tree: { format: "sha1" | "sha256"; oid: string };
  destination: string;
  deadlineMs?: number;
  signal?: AbortSignal;
}): Promise<Outcome<void>> {
  if (!gitObject.safeParse(options.tree).success)
    return failure("INVALID_INPUT", "Invalid frozen tree identity.");
  try {
    await inspectPath(options.repository, ".git");
    const verified = await verifyTree(options);
    if (!verified.ok) return verified;
    const listing = await git({
      repository: options.repository,
      args: ["ls-tree", "-rz", options.tree.oid],
      maxBytes: 2_000_000,
    });
    if (!Buffer.from(listing.toString("utf8"), "utf8").equals(listing))
      return failure("SCOPE_DENIED", "Snapshot paths must be valid UTF-8.");
    const entries = listing.toString("utf8").split("\0").filter(Boolean);
    if (entries.length > 10_000)
      return failure("SCOPE_DENIED", "Snapshot file limit exceeded.");
    const seen = new Map<string, string>();
    let total = 0;
    await chmod(options.destination, 0o755);
    for (const entry of entries) {
      if (options.signal?.aborted)
        return failure("CANCELLED", "Snapshot export cancelled.");
      if (options.deadlineMs !== undefined && Date.now() >= options.deadlineMs)
        return failure(
          "BUDGET_EXHAUSTED",
          "Check deadline expired during snapshot export.",
        );
      const copied = await copyBlob({ ...options, entry, seen });
      if (!copied.ok) return copied;
      total += copied.value;
      if (total > 100_000_000)
        return failure("SCOPE_DENIED", "Snapshot byte limit exceeded.");
    }
    await chmod(options.destination, 0o555);
    return { ok: true, value: undefined };
  } catch {
    return failure(
      "STORAGE_FAILED",
      "Cannot materialize a bounded immutable Git snapshot.",
    );
  }
}

async function copyBlob(options: {
  repository: string;
  destination: string;
  entry: string;
  seen: Map<string, string>;
}): Promise<Outcome<number>> {
  const tab = options.entry.indexOf("\t");
  const header = options.entry.slice(0, tab).split(" ");
  const path = options.entry.slice(tab + 1);
  const parsed = repositoryPath.safeParse(path);
  if (
    !parsed.success ||
    path
      .split("/")
      .some((part) =>
        [".git", ".quorum", ".gitmodules"].includes(part.toLowerCase()),
      ) ||
    !["100644", "100755"].includes(header[0] ?? "") ||
    header[1] !== "blob" ||
    !/^[a-f0-9]{40,64}$/.test(header[2] ?? "")
  )
    return failure(
      "SCOPE_DENIED",
      "Snapshot contains unsupported links, metadata, or file modes.",
    );
  if (!claimPath(options.seen, path))
    return failure("SCOPE_DENIED", "Snapshot contains colliding paths.");
  const content = await git({
    repository: options.repository,
    args: ["cat-file", "blob", header[2] ?? ""],
    maxBytes: 10_000_000,
  });
  if (
    content
      .subarray(0, 100)
      .toString()
      .startsWith("version https://git-lfs.github.com/spec/v1")
  )
    return failure(
      "CAPABILITY_MISSING",
      "Git LFS materialization is not supported.",
    );
  const target = join(options.destination, path);
  await mkdir(dirname(target), { recursive: true, mode: 0o755 });
  await writeFile(target, content, {
    flag: "wx",
    mode: header[0] === "100755" ? 0o555 : 0o444,
  });
  return { ok: true, value: content.length };
}

async function verifyTree(options: {
  repository: string;
  tree: { format: "sha1" | "sha256"; oid: string };
}): Promise<Outcome<void>> {
  const kind = await git({
    repository: options.repository,
    args: ["cat-file", "-t", options.tree.oid],
    maxBytes: 128,
  });
  if (kind.toString().trim() !== "tree")
    return failure("EVIDENCE_INVALID", "Frozen object is not a Git tree.");
  const format = await git({
    repository: options.repository,
    args: ["rev-parse", "--show-object-format"],
    maxBytes: 128,
  });
  if (format.toString().trim() !== options.tree.format)
    return failure(
      "EVIDENCE_INVALID",
      "Repository object format differs from the recorded tree.",
    );
  return { ok: true, value: undefined };
}

function claimPath(seen: Map<string, string>, path: string): boolean {
  const parts = path.split("/");
  for (let length = 1; length <= parts.length; length++) {
    const prefix = parts.slice(0, length).join("/");
    const folded = prefix.normalize("NFC").toLowerCase();
    if (seen.has(folded) && seen.get(folded) !== prefix) return false;
    seen.set(folded, prefix);
  }
  return true;
}
