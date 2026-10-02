import { failure, type Outcome } from "../../contracts/errors.js";
import type { PreparationSnapshot } from "../../contracts/test-specification.js";
import { repositoryPath, gitObject } from "../../contracts/primitives.js";
import { pathWithin } from "../../domain/plans.js";
import { runProcess } from "../process/runner.js";
import { inspectPath } from "../workspace/scoped-read.js";

// This first QA workflow permits new tests only; modifications/deletions need a separate protected-change protocol.
export async function verifyQaOverlay(options: {
  repository: string;
  baseline: PreparationSnapshot;
  expectedRed: PreparationSnapshot;
  testPaths: string[];
}): Promise<Outcome<void>> {
  try {
    await inspectPath(options.repository, ".git");
  } catch {
    return failure(
      "SCOPE_DENIED",
      "QA overlay repository is unavailable or linked.",
    );
  }
  const result = await runProcess({
    executable: "git",
    args: [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "diff-tree",
      "--no-commit-id",
      "--no-renames",
      "--name-status",
      "-r",
      "-z",
      options.baseline.identity.tree.oid,
      options.expectedRed.identity.tree.oid,
      "--",
    ],
    cwd: options.repository,
    timeoutMs: 10_000,
    maxOutputBytes: 2_000_000,
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1",
    },
  });
  if (!result.ok) return result;
  if (result.value.exitCode !== 0)
    return failure("EVIDENCE_INVALID", "QA tree comparison failed.");
  return validateQaChanges(result.value.stdout, options.testPaths);
}

function validateQaChanges(stdout: string, testPaths: string[]): Outcome<void> {
  const parts = stdout.split("\0");
  if (parts.pop() !== "" || parts.length % 2 !== 0 || parts.length > 20_000)
    return failure(
      "EVIDENCE_INVALID",
      "Malformed or oversized QA tree comparison.",
    );
  for (let index = 0; index < parts.length; index += 2) {
    const path = parts[index + 1] ?? "";
    if (
      parts[index] !== "A" ||
      !repositoryPath.safeParse(path).success ||
      !testPaths.some((root) => pathWithin(path, root)) ||
      path
        .split("/")
        .some((part) =>
          [".git", ".quorum", ".gitmodules"].includes(part.toLowerCase()),
        )
    )
      return failure(
        "SCOPE_DENIED",
        "QA overlay may only add tests within host grants.",
      );
  }
  return { ok: true, value: undefined };
}

export async function readBaselineTree(options: {
  repository: string;
  baseCommit: PreparationSnapshot["identity"]["tree"];
}) {
  if (!gitObject.safeParse(options.baseCommit).success)
    return failure("INVALID_INPUT", "Invalid workflow base identity.");
  const result = await runProcess({
    executable: "git",
    args: [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "rev-parse",
      "--verify",
      `${options.baseCommit.oid}^{tree}`,
    ],
    cwd: options.repository,
    timeoutMs: 10_000,
    maxOutputBytes: 128,
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1",
    },
  });
  if (!result.ok) return result;
  const parsed = gitObject.safeParse({
    format: options.baseCommit.format,
    oid: result.value.stdout.trim(),
  });
  return result.value.exitCode === 0 && parsed.success
    ? { ok: true as const, value: parsed.data }
    : failure("EVIDENCE_INVALID", "Workflow base tree is unavailable.");
}
