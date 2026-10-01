import { isAbsolute, normalize } from "node:path";
import { failure, type Outcome } from "../contracts/errors.js";

export type RoleName =
  "PLANNER" | "QA" | "DEVELOPER" | "SECURITY" | "ARCHITECT" | "REFACTOR";

export type StagePhase =
  "PLANNING" | "DESIGN_REVIEW" | "TEST_SPEC" | "IMPLEMENTING" | "REVIEWING";

export type BrokerToolName =
  | "repo.read"
  | "repo.search"
  | "artifact.read"
  | "draft.apply_patch"
  | "checks.run"
  | "role.submit"
  | "scope.request";

export interface BrokerAuthContext {
  role: RoleName;
  phase: StagePhase;
  grantedPaths: string[];
  protectedPaths: string[];
}

const READ_ONLY_TOOLS = new Set<BrokerToolName>([
  "repo.read",
  "repo.search",
  "artifact.read",
  "scope.request",
  "role.submit",
]);

export function isToolAllowed(
  tool: BrokerToolName,
  context: BrokerAuthContext,
): Outcome<void> {
  if (READ_ONLY_TOOLS.has(tool)) {
    return { ok: true, value: undefined };
  }

  if (tool === "draft.apply_patch") {
    if (context.phase === "TEST_SPEC" && context.role === "QA") {
      return { ok: true, value: undefined };
    }
    if (
      context.phase === "IMPLEMENTING" &&
      (context.role === "DEVELOPER" || context.role === "REFACTOR")
    ) {
      return { ok: true, value: undefined };
    }
    return failure(
      "SCOPE_DENIED",
      `Role ${context.role} in phase ${context.phase} is not authorized to apply patches.`,
    );
  }

  if (tool === "checks.run") {
    if (
      (context.phase === "TEST_SPEC" && context.role === "QA") ||
      (context.phase === "IMPLEMENTING" &&
        (context.role === "DEVELOPER" || context.role === "REFACTOR"))
    ) {
      return { ok: true, value: undefined };
    }
    return failure(
      "SCOPE_DENIED",
      `Role ${context.role} in phase ${context.phase} is not authorized to run checks.`,
    );
  }

  return failure("SCOPE_DENIED", `Tool ${tool} is not permitted.`);
}

export function validateSafeRelativePath(path: string): Outcome<string> {
  if (isAbsolute(path)) {
    return failure("SCOPE_DENIED", "Absolute paths are not permitted.");
  }
  const clean = normalize(path).replaceAll("\\", "/");
  if (clean === ".." || clean.startsWith("../") || clean.includes("/../")) {
    return failure("SCOPE_DENIED", "Path traversal is not permitted.");
  }
  if (clean.startsWith("./")) {
    return { ok: true, value: clean.slice(2) };
  }
  return { ok: true, value: clean };
}

function matchesPrefixOrExact(path: string, pattern: string): boolean {
  const normPattern = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  return (
    path === normPattern ||
    path.startsWith(normPattern + "/") ||
    pattern === "*" ||
    pattern === "."
  );
}

export function isPathAuthorized(
  rawPath: string,
  context: BrokerAuthContext,
): Outcome<string> {
  const safe = validateSafeRelativePath(rawPath);
  if (!safe.ok) return safe;
  const path = safe.value;

  if (
    path === ".git" ||
    path.startsWith(".git/") ||
    path === ".quorum" ||
    path.startsWith(".quorum/")
  ) {
    return failure(
      "SCOPE_DENIED",
      `Access to reserved metadata path ${path} is denied.`,
    );
  }

  for (const prot of context.protectedPaths) {
    if (matchesPrefixOrExact(path, prot)) {
      return failure(
        "SCOPE_DENIED",
        `Path ${path} is protected from modification.`,
      );
    }
  }

  const isGranted = context.grantedPaths.some((grant) =>
    matchesPrefixOrExact(path, grant),
  );
  if (!isGranted) {
    return failure(
      "SCOPE_DENIED",
      `Path ${path} is outside granted paths: [${context.grantedPaths.join(", ")}].`,
    );
  }

  return { ok: true, value: path };
}
