import { randomUUID } from "node:crypto";
import type { Outcome } from "../contracts/errors.js";
import type { SessionEvent, TransitionInput } from "../contracts/events.js";
import type { RepairStage, SessionState } from "../contracts/session.js";
import { transition } from "../domain/transitions.js";
import type { ReplayPorts } from "./replay.js";
import {
  appendJournalEvent,
  readJournalEvents,
  rebuildSessionState,
  saveStateProjection,
} from "../infrastructure/storage/journal.js";

export interface SessionControlPorts extends ReplayPorts {
  now?: () => Date;
}

export async function loadOrReconstructState(options: {
  sessionDir: string;
  initial: SessionState;
  ports: SessionControlPorts;
}): Promise<Outcome<SessionState>> {
  return rebuildSessionState({
    sessionDir: options.sessionDir,
    initial: options.initial,
    ports: options.ports,
  });
}

export async function recordSessionTransition(options: {
  sessionDir: string;
  initial: SessionState;
  payload: TransitionInput;
  ports: SessionControlPorts;
}): Promise<Outcome<SessionState>> {
  const current = await loadOrReconstructState({
    sessionDir: options.sessionDir,
    initial: options.initial,
    ports: options.ports,
  });
  if (!current.ok) return current;

  const next = transition(current.value, options.payload);
  if (!next.ok) return next;

  const events = await readJournalEvents(options.sessionDir);
  if (!events.ok) return events;

  let previousDigest: string | null = null;
  const lastEvent = events.value.at(-1);
  if (lastEvent) {
    const hash = options.ports.digest(lastEvent);
    if (!hash.ok) return hash;
    previousDigest = hash.value;
  }

  const now = options.ports.now?.() ?? new Date();
  const event: SessionEvent = {
    schema_version: "1.0.0",
    event_id: randomUUID().replaceAll("-", ""),
    session_id: current.value.session_id,
    sequence: current.value.state_sequence + 1,
    previous_digest: previousDigest,
    timestamp: now.toISOString(),
    payload: options.payload,
  };

  const write = await appendJournalEvent(options.sessionDir, event);
  if (!write.ok) return write;

  const projection = await saveStateProjection(options.sessionDir, next.value);
  if (!projection.ok) return projection;
  return { ok: true, value: next.value };
}

export async function cancelSession(options: {
  sessionDir: string;
  initial: SessionState;
  reason: string;
  ports: SessionControlPorts;
}): Promise<Outcome<SessionState>> {
  return recordSessionTransition({
    sessionDir: options.sessionDir,
    initial: options.initial,
    payload: { type: "CANCEL", reason: options.reason },
    ports: options.ports,
  });
}

export async function abortSession(options: {
  sessionDir: string;
  initial: SessionState;
  ports: SessionControlPorts;
}): Promise<Outcome<SessionState>> {
  return recordSessionTransition({
    sessionDir: options.sessionDir,
    initial: options.initial,
    payload: { type: "ABORT" },
    ports: options.ports,
  });
}

export async function resumeSession(options: {
  sessionDir: string;
  initial: SessionState;
  stage: RepairStage;
  inputDigest: string;
  ports: SessionControlPorts;
}): Promise<Outcome<SessionState>> {
  return recordSessionTransition({
    sessionDir: options.sessionDir,
    initial: options.initial,
    payload: {
      type: "RESUME",
      stage: options.stage,
      input_digest: options.inputDigest,
    },
    ports: options.ports,
  });
}
