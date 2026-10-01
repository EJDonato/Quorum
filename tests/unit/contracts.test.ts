import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { repositoryConfigSchema } from "../../src/contracts/config.js";
import { eventSchema } from "../../src/contracts/events.js";
import { gitObject, repositoryPath } from "../../src/contracts/primitives.js";
import { sessionStateSchema } from "../../src/contracts/session.js";
import { initialSession } from "../fixtures/session.js";

const config: unknown = JSON.parse(
  readFileSync("tests/fixtures/config.json", "utf8"),
);

await test("configuration rejects unsupported versions, credentials, shell strings, duplicate checks, and unpinned images", () => {
  const valid = repositoryConfigSchema.parse(config);
  for (const invalid of [
    { ...valid, schema_version: "2.0.0" },
    { ...valid, api_key: "fixture-secret" },
    { ...valid, adapter: { ...valid.adapter, api_key: "fixture-secret" } },
    { ...valid, commands: ["node --test"] },
    { ...valid, commands: [...valid.commands, ...valid.commands] },
    { ...valid, validation_image: "quorum:latest" },
    { ...valid, budgets: { ...valid.budgets, model_tokens: -1 } },
    { ...valid, permitted_environment_keys: { TOKEN: "fixture-secret" } },
  ])
    assert.equal(repositoryConfigSchema.safeParse(invalid).success, false);
});

await test("literal paths reject scope escapes and accept repository-relative Unicode", () => {
  for (const invalid of [
    "",
    "/",
    "../a",
    "src/../a",
    "src/./a",
    "./src",
    "a//b",
    "a/",
    "C:/a",
    "a\\b",
    "a\0b",
  ]) {
    assert.equal(repositoryPath.safeParse(invalid).success, false, invalid);
  }
  assert.equal(repositoryPath.safeParse("src/日本語.ts").success, true);
});

await test("Git IDs match their recorded object format", () => {
  assert.equal(
    gitObject.safeParse({ format: "sha256", oid: "a".repeat(64) }).success,
    true,
  );
  assert.equal(
    gitObject.safeParse({ format: "sha1", oid: "a".repeat(64) }).success,
    false,
  );
});

await test("sessions reject impossible frozen states, advisory approval, mismatched ledgers, and overruns", () => {
  const initial = initialSession();
  for (const invalid of [
    { ...initial, state: "VALIDATING" },
    {
      ...initial,
      state: "APPROVED",
      mode: "advisory",
      current_candidate_id: initial.input_digest,
    },
    { ...initial, budget: { ...initial.budget, repairs_total: 1 } },
    { ...initial, budget: { ...initial.budget, tokens_charged: 200_001 } },
    { ...initial, state: "BLOCKED" },
  ])
    assert.equal(sessionStateSchema.safeParse(invalid).success, false);
});

await test("journal schema rejects authority fields and non-UTC timestamps", () => {
  const event = {
    schema_version: "1.0.0",
    event_id: "e1",
    session_id: "s1",
    sequence: 1,
    previous_digest: null,
    timestamp: "2026-10-01T00:00:00Z",
    payload: { type: "PREFLIGHT_COMPLETED" },
  };
  assert.equal(eventSchema.safeParse(event).success, true);
  assert.equal(
    eventSchema.safeParse({ ...event, timestamp: "2026-10-01T08:00:00+08:00" })
      .success,
    false,
  );
  assert.equal(
    eventSchema.safeParse({
      ...event,
      payload: { ...event.payload, quorum_achieved: true },
    }).success,
    false,
  );
});
