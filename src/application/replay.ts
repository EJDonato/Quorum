import { eventSchema } from "../contracts/events.js";
import { failure, type Outcome } from "../contracts/errors.js";
import { sessionStateSchema, type SessionState } from "../contracts/session.js";
import { transition } from "../domain/transitions.js";

export interface ReplayPorts {
  digest: (value: unknown) => Outcome<string>;
}

export function replay(options: {
  initial: unknown;
  events: readonly unknown[];
  ports: ReplayPorts;
}): Outcome<SessionState> {
  const initial = sessionStateSchema.safeParse(options.initial);
  if (!initial.success || initial.data.state_sequence !== 0)
    return failure(
      "INVALID_INPUT",
      "Replay requires a validated initial session at sequence zero.",
    );
  let session = initial.data;
  let previousDigest: string | null = null;
  const ids = new Set<string>();
  for (const rawEvent of options.events) {
    const event = eventSchema.safeParse(rawEvent);
    if (!event.success)
      return failure(
        "EVIDENCE_INVALID",
        "Malformed or unsupported journal event.",
      );
    if (
      event.data.session_id !== session.session_id ||
      event.data.sequence !== session.state_sequence + 1 ||
      event.data.previous_digest !== previousDigest ||
      ids.has(event.data.event_id)
    ) {
      return failure(
        "EVIDENCE_INVALID",
        "Journal identity, sequence, or hash chain mismatch.",
      );
    }
    const next = transition(session, event.data.payload);
    if (!next.ok) return next;
    const hash = options.ports.digest(event.data);
    if (!hash.ok) return hash;
    ids.add(event.data.event_id);
    session = next.value;
    previousDigest = hash.value;
  }
  return { ok: true, value: session };
}
