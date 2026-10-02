import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateAgyToolGate,
  generateAgyHooksConfig,
  installAgyToolGateHooks,
  runAgyToolGateCli,
  DEFAULT_BROKER_TOOLS,
} from "../../src/infrastructure/adapters/agy/tool-gate.js";

await test("evaluateAgyToolGate allows broker tools and denies native/unauthorized tools", () => {
  // Test every default broker tool
  for (const tool of DEFAULT_BROKER_TOOLS) {
    const res = evaluateAgyToolGate({
      toolCall: { name: tool, args: {} },
      stepIdx: 1,
    });
    assert.deepEqual(res, { decision: "allow" });
  }

  // Test prohibited native tools
  const prohibited = [
    "run_command",
    "write_to_file",
    "replace_file_content",
    "generate_image",
    "browser_open",
    "search_web",
    "ask_question",
    "schedule",
    "call_mcp_tool",
  ];

  for (const tool of prohibited) {
    const res = evaluateAgyToolGate({
      toolCall: { name: tool, args: { cmd: "ls" } },
      stepIdx: 2,
    });
    assert.equal(res.decision, "deny");
    assert.ok(res.reason.includes("Unauthorized tool"));
  }
});

await test("evaluateAgyToolGate fails closed on invalid/malformed payloads", () => {
  const malformedInputs: unknown[] = [
    null,
    undefined,
    "",
    123,
    {},
    { toolCall: {} },
    { toolCall: { name: "" } },
    { toolCall: { name: 123 } },
  ];

  for (const input of malformedInputs) {
    const res = evaluateAgyToolGate(input);
    assert.equal(res.decision, "deny");
    assert.ok(res.reason.includes("Malformed PreToolUse"));
  }
});

await test("evaluateAgyToolGate supports custom restricted tool sets", () => {
  const readOnlySet = new Set(["repo.read"]);
  const allowed = evaluateAgyToolGate(
    { toolCall: { name: "repo.read", args: {} } },
    readOnlySet,
  );
  assert.deepEqual(allowed, { decision: "allow" });

  const denied = evaluateAgyToolGate(
    { toolCall: { name: "draft.apply_patch", args: {} } },
    readOnlySet,
  );
  assert.equal(denied.decision, "deny");
});

await test("generateAgyHooksConfig creates valid structure", () => {
  const config = generateAgyHooksConfig("node /bin/gate.js", 10);
  assert.deepEqual(config, {
    "quorum-broker-gate": {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: "node /bin/gate.js",
              timeout: 10,
            },
          ],
        },
      ],
    },
  });
});

await test("installAgyToolGateHooks writes atomic .agents/hooks.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "quorum-agy-hook-"));
  try {
    const outcome = await installAgyToolGateHooks(root, "node /bin/gate.js", 3);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    const fileContent = await readFile(outcome.value, "utf8");
    const parsed = JSON.parse(fileContent) as Record<string, unknown>;
    assert.ok(parsed["quorum-broker-gate"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("runAgyToolGateCli processes stdin stream and outputs decision to stdout", async () => {
  const input = JSON.stringify({
    toolCall: { name: "run_command", args: { CommandLine: "rm -rf /" } },
    stepIdx: 5,
  });
  const readable = Readable.from([input]);
  let output = "";
  const writable = new Writable({
    write(chunk: unknown, _encoding, callback) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      output += buf.toString("utf8");
      callback();
    },
  });

  await runAgyToolGateCli(readable, writable);
  const decision = JSON.parse(output.trim()) as {
    decision: string;
    reason: string;
  };
  assert.equal(decision.decision, "deny");
  assert.ok(decision.reason.includes("Unauthorized tool 'run_command'"));
});
