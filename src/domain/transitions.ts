import {
  transitionInputSchema,
  type TransitionInput,
} from "../contracts/events.js";
import { failure, type Outcome } from "../contracts/errors.js";
import {
  sessionStateSchema,
  type SessionState,
  type Stage,
} from "../contracts/session.js";
import { chargeActiveTime, chargeRepair, reserveTokens } from "./budgets.js";

const stageOrder: readonly Stage[] = [
  "PREFLIGHT",
  "PLANNING",
  "DESIGN_REVIEW",
  "TEST_SPEC",
  "IMPLEMENTING",
  "VALIDATING",
  "REVIEWING",
  "APPROVED",
  "FINALIZING",
  "COMPLETED",
];
const paused: readonly Stage[] = ["BLOCKED", "CANCELLED"];

function changed(
  session: SessionState,
  patch: Partial<SessionState>,
): Outcome<SessionState> {
  const parsed = sessionStateSchema.safeParse({
    ...session,
    ...patch,
    state_sequence: session.state_sequence + 1,
  });
  if (!parsed.success)
    return failure("INVALID_INPUT", "Resulting session violates its schema.");
  return { ok: true, value: parsed.data };
}

function advance(
  session: SessionState,
  event: TransitionInput,
): Outcome<SessionState> {
  switch (event.type) {
    case "PREFLIGHT_COMPLETED":
      if (session.state === "PREFLIGHT")
        return changed(session, { state: "PLANNING" });
      break;
    case "PLAN_ACCEPTED":
      if (session.state === "PLANNING")
        return changed(session, {
          state: event.design_required ? "DESIGN_REVIEW" : "TEST_SPEC",
        });
      break;
    case "DESIGN_CLEARED":
      if (session.state === "DESIGN_REVIEW")
        return changed(session, { state: "TEST_SPEC" });
      break;
    case "TEST_SPEC_ACCEPTED":
      if (session.state === "TEST_SPEC")
        return changed(session, { state: "IMPLEMENTING" });
      break;
    case "CANDIDATE_FROZEN":
      if (session.state === "IMPLEMENTING")
        return changed(session, {
          state: "VALIDATING",
          current_candidate_id: event.candidate_id,
        });
      break;
    case "CHECKS_COMPLETED":
      if (session.state === "VALIDATING")
        return changed(session, { state: "REVIEWING" });
      break;
    default:
      break;
  }
  return failure(
    "INVALID_INPUT",
    `Event ${event.type} is not allowed in ${session.state}.`,
  );
}

function repair(
  session: SessionState,
  event: Extract<TransitionInput, { type: "REPAIR_REQUESTED" }>,
): Outcome<SessionState> {
  if (
    session.state === "PREFLIGHT" ||
    paused.includes(session.state) ||
    stageOrder.indexOf(event.stage) > stageOrder.indexOf(session.state)
  ) {
    return failure(
      "INVALID_INPUT",
      "Repair must return an active session to its current or an earlier stage.",
    );
  }
  const budget = chargeRepair(session, event.stage);
  if (!budget.ok)
    return changed(session, {
      state: "BLOCKED",
      blocking_reason: budget.error.message,
    });
  return changed(session, {
    state: event.stage,
    budget: budget.value,
    current_candidate_id: null,
    blocking_reason: null,
  });
}

function account(
  session: SessionState,
  event: Extract<
    TransitionInput,
    { type: "RESERVE_TOKENS" | "CHARGE_ACTIVE_TIME" }
  >,
): Outcome<SessionState> {
  if (paused.includes(session.state) || session.state === "APPROVED")
    return failure(
      "INVALID_INPUT",
      "Paused sessions cannot schedule active work.",
    );
  if (
    event.type === "RESERVE_TOKENS" &&
    ![
      "PLANNING",
      "DESIGN_REVIEW",
      "TEST_SPEC",
      "IMPLEMENTING",
      "REVIEWING",
    ].includes(session.state)
  ) {
    return failure(
      "INVALID_INPUT",
      "This stage does not dispatch role invocations.",
    );
  }
  const budget =
    event.type === "RESERVE_TOKENS"
      ? reserveTokens(session, event.tokens)
      : chargeActiveTime(session, event.elapsed_ms);
  if (!budget.ok) {
    const ledger =
      event.type === "CHARGE_ACTIVE_TIME"
        ? {
            ...session.budget,
            active_elapsed_ms: session.limits.active_session_ms,
          }
        : session.budget;
    return changed(session, {
      state: "BLOCKED",
      blocking_reason: budget.error.message,
      budget: ledger,
    });
  }
  return changed(session, { budget: budget.value });
}

function applyInput(
  session: SessionState,
  event: TransitionInput,
): Outcome<SessionState> {
  if (event.type === "ABORT") return changed(session, { state: "ABORTED" });
  if (event.type === "BLOCK" || event.type === "CANCEL") {
    return changed(session, {
      state: event.type === "BLOCK" ? "BLOCKED" : "CANCELLED",
      blocking_reason: event.reason,
    });
  }
  if (event.type === "RESUME") {
    if (!paused.includes(session.state))
      return failure(
        "INVALID_INPUT",
        "Only blocked or cancelled sessions can resume.",
      );
    // Until input reconciliation exists, restarting planning is the only safe route.
    if (event.stage !== "PLANNING")
      return failure(
        "CAPABILITY_MISSING",
        "Resuming later stages requires input and evidence reconciliation.",
      );
    if (
      session.budget.tokens_charged >= session.limits.model_tokens ||
      session.budget.active_elapsed_ms >= session.limits.active_session_ms ||
      session.budget.repairs_total >= session.limits.repairs_total ||
      session.budget.repairs_by_stage.PLANNING >=
        session.limits.repairs_per_stage
    ) {
      return failure(
        "BUDGET_EXHAUSTED",
        "Increase the exhausted budget explicitly before resuming.",
      );
    }
    return changed(session, {
      state: "PLANNING",
      input_digest: event.input_digest,
      current_candidate_id: null,
      blocking_reason: null,
    });
  }
  if (event.type === "REPAIR_REQUESTED") return repair(session, event);
  if (event.type === "RESERVE_TOKENS" || event.type === "CHARGE_ACTIVE_TIME")
    return account(session, event);
  return advance(session, event);
}

// Host-only reducer: these events are never role tools or public authorization.
// Approval/finalization events remain unavailable until evidence evaluation exists.
export function transition(
  rawSession: unknown,
  rawInput: unknown,
): Outcome<SessionState> {
  const session = sessionStateSchema.safeParse(rawSession);
  const event = transitionInputSchema.safeParse(rawInput);
  if (!session.success || !event.success)
    return failure("INVALID_INPUT", "Invalid session or transition input.");
  if (["ABORTED", "COMPLETED"].includes(session.data.state))
    return failure("INVALID_INPUT", "Terminal sessions cannot transition.");
  if (session.data.state === "FINALIZING")
    return failure(
      "CAPABILITY_MISSING",
      "Finalization transaction reconciliation is not implemented.",
    );
  return applyInput(session.data, event.data);
}
