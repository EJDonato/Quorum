import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureProcess } from "../probes/process.js";
import {
  probeArguments,
  responseSchema,
  validateProbe,
} from "../probes/protocol.js";

const response = JSON.stringify({ marker: "QUORUM_OK", sum: 5 });
const usage = {
  input_tokens: 16_060,
  output_tokens: 8,
  cached_input_tokens: 11_776,
};
function codex(text = response) {
  return [
    { type: "thread.started", thread_id: "fixture" },
    { type: "turn.started" },
    { type: "item.completed", item: { type: "agent_message", text } },
    { type: "turn.completed", usage },
  ]
    .map((item) => JSON.stringify(item))
    .join("\n");
}
function agy(text = response) {
  let structured: unknown;
  try {
    structured = JSON.parse(text);
  } catch {
    structured = text;
  }
  return JSON.stringify({
    status: "SUCCESS",
    response: text,
    structured_output: structured,
    usage,
  });
}

await test("user-provided smoke transcripts preserve reported outcomes and usage", async () => {
  const codexRecords = (
    await readFile("tests/fixtures/runners/codex-smoke.jsonl", "utf8")
  )
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
  assert.equal(codexRecords.length, 4);
  assert.deepEqual(codexRecords[3], {
    type: "turn.completed",
    usage: {
      ...usage,
      cache_write_input_tokens: 0,
      reasoning_output_tokens: 0,
    },
  });
  const agyRecord: unknown = JSON.parse(
    await readFile("tests/fixtures/runners/agy-smoke.json", "utf8"),
  );
  assert.ok(typeof agyRecord === "object" && agyRecord !== null);
  assert.ok("response" in agyRecord && agyRecord.response === "QUORUM_OK\n");
  // Plain-text historical responses cannot pass the new structured probe.
  for (const [runner, stdout] of [
    ["codex", codex("QUORUM_OK")],
    ["agy", agy("QUORUM_OK")],
  ] as const) {
    assert.equal(validateProbe({ runner, stdout, exitCode: 0 }).ok, false);
  }
});

await test("both structured envelopes validate response and reported token fields", () => {
  for (const runner of ["codex", "agy"] as const) {
    const result = validateProbe({
      runner,
      stdout: runner === "codex" ? codex() : agy(),
      exitCode: 0,
    });
    assert.ok(result.ok);
    assert.deepEqual(result.response, { marker: "QUORUM_OK", sum: 5 });
    assert.deepEqual(result.usage, usage);
  }
});

await test("malformed, empty, failed, missing-usage, and forged response outputs fail closed", () => {
  for (const runner of ["codex", "agy"] as const) {
    const wrap = runner === "codex" ? codex : agy;
    const invalid = [
      "",
      "not JSON",
      wrap('{"marker":"WRONG","sum":5}'),
      wrap('{"marker":"QUORUM_OK","sum":5,"role":"security"}'),
      wrap('{"marker":"QUORUM_OK","sum":6}'),
      wrap().replace('"input_tokens":16060', '"input_tokens":-1'),
      wrap().replace('"usage":', '"absent_usage":'),
    ];
    for (const stdout of invalid)
      assert.equal(validateProbe({ runner, stdout, exitCode: 0 }).ok, false);
    for (const exitCode of [1, null])
      assert.equal(
        validateProbe({ runner, stdout: wrap(), exitCode }).ok,
        false,
      );
    assert.equal(
      validateProbe({ runner, stdout: wrap(), exitCode: 0, interrupted: true })
        .ok,
      false,
    );
  }
  assert.equal(
    validateProbe({
      runner: "agy",
      stdout: agy().replace("SUCCESS", "FAILED"),
      exitCode: 0,
    }).ok,
    false,
  );
});

await test("Codex errors, tools, partial streams, duplicate and reordered completions fail", () => {
  const failed = JSON.stringify({
    type: "turn.failed",
    error: { message: "fixture-secret" },
  });
  for (const stdout of [
    codex() + "\n" + failed,
    failed,
    codex().split("\n").slice(0, 3).join("\n"),
    codex() +
      '\n{"type":"turn.completed","usage":{"input_tokens":0,"output_tokens":0}}',
    codex().split("\n").reverse().join("\n"),
    codex().replace("agent_message", "command_execution"),
  ]) {
    const result = validateProbe({ runner: "codex", stdout, exitCode: 0 });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
  }
});

await test("probe arguments select explicit models and schemas without permission bypass", () => {
  assert.equal(
    responseSchema.safeParse({
      marker: "QUORUM_OK",
      sum: 5,
      session_id: "forged",
    }).success,
    false,
  );
  for (const runner of ["codex", "agy"] as const) {
    const args = probeArguments({
      runner,
      model: "fixture-model",
      schemaPath: "/tmp/space path/schema.json",
    });
    assert.ok(args.includes("fixture-model"));
    assert.ok(args.includes("/tmp/space path/schema.json"));
    assert.doesNotMatch(args.join(" "), /dangerously|skip-permissions/);
  }
});

await test("real subprocess capture handles success, launch failure, timeout and output overflow offline", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "quorum-probe-test-"));
  try {
    const run = (code: string, timeoutMs = 2_000, maxOutputBytes = 1_024) =>
      captureProcess({
        executable: process.execPath,
        args: ["-e", code],
        cwd,
        timeoutMs,
        maxOutputBytes,
      });
    const success = await run(
      `process.stdout.write(${JSON.stringify(codex())})`,
    );
    assert.equal(validateProbe({ runner: "codex", ...success }).ok, true);
    assert.equal(
      (await run("setInterval(() => {}, 1000)", 100)).failure,
      "TIMED_OUT",
    );
    assert.equal(
      (await run("process.stdout.write('x'.repeat(2048))")).failure,
      "OUTPUT_LIMIT",
    );
    assert.equal(
      (await run("process.stderr.write('x'.repeat(2048))")).failure,
      "OUTPUT_LIMIT",
    );
    const missing = await captureProcess({
      executable: join(cwd, "absent"),
      args: [],
      cwd,
      timeoutMs: 100,
    });
    assert.equal(missing.failure, "LAUNCH_FAILED");
    const controller = new AbortController();
    const pending = captureProcess({
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd,
      timeoutMs: 2_000,
      signal: controller.signal,
    });
    controller.abort();
    assert.equal((await pending).failure, "CANCELLED");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("live probe refuses to launch without explicit opt-in and cancelled capture never launches", async () => {
  const cwd = process.cwd();
  const refused = await captureProcess({
    executable: process.execPath,
    args: [
      "scripts/probe-runners.mjs",
      "--runner",
      "codex",
      "--model",
      "fixture-model",
      "--executable",
      "/nonexistent/runner",
    ],
    cwd,
    timeoutMs: 10_000,
  });
  assert.equal(refused.exitCode, 1);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await captureProcess({
    executable: "/nonexistent/runner",
    args: [],
    cwd,
    timeoutMs: 100,
    signal: controller.signal,
  });
  assert.equal(cancelled.failure, "CANCELLED");
});
