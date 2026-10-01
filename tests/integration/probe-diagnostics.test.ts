import assert from "node:assert/strict";
import test from "node:test";
import { validateProbe } from "../probes/protocol.js";

const valid = {
  structured_output: { marker: "QUORUM_OK", sum: 5 },
  status: "SUCCESS",
  response: '{"marker":"QUORUM_OK","sum":5}',
  usage: { input_tokens: 10, output_tokens: 4 },
};
function diagnostic(stdout: string) {
  const result = validateProbe({ runner: "agy", stdout, exitCode: 0 });
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, "INVALID_PROTOCOL");
  assert.ok(result.diagnostic);
  return result;
}

await test("Antigravity failure stages distinguish transport, envelope, status, usage and response errors", () => {
  const cases = [
    ["fixture-secret", "output_json"],
    ["[]", "envelope"],
    [JSON.stringify({ ...valid, status: "fixture-secret" }), "status"],
    [JSON.stringify({ ...valid, usage: undefined }), "usage"],
    [
      JSON.stringify({
        ...valid,
        usage: { input_tokens: "fixture-secret", output_tokens: 4 },
      }),
      "usage",
    ],
    [
      JSON.stringify({ ...valid, structured_output: "fixture-secret" }),
      "response_schema",
    ],
    [JSON.stringify({ ...valid, response: {} }), "envelope"],
    [
      JSON.stringify({
        ...valid,
        structured_output: { marker: "fixture-secret", sum: 5 },
      }),
      "response_schema",
    ],
  ];
  for (const [stdout, stage] of cases) {
    assert.ok(stdout && stage);
    const result = diagnostic(stdout);
    assert.equal(result.diagnostic?.stage, stage);
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
  }
});

await test("safe envelope shapes expose field types without copying arbitrary names or values", () => {
  const result = diagnostic(
    JSON.stringify({
      ...valid,
      response: { "secret-field-name": "fixture-secret" },
      structured_output: { "secret-field-name": "fixture-secret" },
      "secret-field-name": "fixture-secret",
    }),
  );
  assert.deepEqual(result.envelope_shape, {
    status: "string",
    response: "object",
    usage: "object",
    structured_output: "object",
    result: "absent",
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /fixture-secret|secret-field-name/,
  );
});

await test("unknown schema fields and usage keys never leak through Zod issue diagnostics", () => {
  const structured_output = {
    marker: "QUORUM_OK",
    sum: 5,
    "credential-secret-name\u001b[31m": "fixture-secret",
  };
  const result = diagnostic(JSON.stringify({ ...valid, structured_output }));
  assert.deepEqual(result.diagnostic?.fields, ["unknown_field"]);
  assert.doesNotMatch(JSON.stringify(result), /credential|fixture-secret|31m/);
  const usage = diagnostic(
    JSON.stringify({ ...valid, usage: { input_tokens: -1, output_tokens: 4 } }),
  );
  assert.deepEqual(usage.diagnostic?.fields, ["input_tokens"]);
});

await test("failure diagnostics never convert partial or nonzero completion to passing evidence", () => {
  for (const options of [
    { exitCode: 1 },
    { exitCode: null },
    { exitCode: 0, interrupted: true },
  ]) {
    assert.deepEqual(
      validateProbe({
        runner: "agy",
        stdout: JSON.stringify(valid),
        ...options,
      }),
      { ok: false, reason: "EXECUTION_FAILED" },
    );
  }
  const result = validateProbe({
    runner: "codex",
    stdout: '{"type":"thread.started"}\n{"type":"turn.started"}',
    exitCode: 0,
  });
  assert.ok(!result.ok);
  assert.equal(result.diagnostic?.code, "INCOMPLETE_TURN");
});

await test("Antigravity schema output is authoritative; free text cannot replace missing or invalid structured data", () => {
  const result = validateProbe({
    runner: "agy",
    exitCode: 0,
    stdout: JSON.stringify({ ...valid, response: "Non-JSON free text" }),
  });
  assert.ok(result.ok);
  assert.deepEqual(result.response, { marker: "QUORUM_OK", sum: 5 });
  for (const structured_output of [
    undefined,
    null,
    "fixture-secret",
    {},
    { marker: "QUORUM_OK", sum: 6 },
    { marker: "QUORUM_OK", sum: 5, role: "security" },
  ]) {
    const failed = diagnostic(JSON.stringify({ ...valid, structured_output }));
    assert.equal(failed.diagnostic?.stage, "response_schema");
  }
});
