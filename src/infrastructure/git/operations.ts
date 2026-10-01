import { failure, type Outcome } from "../../contracts/errors.js";
import { runProcess } from "../process/runner.js";

export interface SourceRepoInfo {
  rootPath: string;
  headSha: string;
  objectFormat: "sha1" | "sha256";
}

export interface WorktreeStatus {
  isPristine: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

const ISOLATED_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ATTR_NOSYSTEM: "1",
};

async function execGit(args: string[], cwd: string) {
  const result = await runProcess({
    executable: "git",
    args,
    cwd,
    env: ISOLATED_ENV,
  });
  if (!result.ok) return result;
  if (result.value.exitCode !== 0) {
    return failure(
      "STORAGE_FAILED",
      `git ${args[0]} failed: ${result.value.stderr}`,
    );
  }
  return { ok: true as const, value: result.value.stdout };
}

export async function readSourceRepositoryInfo(
  sourceDir: string,
): Promise<Outcome<SourceRepoInfo>> {
  const isRepo = await execGit(
    ["rev-parse", "--is-inside-work-tree"],
    sourceDir,
  );
  if (!isRepo.ok)
    return failure("INVALID_INPUT", "Source is not a Git repository.");

  const topLevel = await execGit(["rev-parse", "--show-toplevel"], sourceDir);
  if (!topLevel.ok) return topLevel;

  const head = await execGit(["rev-parse", "HEAD"], sourceDir);
  if (!head.ok)
    return failure("INVALID_INPUT", "Source repository has no commits.");

  const formatRes = await execGit(
    ["rev-parse", "--show-object-format"],
    sourceDir,
  );
  const format =
    formatRes.ok && formatRes.value.trim() === "sha256" ? "sha256" : "sha1";

  return {
    ok: true,
    value: {
      rootPath: topLevel.value.trim(),
      headSha: head.value.trim(),
      objectFormat: format,
    },
  };
}

export async function checkSourceWorktreeStatus(
  sourceDir: string,
): Promise<Outcome<WorktreeStatus>> {
  const raw = await execGit(["status", "--porcelain=v1", "-z"], sourceDir);
  if (!raw.ok) return raw;

  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  const entries = raw.value.split("\0").filter(Boolean);
  for (const entry of entries) {
    const x = entry[0];
    const y = entry[1];
    const path = entry.slice(3);
    if (x === "?" && y === "?") {
      untracked.push(path);
    } else {
      if (x !== " " && x !== "?") staged.push(path);
      if (y !== " " && y !== "?") unstaged.push(path);
    }
  }

  return {
    ok: true,
    value: {
      isPristine:
        staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
      staged,
      unstaged,
      untracked,
    },
  };
}

export async function createIsolatedDraft(options: {
  sourceDir: string;
  draftDir: string;
  baseSha: string;
}): Promise<Outcome<void>> {
  const clone = await runProcess({
    executable: "git",
    args: [
      "clone",
      "--shared",
      "--no-checkout",
      "-q",
      options.sourceDir,
      options.draftDir,
    ],
    cwd: options.sourceDir,
    env: ISOLATED_ENV,
  });
  if (!clone.ok || clone.value.exitCode !== 0) {
    return failure(
      "STORAGE_FAILED",
      "Failed to clone repository into draft workspace.",
    );
  }

  const noHooks = await execGit(
    ["config", "core.hooksPath", "/dev/null"],
    options.draftDir,
  );
  if (!noHooks.ok) return noHooks;

  const noAdvice = await execGit(
    ["config", "advice.detachedHead", "false"],
    options.draftDir,
  );
  if (!noAdvice.ok) return noAdvice;

  const checkout = await execGit(
    ["checkout", "-f", "-q", options.baseSha],
    options.draftDir,
  );
  if (!checkout.ok) {
    return failure(
      "STORAGE_FAILED",
      `Failed to checkout base ${options.baseSha} in draft.`,
    );
  }

  return { ok: true, value: undefined };
}

export async function writeDraftTree(
  draftDir: string,
): Promise<Outcome<{ treeOid: string }>> {
  const add = await execGit(["add", "-A"], draftDir);
  if (!add.ok) return add;

  const writeTree = await execGit(["write-tree"], draftDir);
  if (!writeTree.ok) return writeTree;

  return { ok: true, value: { treeOid: writeTree.value.trim() } };
}

export async function computeDraftDiff(options: {
  draftDir: string;
  baseSha: string;
}): Promise<Outcome<string>> {
  const add = await execGit(["add", "-A"], options.draftDir);
  if (!add.ok) return add;

  const diff = await execGit(
    ["diff", "--cached", options.baseSha],
    options.draftDir,
  );
  if (!diff.ok) return diff;

  return { ok: true, value: diff.value };
}
