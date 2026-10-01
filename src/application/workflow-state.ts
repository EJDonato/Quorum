import type { TransitionInput } from "../contracts/events.js";
import type { WorkflowContext } from "./session-init.js";
import {
  recordSessionTransition,
  loadOrReconstructState,
} from "./session-control.js";

export function advanceWorkflow(
  ctx: WorkflowContext,
  payload: TransitionInput,
) {
  return recordSessionTransition({
    sessionDir: ctx.sessionDir,
    initial: ctx.initial,
    payload,
    ports: ctx.ports,
  });
}

export function readWorkflowState(ctx: WorkflowContext) {
  return loadOrReconstructState({
    sessionDir: ctx.sessionDir,
    initial: ctx.initial,
    ports: ctx.ports,
  });
}
