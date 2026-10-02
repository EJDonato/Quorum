import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfflineProtocol } from "../probes/codex-offline-protocol.js";
import {
  offlineEnvironment,
  runOfflineProtocol,
} from "../probes/codex-offline-process.js";
import {
  fixtureResponseEvents,
  inspectFixtureRequest,
} from "../probes/codex-fake-provider.js";
import { offlineReportSchema } from "../probes/codex-offline-report.js";

function initialized(fakeProvider = false) {
  const protocol = new OfflineProtocol({ cwd: "/synthetic", fakeProvider });
  const first = protocol.receive({ id: 1, result: { userAgent: "fixture" } });
  assert.equal(first.failure, null);
  assert.equal(first.send.length, 2);
  const registered = protocol.receive({
    id: 2,
    result: { thread: { id: "thread_fixture" } },
  });
  return { protocol, registered };
}

void test("inventory discovery cannot dispatch a model turn or establish exclusivity", () => {
  const { protocol, registered } = initialized();
  assert.equal(registered.done, true);
  assert.deepEqual(registered.send, []);
  assert.equal(protocol.registered, true);
  assert.equal(protocol.completed, false);
  assert.equal(protocol.usage, null);
});

void test("protocol rejects forged, duplicate, malformed responses and every server effect request", () => {
  for (const message of [
    null,
    [],
    { id: 2, result: {} },
    { id: 1, result: {} },
    { id: 1, method: "item/tool/call", params: { tool: "repo.read" } },
    { id: 99, method: "item/commandExecution/requestApproval" },
  ]) {
    const protocol = new OfflineProtocol({
      cwd: "/synthetic",
      fakeProvider: false,
    });
    assert.ok(protocol.receive(message).failure);
  }
  const { protocol } = initialized();
  assert.equal(
    protocol.receive({ id: 2, result: { thread: { id: "forged" } } }).failure,
    "INVALID_PROTOCOL",
  );
});

function usage(protocol: OfflineProtocol, total: unknown) {
  return protocol.receive({
    method: "thread/tokenUsage/updated",
    params: { threadId: "thread_fixture", tokenUsage: { total } },
  });
}

const counts = {
  inputTokens: 10,
  outputTokens: 3,
  cachedInputTokens: 2,
  reasoningOutputTokens: 1,
  totalTokens: 13,
};

void test("cumulative usage is replaced exactly once; cache and reasoning are overlapping subsets", () => {
  const { protocol, registered } = initialized(true);
  assert.equal(registered.send.length, 1);
  assert.equal(
    protocol.receive({ id: 3, result: { turn: { id: "turn_fixture" } } })
      .failure,
    null,
  );
  assert.equal(usage(protocol, counts).failure, null);
  assert.equal(usage(protocol, counts).failure, null);
  assert.deepEqual(protocol.usage, counts);
  assert.equal(
    protocol.receive({
      method: "turn/completed",
      params: {
        threadId: "thread_fixture",
        turn: { id: "turn_fixture", status: "completed" },
      },
    }).done,
    true,
  );
});

void test("missing, negative, inconsistent, regressing or wrong-thread usage blocks completion", () => {
  for (const bad of [
    {},
    { ...counts, inputTokens: -1 },
    { ...counts, cachedInputTokens: 11 },
    { ...counts, reasoningOutputTokens: 4 },
    { ...counts, totalTokens: 16 },
  ]) {
    const { protocol } = initialized(true);
    assert.equal(usage(protocol, bad).failure, "INVALID_PROTOCOL");
  }
  const { protocol } = initialized(true);
  usage(protocol, counts);
  assert.equal(
    usage(protocol, { ...counts, inputTokens: 9, totalTokens: 12 }).failure,
    "INVALID_PROTOCOL",
  );
  assert.equal(
    protocol.receive({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "forged",
        tokenUsage: { total: counts },
      },
    }).failure,
    "INVALID_PROTOCOL",
  );
  const missing = initialized(true).protocol;
  missing.receive({ id: 3, result: { turn: { id: "turn_fixture" } } });
  assert.equal(
    missing.receive({
      method: "turn/completed",
      params: {
        threadId: "thread_fixture",
        turn: { id: "turn_fixture", status: "completed" },
      },
    }).failure,
    "INVALID_PROTOCOL",
  );
});

void test("fixture request inspection retains tool inventory and output limit without secrets or total-limit claims", () => {
  const observed = inspectFixtureRequest({
    model: "quorum-fixture-model",
    stream: true,
    tools: [
      { type: "function", name: "shell" },
      {
        type: "namespace",
        name: "repo",
        tools: [{ type: "function", name: "read" }],
      },
    ],
    max_output_tokens: 32,
    instructions: "FAKE_SECRET_CANARY",
    input: [{ content: "FAKE_SECRET_CANARY" }],
  });
  assert.deepEqual(observed, {
    top_level_fields: [
      "input",
      "instructions",
      "max_output_tokens",
      "model",
      "stream",
      "tools",
    ],
    input_container: "array",
    input_items: 1,
    input_item_types: [],
    tool_types: ["function", "namespace"],
    tools: ["shell", "repo.read"],
    max_output_tokens: 32,
    store: null,
    stream: true,
    has_previous_response_id: false,
    has_conversation: false,
    hard_total_ceiling_verified: false,
  });
  assert.equal(JSON.stringify(observed).includes("FAKE_SECRET_CANARY"), false);
  assert.equal(
    inspectFixtureRequest({ model: "gpt-6-sol", stream: true, tools: [] }),
    null,
  );
  assert.match(fixtureResponseEvents(), /response.completed/);
});

