import assert from "node:assert/strict";
import test from "node:test";
import type { ModelLedgerPort } from "../../src/application/model-gateway-ports.js";
import { serializeModelLedger } from "../../src/infrastructure/model-gateway/serialized-ledger.js";

void test("serialized ledger queues bounded in-process operations", async () => {
  let active = 0;
  let maximum = 0;
  const order: number[] = [];
  const ledger: ModelLedgerPort = {
    exclusive: async (operation) => {
      active++;
      maximum = Math.max(maximum, active);
      const result = await operation({
        state: { tokensCharged: 0, requests: new Map() },
        sequence: 0,
        previousDigest: "sha256:" + "0".repeat(64),
        append: () => Promise.resolve({ ok: true, value: undefined }),
      });
      active--;
      return result;
    },
  };
  const serialized = serializeModelLedger(ledger, 2);
  const first = serialized.exclusive(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(1);
    return { ok: true, value: 1 };
  });
  const second = serialized.exclusive(() => {
    order.push(2);
    return Promise.resolve({ ok: true, value: 2 });
  });
  const rejected = await serialized.exclusive(() =>
    Promise.resolve({ ok: true, value: 3 }),
  );

  assert.ok(!rejected.ok);
  assert.equal(rejected.error.code, "LOCKED");
  assert.deepEqual(await Promise.all([first, second]), [
    { ok: true, value: 1 },
    { ok: true, value: 2 },
  ]);
  assert.equal(maximum, 1);
  assert.deepEqual(order, [1, 2]);
});
