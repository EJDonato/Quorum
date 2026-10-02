import assert from "node:assert/strict";
import { test } from "node:test";
import { applyModelBudgetEvent } from "../../src/domain/model-budget.js";
import {
  gatewayAllocationSchema,
  gatewayEventSchema,
  modelReservationSchema,
} from "../../src/contracts/model-gateway.js";

const digest = `sha256:${"a".repeat(64)}`;
const allocation = gatewayAllocationSchema.parse({
  schema_version: "1.0.0",
  session_id: "session",
  invocation_id: "invocation",
  tokens_limit: 100,
  context_digest: digest,
});
const reserved = gatewayEventSchema.parse({
  schema_version: "1.0.0",
  sequence: 1,
  previous_digest: digest,
  kind: "reserved",
  reservation: {
    request_id: "request",
    payload_digest: digest,
    capability_digest: digest,
    input_tokens_bound: 60,
    output_tokens_limit: 40,
    tokens_reserved: 100,
  },
});

void test("reservation arithmetic is pure, bounded and does not release an interrupted request", () => {
  const initial = { tokensCharged: 0, requests: new Map() };
  const result = applyModelBudgetEvent({
    allocation,
    state: initial,
    event: reserved,
  });
  assert.ok(result.ok);
  assert.equal(initial.tokensCharged, 0);
  assert.equal(initial.requests.size, 0);
  assert.equal(result.value.tokensCharged, 100);
  const duplicate = applyModelBudgetEvent({
    allocation,
    state: result.value,
    event: reserved,
  });
  assert.ok(!duplicate.ok);
  const exhausted = applyModelBudgetEvent({
    allocation: { ...allocation, tokens_limit: 99 },
    state: initial,
    event: reserved,
  });
  assert.ok(!exhausted.ok);
  assert.equal(exhausted.error.code, "BUDGET_EXHAUSTED");
});

void test("exactly-once settlement charges input plus output without adding cache or reasoning twice", () => {
  const initial = applyModelBudgetEvent({
    allocation,
    state: { tokensCharged: 0, requests: new Map() },
    event: reserved,
  });
  assert.ok(initial.ok);
  const settlement = gatewayEventSchema.parse({
    schema_version: "1.0.0",
    sequence: 2,
    previous_digest: digest,
    kind: "settled",
    request_id: "request",
    usage: {
      input_tokens: 60,
      output_tokens: 10,
      cached_input_tokens: 30,
      reasoning_tokens: 8,
      charged_tokens: 70,
      accounting_complete: true,
    },
  });
  assert.ok(settlement.kind === "settled");
  const result = applyModelBudgetEvent({
    allocation,
    state: initial.value,
    event: settlement,
  });
  assert.ok(result.ok);
  assert.equal(result.value.tokensCharged, 70);
  assert.equal(initial.value.tokensCharged, 100);
  assert.equal(
    applyModelBudgetEvent({
      allocation,
      state: result.value,
      event: settlement,
    }).ok,
    false,
  );
  assert.equal(
    applyModelBudgetEvent({
      allocation,
      state: initial.value,
      event: { ...settlement, request_id: "foreign" },
    }).ok,
    false,
  );
});

void test("unknown, incomplete or over-ceiling usage cannot refund reservations", () => {
  const initial = applyModelBudgetEvent({
    allocation,
    state: { tokensCharged: 0, requests: new Map() },
    event: reserved,
  });
  assert.ok(initial.ok);
  for (const usage of [
    {
      input_tokens: 61,
      output_tokens: 10,
      charged_tokens: 71,
      accounting_complete: true,
    },
    {
      input_tokens: 60,
      output_tokens: 41,
      charged_tokens: 101,
      accounting_complete: true,
    },
    {
      input_tokens: 60,
      output_tokens: 10,
      charged_tokens: 70,
      accounting_complete: false,
    },
  ]) {
    const event = gatewayEventSchema.parse({
      schema_version: "1.0.0",
      sequence: 2,
      previous_digest: digest,
      kind: "settled",
      request_id: "request",
      usage: { ...usage, cached_input_tokens: 0, reasoning_tokens: 0 },
    });
    assert.equal(
      applyModelBudgetEvent({ allocation, state: initial.value, event }).ok,
      false,
    );
    assert.equal(initial.value.tokensCharged, 100);
  }
});

void test("reservation schemas reject negative, inconsistent and unsafe integer ceilings", () => {
  const base = {
    request_id: "request",
    payload_digest: digest,
    capability_digest: digest,
    input_tokens_bound: 60,
    output_tokens_limit: 40,
    tokens_reserved: 100,
  };
  for (const patch of [
    { input_tokens_bound: -1 },
    { output_tokens_limit: 0 },
    { tokens_reserved: 99 },
    {
      input_tokens_bound: Number.MAX_SAFE_INTEGER,
      output_tokens_limit: 1,
      tokens_reserved: Number.MAX_SAFE_INTEGER,
    },
  ])
    assert.equal(
      modelReservationSchema.safeParse({ ...base, ...patch }).success,
      false,
    );
});
