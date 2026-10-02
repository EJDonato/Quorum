import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gatewayHarness } from "../fixtures/model-gateway.js";
import { createModelLedger } from "../../src/infrastructure/model-gateway/ledger.js";
import { gatewayAllocationSchema } from "../../src/contracts/model-gateway.js";
import {
  dispatchModelRequest,
  type ModelGatewayOptions,
} from "../../src/application/model-gateway.js";
import { failure } from "../../src/contracts/errors.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import type { ModelLedgerPort } from "../../src/application/model-gateway-ports.js";

void test("reservation and settlement storage failures prevent publication and preserve uncertain charges", async (t) => {
  for (const fault of [
    "before_reservation",
    "after_reservation",
    "before_settlement",
  ] as const) {
    const h = await gatewayHarness(t);
    const allocation = gatewayAllocationSchema.parse(
      JSON.parse(await readFile(join(h.root, "allocation.json"), "utf8")),
    );
    const store = await createModelLedger({ root: h.root, allocation });
    assert.ok(store.ok);
    const ledger: ModelLedgerPort = {
      exclusive: (operation) =>
        store.value.exclusive((transaction) => {
          const wrapped = {
            ...transaction,
            append: async (event: Parameters<typeof transaction.append>[0]) => {
              if (
                (fault === "before_reservation" && event.kind === "reserved") ||
                (fault === "before_settlement" && event.kind === "settled")
              )
                return failure(
                  "STORAGE_FAILED",
                  "Injected durable write failure.",
                );
              const saved = await transaction.append(event);
              wrapped.sequence = transaction.sequence;
              wrapped.previousDigest = transaction.previousDigest;
              wrapped.state = transaction.state;
              return fault === "after_reservation" && event.kind === "reserved"
                ? failure(
                    "STORAGE_FAILED",
                    "Write became durable but acknowledgement failed.",
                  )
                : saved;
            },
          };
          return operation(wrapped);
        }),
    };
    const gateway: ModelGatewayOptions = {
      ...h.settings,
      ledger,
      hash: canonicalDigest,
    };
    const result = await dispatchModelRequest({
      gateway,
      requestId: "fault",
      input: { input: "text" },
      signal: new AbortController().signal,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "STORAGE_FAILED");
    assert.equal(
      h.transport.calls.length,
      fault === "before_settlement" ? 2 : 1,
    );
    const recovered = await h.gateway.readBudget();
    assert.ok(recovered.ok);
    if (fault === "before_reservation")
      assert.equal(recovered.value.tokensCharged, 0);
    else {
      assert.ok(recovered.value.tokensCharged > 0);
      assert.deepEqual(recovered.value.unreconciledRequests, ["fault"]);
    }
  }
});

void test("a mismatched or unavailable input count cannot create a reservation or generate", async (t) => {
  const h = await gatewayHarness(t);
  const provider = {
    ...h.provider,
    countInput: () =>
      Promise.resolve({
        ok: true as const,
        value: { payload_digest: `sha256:${"0".repeat(64)}`, input_tokens: 10 },
      }),
  };
  const allocation = gatewayAllocationSchema.parse(
    JSON.parse(await readFile(join(h.root, "allocation.json"), "utf8")),
  );
  const ledger = await createModelLedger({ root: h.root, allocation });
  assert.ok(ledger.ok);
  const gateway: ModelGatewayOptions = {
    ...h.settings,
    provider,
    ledger: ledger.value,
    hash: canonicalDigest,
  };
  const result = await dispatchModelRequest({
    gateway,
    requestId: "mismatch",
    input: { input: "text" },
    signal: new AbortController().signal,
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "EVIDENCE_INVALID");
  assert.equal(h.transport.calls.length, 0);
  const budget = await h.gateway.readBudget();
  assert.ok(budget.ok);
  assert.equal(budget.value.tokensCharged, 0);
});

void test("verified capability labels require independent host evidence before counting", async (t) => {
  const h = await gatewayHarness(t);
  const allocation = gatewayAllocationSchema.parse(
    JSON.parse(await readFile(join(h.root, "allocation.json"), "utf8")),
  );
  const ledger = await createModelLedger({ root: h.root, allocation });
  assert.ok(ledger.ok);
  const gateway: ModelGatewayOptions = {
    ...h.settings,
    mode: "enforced",
    ledger: ledger.value,
    hash: canonicalDigest,
    provider: {
      ...h.provider,
      capability: {
        schema_version: "1.0.0",
        provider: "claim",
        model: "gpt-6-sol",
        status: "verified",
        input_bound: "exact_payload",
        output_bound: "includes_reasoning",
        hidden_retries: false,
        evidence_digest: `sha256:${"f".repeat(64)}`,
      },
    },
  };
  const result = await dispatchModelRequest({
    gateway,
    requestId: "forged",
    input: { input: "text" },
    signal: new AbortController().signal,
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "CAPABILITY_MISSING");
  assert.equal(h.credentialReads(), 0);
});
