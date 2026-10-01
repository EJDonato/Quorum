import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { failure, type Outcome } from "../contracts/errors.js";
import type {
  RepoReadInput,
  RepoReadOutput,
  RepoSearchInput,
  RepoSearchOutput,
  SearchMatch,
} from "../contracts/tools.js";
import {
  inspectPath,
  readScopedFile,
} from "../infrastructure/workspace/scoped-read.js";
import {
  isToolAllowed,
  isPathAuthorized,
  type BrokerAuthContext,
} from "./authorizer.js";

function readablePath(path: string, context: BrokerAuthContext) {
  // Protected paths restrict mutations, not granted reads.
  return isPathAuthorized(path, { ...context, protectedPaths: [] });
}

export async function readRepoFile(options: {
  draftDir: string;
  input: RepoReadInput;
  context: BrokerAuthContext;
}): Promise<Outcome<RepoReadOutput>> {
  const allowed = isToolAllowed("repo.read", options.context);
  if (!allowed.ok) return allowed;
  const path = readablePath(options.input.path, options.context);
  if (!path.ok) return path;
  const read = await readScopedFile({
    root: options.draftDir,
    relativePath: path.value,
  });
  if (!read.ok) return read;
  const offset = options.input.offset ?? 0;
  const limit = options.input.limit ?? 100_000;
  return {
    ok: true,
    value: {
      content: read.value.slice(offset, offset + limit),
      digest: `sha256:${createHash("sha256").update(read.value).digest("hex")}`,
      truncated: offset + limit < read.value.length,
    },
  };
}

async function collectFiles(root: string, scope: string): Promise<string[]> {
  const directory = scope === ".";
  const info = directory ? null : await inspectPath(root, scope);
  if (info?.isFile()) return [scope];
  if (info && !info.isDirectory()) throw new Error("Unsupported path");
  // Revalidate the root even for an all-files grant.
  if (directory) await inspectPath(root, ".");
  const pending = [scope];
  const files: string[] = [];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of await readdir(join(root, current), {
      withFileTypes: true,
    })) {
      if (++visited > 10_000) throw new Error("Search exceeds bound");
      if (entry.name === ".git" || entry.name === ".quorum") continue;
      const path = current === "." ? entry.name : `${current}/${entry.name}`;
      const checked = await inspectPath(root, path);
      if (checked.isDirectory()) pending.push(path);
      else if (checked.isFile()) files.push(path);
      else throw new Error("Unsupported path");
    }
  }
  return files.sort();
}

export async function searchRepoFiles(options: {
  draftDir: string;
  input: RepoSearchInput;
  context: BrokerAuthContext;
}): Promise<Outcome<RepoSearchOutput>> {
  const allowed = isToolAllowed("repo.search", options.context);
  if (!allowed.ok) return allowed;
  const scopes = options.input.paths?.length
    ? options.input.paths
    : options.context.grantedPaths;
  const files = new Set<string>();
  try {
    for (const scope of scopes) {
      const path = readablePath(scope === "*" ? "." : scope, options.context);
      if (!path.ok) return path;
      for (const file of await collectFiles(options.draftDir, path.value))
        files.add(file);
    }
  } catch {
    return failure(
      "SCOPE_DENIED",
      "Search scope is linked, unavailable, or exceeds its bound.",
    );
  }
  return searchContents(options, [...files].sort());
}

async function searchContents(
  options: {
    draftDir: string;
    input: RepoSearchInput;
    context: BrokerAuthContext;
  },
  files: string[],
): Promise<Outcome<RepoSearchOutput>> {
  const matches: SearchMatch[] = [];
  for (const path of files) {
    const read = await readRepoFile({ ...options, input: { path } });
    if (!read.ok) return read;
    if (read.value.truncated)
      return failure("SCOPE_DENIED", "Search file exceeds read bound.");
    if (read.value.content.includes("\0")) continue;
    const lines = read.value.content.split("\n");
    for (const [index, text] of lines.entries()) {
      if (!text.includes(options.input.query)) continue;
      if (matches.length >= (options.input.limit ?? 50))
        return { ok: true, value: { matches, truncated: true } };
      matches.push({ path, line: index + 1, text });
    }
  }
  return { ok: true, value: { matches, truncated: false } };
}
