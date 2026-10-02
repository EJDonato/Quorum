import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgyOfflineProtocol } from "../probes/agy-offline-protocol.js";
import {
  agyOfflineEnvironment,
  runAgyOfflineProtocol,
} from "../probes/agy-offline-process.js";
import { agyOfflineReportSchema } from "../probes/agy-offline-report.js";

const sampleInit = {
  event: "init",
  conversation_id: "conv-123",
  init: {
    cwd: "/workspace",
    tools: ["write_to_file", "run_command", "view_file"],
    permission_mode: "always-proceed",
  },
};

const sampleUsage = {
  input_tokens: 100,
  output_tokens: 25,
  thinking_tokens: 20,
  cache_read_tokens: 10,
  total_tokens: 125,
};

const sampleResult = {
  event: "result",
  result: {
    conversation_id: "conv-123",
    status: "SUCCESS",
    response: "Done",
    duration_seconds: 1.5,
    num_turns: 1,
    usage: sampleUsage,
  },
};

void test("protocol receives init event and records sorted tools and conversationId", () => {
  const protocol = new AgyOfflineProtocol();
  const outcome = protocol.receive(sampleInit);
  assert.equal(outcome.failure, null);
  assert.equal(outcome.done, false);
  assert.equal(protocol.initialized, true);
  assert.equal(protocol.conversationId, "conv-123");
  assert.deepEqual(protocol.tools, [
    "run_command",
    "view_file",
    "write_to_file",
  ]);
});

void test("protocol rejects malformed, missing event, or duplicate init events", () => {
  const protocol = new AgyOfflineProtocol();
  assert.equal(protocol.receive(null).failure, "INVALID_PROTOCOL");
  assert.equal(protocol.receive({}).failure, "INVALID_PROTOCOL");
  assert.equal(
    protocol.receive({ event: "init", init: {} }).failure,
    "INVALID_PROTOCOL",
  );

  const valid = new AgyOfflineProtocol();
  assert.equal(valid.receive(sampleInit).failure, null);
  assert.equal(valid.receive(sampleInit).failure, "INVALID_PROTOCOL");
});

void test("protocol handles command_result event without terminating", () => {
  const protocol = new AgyOfflineProtocol();
  protocol.receive(sampleInit);
  const outcome = protocol.receive({
    event: "command_result",
    command: { name: "help", data: { commands: [] } },
  });
  assert.equal(outcome.failure, null);
  assert.equal(outcome.done, false);
});

void test("protocol validates result event and strictly normalizes token usage", () => {
  const protocol = new AgyOfflineProtocol();
  protocol.receive(sampleInit);
  const outcome = protocol.receive(sampleResult);
  assert.equal(outcome.failure, null);
  assert.equal(outcome.done, true);
  assert.equal(protocol.completed, true);
  assert.equal(protocol.status, "SUCCESS");
  assert.deepEqual(protocol.usage, sampleUsage);
});

void test("protocol rejects invalid or inconsistent token counts", () => {
  for (const badUsage of [
    { ...sampleUsage, input_tokens: -1 },
    { ...sampleUsage, thinking_tokens: 30 }, // thinking > output
    { ...sampleUsage, total_tokens: 200 }, // total != input + output
  ]) {
    const protocol = new AgyOfflineProtocol();
    protocol.receive(sampleInit);
    const outcome = protocol.receive({
      event: "result",
      result: {
        ...sampleResult.result,
        usage: badUsage,
      },
    });
    assert.equal(outcome.failure, "INVALID_PROTOCOL");
  }
});

void test("offline environment strips credentials, proxies, and user configs", () => {
  const env = agyOfflineEnvironment("/test/dir");
  assert.deepEqual(env, {
    HOME: "/test/dir",
    TMPDIR: "/test/dir",
    PATH: "/usr/bin:/bin",
    LANG: "en_US.UTF-8",
    NO_COLOR: "1",
  });
  assert.equal("GEMINI_API_KEY" in env, false);
  assert.equal("GOOGLE_API_KEY" in env, false);
  assert.equal("HTTP_PROXY" in env, false);
  assert.equal("CLOUD_CODE_URL" in env, false);
});

async function runSyntheticProcess(
  code: string,
  overrides: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    signal?: AbortSignal;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "quorum-agy-test-"));
  try {
    return await runAgyOfflineProtocol({
      executable: process.execPath,
      args: ["--input-type=module", "-e", code],
      cwd: root,
      env: agyOfflineEnvironment(root),
      timeoutMs: overrides.timeoutMs ?? 2000,
      maxOutputBytes: overrides.maxOutputBytes ?? 16384,
      ...(overrides.signal ? { signal: overrides.signal } : {}),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void test("synthetic process captures init event and tool inventory", async () => {
  const code = `
    process.stdout.write(${JSON.stringify(JSON.stringify(sampleInit))} + '\\n');
    process.exit(0);
  `;
  const result = await runSyntheticProcess(code);
  assert.equal(result.failure, null);
  assert.equal(result.protocol.initialized, true);
  assert.equal(result.protocol.completed, false);
  assert.deepEqual(result.protocol.tools, [
    "run_command",
    "view_file",
    "write_to_file",
  ]);
});

void test("synthetic process captures terminal result and usage", async () => {
  const code = `
    process.stdout.write(${JSON.stringify(JSON.stringify(sampleInit))} + '\\n');
    process.stdout.write(${JSON.stringify(JSON.stringify(sampleResult))} + '\\n');
    process.exit(0);
  `;
  const result = await runSyntheticProcess(code);
  assert.equal(result.failure, null);
  assert.equal(result.protocol.initialized, true);
  assert.equal(result.protocol.completed, true);
  assert.deepEqual(result.protocol.usage, sampleUsage);
});

void test("synthetic process handles failure modes cleanly", async () => {
  const malformed = await runSyntheticProcess(
    "process.stdout.write('not-json\\n'); setInterval(()=>{}, 1000);",
  );
  assert.equal(malformed.failure, "INVALID_PROTOCOL");

  const overflow = await runSyntheticProcess(
    "process.stdout.write('x'.repeat(10000)); setInterval(()=>{}, 1000);",
    { maxOutputBytes: 128 },
  );
  assert.equal(overflow.failure, "OUTPUT_LIMIT");

  const timeout = await runSyntheticProcess("setInterval(()=>{}, 1000);", {
    timeoutMs: 100,
  });
  assert.equal(timeout.failure, "TIMED_OUT");

  const controller = new AbortController();
  controller.abort();
  const cancelled = await runSyntheticProcess("setInterval(()=>{}, 1000);", {
    signal: controller.signal,
  });
  assert.equal(cancelled.failure, "CANCELLED");
});

void test("report schema accepts valid offline report and rejects privilege escalation", () => {
  const report = {
    kind: "agy_offline_protocol",
    schema_version: "1.0.0",
    expected_version: "1.2.14",
    failure: null,
    enforced_conformance: false,
    external_model_attempts: 0,
    initialized: true,
    completed: true,
    effective_tool_inventory: ["run_command", "view_file"],
    native_tool_count: 2,
    broker_tools_exclusive: false,
    usage: sampleUsage,
    mandatory_capabilities: "UNVERIFIED",
  };
  assert.equal(agyOfflineReportSchema.safeParse(report).success, true);
  assert.equal(
    agyOfflineReportSchema.safeParse({ ...report, enforced_conformance: true })
      .success,
    false,
  );
});
