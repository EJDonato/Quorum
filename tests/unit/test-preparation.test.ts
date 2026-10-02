import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { repositoryConfigSchema } from "../../src/contracts/config.js";
import { planTestPreparation } from "../../src/domain/test-preparation.js";
import {
  createPreparationSnapshot,
  verifyPreparationSnapshot,
} from "../../src/application/preparation-snapshots.js";
import { validatePreparationInput } from "../../src/application/test-preparation-input.js";
import { canonicalDigest } from "../../src/infrastructure/artifacts/digests.js";
import { preparationInput } from "../fixtures/test-preparation.js";
import { hash } from "../fixtures/validation.js";
import {
  testPreparationPolicySchema,
  testSpecificationSchema,
} from "../../src/contracts/test-specification.js";

const config = repositoryConfigSchema.parse(
  JSON.parse(await readFile("tests/fixtures/config.json", "utf8")),
);
config.commands = [
  {
    check_id: "unit",
    kind: "test",
    executable: "node",
    args: ["FAKE"],
    report_format: "quorum-json-v1",
  },
];
function input() {
  return preparationInput({
    config,
    sessionId: "prep-unit",
    baselineTree: { format: "sha1", oid: "a".repeat(40) },
    redTree: { format: "sha1", oid: "b".repeat(40) },
  });
}
const port = { digest: canonicalDigest };

await test("preparation identity hashes are stable and reject tampering, baseline mismatch, and object-format changes", () => {
  const f = input();
  assert.ok(verifyPreparationSnapshot(f.baseline, port).ok);
  assert.equal(f.baseline.input_digest, hash(f.baseline.identity));
  assert.ok(
    !verifyPreparationSnapshot(
      {
        ...f.baseline,
        identity: { ...f.baseline.identity, phase: "expected_red" },
      },
      port,
    ).ok,
  );
  assert.ok(
    !createPreparationSnapshot(
      { ...f.baseline.identity, tree: f.expectedRed.identity.tree },
      port,
    ).ok,
  );
  assert.ok(
    !createPreparationSnapshot(
      {
        ...f.expectedRed.identity,
        tree: { format: "sha256", oid: "b".repeat(64) },
      },
      port,
    ).ok,
  );
});

await test("all acceptance criteria require unique known mappings and configured check kinds", () => {
  const f = input();
  const spec = f.specification as {
    mappings: unknown[];
    motion_digest: string;
  };
  for (const specification of [
    { ...spec, mappings: [] },
    { ...spec, mappings: [...spec.mappings, ...spec.mappings] },
    {
      ...spec,
      mappings: [
        {
          criterion_id: "foreign",
          check_id: "unit",
          expectation: "behavioral",
          expected_failure_id: "failure",
        },
      ],
    },
    {
      ...spec,
      mappings: [{ ...(spec.mappings[0] as object), check_id: "unconfigured" }],
    },
    {
      ...spec,
      mappings: [{ ...(spec.mappings[0] as object), expectation: "compiler" }],
    },
    {
      ...spec,
      mappings: [{ ...(spec.mappings[0] as object), verdict: "APPROVED" }],
    },
  ])
    assert.ok(!planTestPreparation({ ...f, specification }).ok);
});

await test("QA cannot opt into refactor/documentation exceptions or alter host motion/classification", () => {
  const f = input();
  const spec = f.specification as {
    mappings: { criterion_id: string; check_id: string }[];
  };
  for (const expectation of ["regression", "documentation"])
    assert.ok(
      !planTestPreparation({
        ...f,
        specification: {
          ...spec,
          mappings: [
            { ...spec.mappings[0], expectation, justification: "waive red" },
          ],
        },
      }).ok,
    );
  assert.ok(
    !planTestPreparation({
      ...f,
      policy: { ...f.policy, changeKind: "documentation" },
    }).ok,
  );
  assert.ok(
    !planTestPreparation({
      ...f,
      motion: { ...(f.motion as object), session_id: "foreign" },
    }).ok,
  );
});

await test("missing-import diagnostics, malformed host policies, and expanded grants are rejected", () => {
  const f = input();
  const spec = testSpecificationSchema.parse(f.specification);
  assert.ok(
    !testSpecificationSchema.safeParse({
      ...spec,
      mappings: [
        {
          ...spec.mappings[0],
          expectation: "compiler",
          expected_failure_id: "TS2307",
        },
      ],
    }).success,
  );
  assert.ok(
    !testPreparationPolicySchema.safeParse({
      ...f.policy,
      changeKind: "bypass",
    }).success,
  );
  assert.ok(
    !planTestPreparation({
      ...f,
      policy: { ...f.policy, testPaths: ["app.ts"] },
    }).ok,
  );
  assert.ok(
    !planTestPreparation({
      ...f,
      motion: { ...(f.motion as object), fuzz_required: true },
    }).ok,
  );
});

await test("configuration, environment, plan, specification, session, and phase changes invalidate preparation", () => {
  const f = input();
  assert.ok(validatePreparationInput(f, port).ok);
  for (const options of [
    {
      ...f,
      config: {
        ...config,
        commands: [{ ...config.commands[0], args: ["different"] }],
      },
    },
    { ...f, environment: { CI: "true" } },
    {
      ...f,
      specification: {
        ...(f.specification as object),
        motion_digest: `sha256:${"f".repeat(64)}`,
      },
    },
    { ...f, policy: { ...f.policy, sessionId: "foreign" } },
    { ...f, baseline: f.expectedRed, expectedRed: f.baseline },
    { ...f, expectedRed: f.baseline },
  ])
    assert.ok(!validatePreparationInput(options, port).ok);
});
