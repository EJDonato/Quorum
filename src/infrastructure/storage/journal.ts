import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { failure, type Outcome } from "../../contracts/errors.js";
import { eventSchema, type SessionEvent } from "../../contracts/events.js";
import {
  sessionStateSchema,
  type SessionState,
} from "../../contracts/session.js";
import { replay, type ReplayPorts } from "../../application/replay.js";

async function syncDirectory(dirPath: string): Promise<void> {
  const handle = await open(dirPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function appendJournalEvent(
  sessionDir: string,
  event: SessionEvent,
): Promise<Outcome<void>> {
  const parsed = eventSchema.safeParse(event);
  if (!parsed.success) {
    return failure(
      "INVALID_INPUT",
      "Event does not match session event schema.",
    );
  }
  const journalPath = join(sessionDir, "events.jsonl");
  const line = JSON.stringify(parsed.data) + "\n";

  try {
    await mkdir(sessionDir, { recursive: true });
    const handle = await open(journalPath, "a", 0o600);
    try {
      await handle.writeFile(line, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(sessionDir);
    return { ok: true, value: undefined };
  } catch (error) {
    return failure(
      "STORAGE_FAILED",
      `Failed to append journal event: ${(error as Error).message}`,
    );
  }
}

function parseJournalLine(
  rawLine: string,
  index: number,
  isLastLine: boolean,
): Outcome<SessionEvent | null> {
  try {
    const parsedJson: unknown = JSON.parse(rawLine);
    const validated = eventSchema.safeParse(parsedJson);
    if (validated.success) return { ok: true, value: validated.data };
    if (isLastLine) return { ok: true, value: null };
    return failure(
      "EVIDENCE_INVALID",
      `Internal journal event ${index} is schema-invalid.`,
    );
  } catch {
    if (isLastLine) return { ok: true, value: null };
    return failure(
      "EVIDENCE_INVALID",
      `Internal journal line ${index} is corrupt JSON.`,
    );
  }
}

export async function readJournalEvents(
  sessionDir: string,
): Promise<Outcome<SessionEvent[]>> {
  const journalPath = join(sessionDir, "events.jsonl");
  let content: string;
  try {
    content = await readFile(journalPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: [] };
    }
    return failure("STORAGE_FAILED", "Failed to read events journal.");
  }

  const lines = content.split("\n");
  const events: SessionEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]?.trim();
    if (!rawLine) continue;

    const isLastLine =
      i === lines.length - 1 ||
      (i === lines.length - 2 && !lines[lines.length - 1]?.trim());
    const parsed = parseJournalLine(rawLine, i, isLastLine);
    if (!parsed.ok) return parsed;
    if (parsed.value === null) break;
    events.push(parsed.value);
  }

  return { ok: true, value: events };
}

export async function saveStateProjection(
  sessionDir: string,
  state: SessionState,
): Promise<Outcome<void>> {
  const validated = sessionStateSchema.safeParse(state);
  if (!validated.success) {
    return failure("INVALID_INPUT", "Invalid session state projection.");
  }
  const targetPath = join(sessionDir, "state.json");
  const tempPath = join(
    sessionDir,
    `state.json.tmp.${randomUUID().replaceAll("-", "")}`,
  );

  try {
    await mkdir(sessionDir, { recursive: true });
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(validated.data, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, targetPath);
    await syncDirectory(sessionDir);
    return { ok: true, value: undefined };
  } catch (error) {
    return failure(
      "STORAGE_FAILED",
      `Failed to save state projection: ${(error as Error).message}`,
    );
  }
}

export async function readStateProjection(
  sessionDir: string,
): Promise<Outcome<SessionState | null>> {
  const targetPath = join(sessionDir, "state.json");
  try {
    const raw = await readFile(targetPath, "utf8");
    const parsed = sessionStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return failure("EVIDENCE_INVALID", "Corrupted state projection cache.");
    }
    return { ok: true, value: parsed.data };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: null };
    }
    return failure("STORAGE_FAILED", "Failed to read state projection cache.");
  }
}

export async function rebuildSessionState(options: {
  sessionDir: string;
  initial: SessionState;
  ports: ReplayPorts;
}): Promise<Outcome<SessionState>> {
  const events = await readJournalEvents(options.sessionDir);
  if (!events.ok) return events;

  const replayed = replay({
    initial: options.initial,
    events: events.value,
    ports: options.ports,
  });
  if (!replayed.ok) return replayed;

  await saveStateProjection(options.sessionDir, replayed.value);
  return replayed;
}