void test("offline runner environment never inherits provider keys, proxies or user configuration", () => {
  assert.deepEqual(offlineEnvironment("/synthetic/home"), {
    HOME: "/synthetic/home",
    CODEX_HOME: "/synthetic/home",
    TMPDIR: "/synthetic/home",
    PATH: "/usr/bin:/bin",
    LANG: "en_US.UTF-8",
    NO_COLOR: "1",
  });
});

const fakeAppServer = `
import { createInterface } from 'node:readline';
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
 const message = JSON.parse(line);
 if (message.method === 'initialize') emit({ id: 1, result: { userAgent: 'fixture' } });
 if (message.method === 'thread/start') emit({ id: 2, result: { thread: { id: 'thread_fixture' } } });
 if (message.method === 'turn/start') {
  emit({ id: 3, result: { turn: { id: 'turn_fixture' } } });
  emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread_fixture', tokenUsage: { total: ${JSON.stringify(counts)} } } });
  emit({ method: 'turn/completed', params: { threadId: 'thread_fixture', turn: { id: 'turn_fixture', status: 'completed' } } });
 }
});
`;

async function invoke(
  code: string,
  overrides: {
    fakeProvider?: boolean;
    maxOutputBytes?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "quorum-offline-test-"));
  try {
    return await runOfflineProtocol({
      executable: process.execPath,
      args: ["--input-type=module", "-e", code],
      cwd: root,
      env: offlineEnvironment(root),
      fakeProvider: false,
      timeoutMs: 2000,
      maxOutputBytes: 16384,
      ...overrides,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void test("real stdio fixture initializes and stops before generation", async () => {
  const result = await invoke(fakeAppServer);
  assert.equal(result.failure, null);
  assert.equal(result.protocol.registered, true);
  assert.equal(result.protocol.completed, false);
});

void test("real stdio fixture observes completed fake usage without a provider", async () => {
  const result = await invoke(fakeAppServer, { fakeProvider: true });
  assert.equal(result.failure, null);
  assert.equal(result.protocol.completed, true);
  assert.deepEqual(result.protocol.usage, counts);
});

void test("transport retains interruption and rejects malformed output, excess diagnostics and early exit", async () => {
  const malformed = await invoke(
    "process.stdout.write('not-json\\n');setInterval(()=>{},1000)",
  );
  assert.equal(malformed.failure, "INVALID_PROTOCOL");
  const overflow = await invoke(
    "process.stderr.write('x'.repeat(10000));setInterval(()=>{},1000)",
    { maxOutputBytes: 64 },
  );
  assert.equal(overflow.failure, "OUTPUT_LIMIT");
  const early = await invoke("process.exit(0)");
  assert.equal(early.failure, "EARLY_EXIT");
  const timeout = await invoke("setInterval(()=>{},1000)", { timeoutMs: 100 });
  assert.equal(timeout.failure, "TIMED_OUT");
  const controller = new AbortController();
  controller.abort();
  const cancelled = await invoke(fakeAppServer, { signal: controller.signal });
  assert.equal(cancelled.failure, "CANCELLED");
});

void test("interrupted completion preserves observed usage without fabricating success", async () => {
  const interrupted = fakeAppServer.replace(
    "emit({ method: 'turn/completed'",
    "return; emit({ method: 'turn/completed'",
  );
  const result = await invoke(interrupted, {
    fakeProvider: true,
    timeoutMs: 1000,
  });
  assert.equal(result.failure, "TIMED_OUT");
  assert.equal(result.protocol.completed, false);
  assert.deepEqual(result.protocol.usage, counts);
});

void test("report schema rejects capability escalation and arbitrary diagnostics", () => {
  const report = {
    kind: "codex_offline_protocol",
    schema_version: "1.1.0",
    expected_version: "0.159.3",
    failure: null,
    enforced_conformance: false,
    external_model_attempts: 0,
    initialized: true,
    registered: true,
    completed: false,
    effective_tool_inventory: null,
    usage: null,
    provider_requests: [],
    mandatory_capabilities: "UNVERIFIED",
  };
  assert.equal(offlineReportSchema.safeParse(report).success, true);
  assert.equal(
    offlineReportSchema.safeParse({ ...report, enforced_conformance: true })
      .success,
    false,
  );
  assert.equal(
    offlineReportSchema.safeParse({ ...report, stderr: "fake-secret" }).success,
    false,
  );
});
