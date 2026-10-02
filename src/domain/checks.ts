import type { CheckResult } from "../contracts/checks.js";

export function checkPassed(check: CheckResult): boolean {
  if (
    check.execution_status !== "SUCCEEDED" ||
    check.exit_code !== 0 ||
    !check.report_complete ||
    check.error_count !== 0 ||
    check.failure_class !== null ||
    (check.failure_ids?.length ?? 0) > 0
  )
    return false;
  if (
    check.kind === "test" &&
    (check.discovered_tests === null || check.discovered_tests === 0)
  )
    return false;
  if (
    check.fuzz !== null &&
    check.fuzz.cases_completed < check.fuzz.cases_required
  )
    return false;
  return true;
}

export function expectedRed(check: CheckResult): boolean {
  return (
    check.input.phase === "expected_red" &&
    check.execution_status === "SUCCEEDED" &&
    check.exit_code !== null &&
    check.exit_code !== 0 &&
    check.report_complete &&
    ((check.kind === "test" && check.failure_class === "behavioral") ||
      (check.kind === "typecheck" && check.failure_class === "compiler")) &&
    (check.kind !== "test" ||
      (check.discovered_tests !== null && check.discovered_tests > 0))
  );
}
