import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  gatewayAllocationSchema,
  gatewayEventSchema,
  type GatewayAllocation,
  type GatewayEvent,
} from "../../contracts/model-gateway.js";
import { failure, type Outcome } from "../../contracts/errors.js";
import type {
  ModelLedgerPort,
  ModelLedgerTransaction,
} from "../../application/model-gateway-ports.js";
import {
  applyModelBudgetEvent,
  type ModelBudgetState,
} from "../../domain/model-budget.js";
import { canonicalSerialize } from "../../domain/canonical.js";
import { canonicalDigest } from "../artifacts/digests.js";
import { readRecord } from "../storage/records.js";
import { writeArtifact } from "../storage/artifacts.js";
import { acquireCommandLock, releaseCommandLock } from "../storage/locks.js";
import { ensurePrivateDirectory } from "../workspace/directories.js";

export async function createModelLedger(options: {
  root: string;
  allocation: GatewayAllocation;
}): Promise<Outcome<ModelLedgerPort>> {
  const parsed = gatewayAllocationSchema.safeParse(options.allocation);
  if (!parsed.success)
    return failure("INVALID_INPUT", "Invalid gateway allocation.");
  try {
    await ensurePrivateDirectory(options.root, "events");
  } catch {
    return failure("STORAGE_FAILED", "Cannot initialize private model ledger.");
  }
  const allocation = parsed.data;
  const serialized = canonicalSerialize(allocation);
  if (!serialized.ok) return serialized;
  const stored = await writeArtifact({
    baseDir: options.root,
    relativePath: "allocation.json",
    content: serialized.value + "\n",
  });
  if (!stored.ok)
    return failure(
      "EVIDENCE_INVALID",
      "Gateway allocation is conflicting or cannot be persisted.",
    );
  return {
    ok: true,
    value: {
      exclusive: async (operation) => {
        const lockPath = join(options.root, "gateway.lock");
        const lock = await acquireCommandLock(lockPath, {
          sessionId: allocation.session_id,
        });
        if (!lock.ok) return lock;
        let result: Awaited<ReturnType<typeof operation>>;
        try {
          const transaction = await loadTransaction({
            root: options.root,
            allocation,
          });
          result = transaction.ok
            ? await operation(transaction.value)
            : transaction;
        } catch {
          result = failure(
            "STORAGE_FAILED",
            "Model gateway transaction interrupted; reconcile before retrying.",
          );
        }
        const released = await releaseCommandLock(lockPath, lock.value.nonce);
        return released.ok ? result : released;
      },
    },
  };
}

async function loadTransaction(options: {
  root: string;
  allocation: GatewayAllocation;
}): Promise<Outcome<ModelLedgerTransaction>> {
  const allocation = await readRecord({
    dir: options.root,
    name: "allocation.json",
    schema: gatewayAllocationSchema,
  });
  if (!allocation.ok) return allocation;
  const initialDigest = canonicalDigest(options.allocation);
  const storedDigest = canonicalDigest(allocation.value);
  if (
    !initialDigest.ok ||
    !storedDigest.ok ||
    initialDigest.value !== storedDigest.value
  )
    return failure("EVIDENCE_INVALID", "Model allocation identity changed.");
  return replayLedger(options, initialDigest.value);
}

async function replayLedger(
  options: { root: string; allocation: GatewayAllocation },
  initialDigest: string,
): Promise<Outcome<ModelLedgerTransaction>> {
  const files = await readdir(join(options.root, "events"));
  const names = files.filter((name) => !name.includes(".tmp.")).sort();
  if (names.length > 4096 || names.some((name) => !/^\d{6}\.json$/.test(name)))
    return failure(
      "EVIDENCE_INVALID",
      "Model ledger inventory is invalid or exceeds its bound.",
    );
  let state: ModelBudgetState = { tokensCharged: 0, requests: new Map() };
  let previousDigest = initialDigest;
  for (const [index, name] of names.entries()) {
    const event = await readRecord({
      dir: join(options.root, "events"),
      name,
      schema: gatewayEventSchema,
    });
    if (!event.ok) return event;
    if (
      !event.value ||
      event.value.sequence !== index + 1 ||
      event.value.previous_digest !== previousDigest ||
      name !== eventName(index + 1)
    )
      return failure(
        "EVIDENCE_INVALID",
        "Model ledger chain is missing or reordered.",
      );
    const next = applyModelBudgetEvent({
      allocation: options.allocation,
      state,
      event: event.value,
    });
    if (!next.ok) return next;
    const digest = canonicalDigest(event.value);
    if (!digest.ok) return digest;
    state = next.value;
    previousDigest = digest.value;
  }
  return {
    ok: true,
    value: transaction({
      ...options,
      state,
      previousDigest,
      sequence: names.length,
    }),
  };
}

const eventName = (sequence: number) =>
  `${String(sequence).padStart(6, "0")}.json`;

function transaction(options: {
  root: string;
  allocation: GatewayAllocation;
  state: ModelBudgetState;
  previousDigest: string;
  sequence: number;
}): ModelLedgerTransaction {
  const tx: ModelLedgerTransaction = {
    state: options.state,
    previousDigest: options.previousDigest,
    sequence: options.sequence,
    append: async (raw: GatewayEvent) => {
      const parsed = gatewayEventSchema.safeParse(raw);
      if (
        tx.sequence >= 4096 ||
        (raw.kind === "reserved" && tx.sequence > 4094)
      )
        return failure(
          "BUDGET_EXHAUSTED",
          "Model ledger event capacity reached; reserve room for settlement.",
        );
      if (
        !parsed.success ||
        parsed.data.sequence !== tx.sequence + 1 ||
        parsed.data.previous_digest !== tx.previousDigest
      )
        return failure(
          "EVIDENCE_INVALID",
          "Invalid model ledger append identity.",
        );
      const next = applyModelBudgetEvent({
        allocation: options.allocation,
        state: tx.state,
        event: parsed.data,
      });
      if (!next.ok) return next;
      const serialized = canonicalSerialize(parsed.data);
      const digest = canonicalDigest(parsed.data);
      if (!serialized.ok) return serialized;
      if (!digest.ok) return digest;
      const write = await writeArtifact({
        baseDir: options.root,
        relativePath: `events/${eventName(parsed.data.sequence)}`,
        content: serialized.value + "\n",
      });
      if (!write.ok)
        return failure(
          "STORAGE_FAILED",
          "Cannot durably append model event; do not replay request.",
        );
      tx.state = next.value;
      tx.sequence = parsed.data.sequence;
      tx.previousDigest = digest.value;
      return { ok: true, value: undefined };
    },
  };
  return tx;
}
