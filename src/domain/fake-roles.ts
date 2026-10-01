import type { Motion } from "../contracts/motion.js";
import type { ReviewBody } from "../contracts/reviews.js";

export function createFakePlan(sessionId: string): Motion {
  const taskId = "task000000000000000000000001";
  const critId = "crit00000000000000000000001";
  return {
    schema_version: "1.0.0",
    session_id: sessionId,
    risk: "standard",
    fuzz_required: false,
    tasks: [
      {
        task_id: taskId,
        dependencies: [],
        authorized_paths: ["src/index.ts", "src/feature.ts"],
        criterion_ids: [critId],
      },
    ],
    acceptance_criteria: [
      {
        criterion_id: critId,
        description: "Feature outputs correct result",
        owner_task_id: taskId,
      },
    ],
  };
}

export function createFakeReviewBody(options: {
  verdict: "APPROVED" | "REJECTED";
  evidenceRef: { artifact_id: string; digest: string };
  reason?: string;
}): ReviewBody {
  if (options.verdict === "APPROVED") {
    return {
      verdict: "APPROVED",
      findings: [],
      evidence_refs: [options.evidenceRef],
    };
  }
  return {
    verdict: "REJECTED",
    findings: [
      {
        criterion_id: "crit00000000000000000000001",
        severity: "blocking",
        path: "src/index.ts",
        message: options.reason ?? "Acceptance criteria not met",
        evidence_refs: [options.evidenceRef],
      },
    ],
    evidence_refs: [options.evidenceRef],
  };
}
