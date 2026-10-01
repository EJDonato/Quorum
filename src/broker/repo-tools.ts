import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { failure, type Outcome } from "../contracts/errors.js";
import type {
  RepoReadInput,
  RepoReadOutput,
  RepoSearchInput,
  RepoSearchOutput,
  SearchMatch,
} from "../contracts/tools.js";
import { runProcess } from "../infrastructure/process/runner.js";
import {
  isToolAllowed,
  validateSafeRelativePath,
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

export async function readRepoFile(options: {
  draftDir: string;
  input: RepoReadInput;
  context: BrokerAuthContext;
}): Promise<Outcome<RepoReadOutput>> {
  const toolCheck = isToolAllowed("repo.read", options.context);
  if (!toolCheck.ok) return toolCheck;

  const safePath = validateSafeRelativePath(options.input.path);
  if (!safePath.ok) return safePath;

  const rel = safePath.value;
  if (rel.startsWith(".git") || rel.startsWith(".quorum")) {
    return failure(
      "SCOPE_DENIED",
      `Access to reserved metadata path ${rel} is denied.`,
    );
  }

  const fullPath = join(options.draftDir, rel);
  try {
    const raw = await readFile(fullPath, "utf8");
    const digestHex = createHash("sha256").update(raw).digest("hex");
    const digest = `sha256:${digestHex}` as const;

    const offset = options.input.offset ?? 0;
    const limit = options.input.limit ?? 100_000;
    const slice = raw.slice(offset, offset + limit);
    const truncated = offset + limit < raw.length;

    return {
      ok: true,
      value: {
        content: slice,
        digest,
        truncated,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return failure("INVALID_INPUT", `File ${rel} does not exist.`);
    }
    return failure("STORAGE_FAILED", `Failed to read file ${rel}.`);
  }
}

function parseGrepLine(line: string): SearchMatch | null {
  const firstColon = line.indexOf(":");
  if (firstColon === -1) return null;
  const secondColon = line.indexOf(":", firstColon + 1);
  if (secondColon === -1) return null;

  const path = line.slice(0, firstColon);
  const lineNum = Number.parseInt(line.slice(firstColon + 1, secondColon), 10);
  if (Number.isNaN(lineNum)) return null;

  return {
    path,
    line: lineNum,
    text: line.slice(secondColon + 1),
  };
}

export async function searchRepoFiles(options: {
  draftDir: string;
  input: RepoSearchInput;
  context: BrokerAuthContext;
}): Promise<Outcome<RepoSearchOutput>> {
  const toolCheck = isToolAllowed("repo.search", options.context);
  if (!toolCheck.ok) return toolCheck;

  const limit = options.input.limit ?? 50;
  const args = [
    "grep",
    "-n",
    "-I",
    "--untracked",
    "-e",
    options.input.query,
    "--",
  ];
  if (options.input.paths && options.input.paths.length > 0) {
    for (const p of options.input.paths) {
      const valid = validateSafeRelativePath(p);
      if (!valid.ok) return valid;
      args.push(valid.value);
    }
  }

  const grepResult = await runProcess({
    executable: "git",
    args,
    cwd: options.draftDir,
    env: ISOLATED_ENV,
  });
  if (!grepResult.ok) return grepResult;

  if (grepResult.value.exitCode === 1) {
    return { ok: true, value: { matches: [], truncated: false } };
  }
  if (grepResult.value.exitCode !== 0) {
    return failure(
      "STORAGE_FAILED",
      `Search failed: ${grepResult.value.stderr}`,
    );
  }

  const lines = grepResult.value.stdout.split("\n").filter(Boolean);
  const matches: SearchMatch[] = [];
  let truncated = false;

  for (const line of lines) {
    const match = parseGrepLine(line);
    if (!match) continue;
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    matches.push(match);
  }

  return { ok: true, value: { matches, truncated } };
}
