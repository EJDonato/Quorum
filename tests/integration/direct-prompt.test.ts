import assert from "node:assert/strict";
import test from "node:test";
import { createDirectPromptRunner } from "../../src/infrastructure/adapters/direct-prompt.js";
import type { Outcome } from "../../src/contracts/errors.js";
import {
  runProcess,
  type ProcessRunOptions,
  type ProcessRunResult,
} from "../../src/infrastructure/process/runner.js";

type ProcessPort = (
  options: ProcessRunOptions,
) => Promise<Outcome<ProcessRunResult>>;

function success(stdout: string): Outcome<ProcessRunResult> {
  return { ok: true, value: { stdout, stderr: "", exitCode: 0 } };
}

await test("direct Agy prompt verifies version and uses bounded read-only arguments", async () => {
  const calls: ProcessRunOptions[] = [];
  const process: ProcessPort = (options) => {
    calls.push(options);
    return Promise.resolve(
      calls.length === 1
        ? success("1.2.14\n")
        : success(
            JSON.stringify({
              conversation_id: "conversation-1",
              status: "SUCCESS",
              response: "QUORUM_OK\n",
              duration_seconds: 1,
              num_turns: 1,
              usage: {
                input_tokens: 10,
                output_tokens: 2,
                thinking_tokens: 0,
                cache_read_tokens: 0,
                total_tokens: 12,
              },
            }),
          ),
    );
  };
  const run = createDirectPromptRunner(process);

  const result = await run({
    runner: "agy",
    executable: "agy",
    expectedVersion: "1.2.14",
    model: "gemini-3.8-flash-medium",
    prompt: "explain how quorum works",
    cwd: "/repo",
    timeoutMs: 60_000,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.text, "QUORUM_OK");
  assert.deepEqual(calls[0]?.args, ["--version"]);
  assert.deepEqual(calls[1]?.args, [
    "--sandbox",
    "--mode",
    "plan",
    "--model",
    "gemini-3.8-flash-medium",
    "--print-timeout",
    "60s",
    "--output-format",
    "json",
    "--print",
    "explain how quorum works",
  ]);
  assert.equal(calls[1]?.maxOutputBytes, 1_048_576);
});

await test("direct Codex prompt accepts one completed agent message", async () => {
  const calls: ProcessRunOptions[] = [];
  const progress: string[] = [];
  const events = [
    { type: "thread.started", thread_id: "thread-1" },
    {
      type: "item.completed",
      item: { id: "item-1", type: "agent_message", text: "QUORUM_OK" },
    },
    { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } },
  ];
  const process: ProcessPort = (options) => {
    calls.push(options);
    if (calls.length === 2) {
      options.onStdoutLine?.('{"type":"thread.started"}');
      options.onStdoutLine?.('{"type":"turn.started"}');
      options.onStdoutLine?.(
        JSON.stringify({
          type: "item.started",
          item: {
            type: "command_execution",
            command: "sed -n '1,40p' 'README.md'",
          },
        }),
      );
    }
    return Promise.resolve(
      calls.length === 1
        ? success("codex-cli 0.159.3\n")
        : success(events.map((event) => JSON.stringify(event)).join("\n")),
    );
  };
  const run = createDirectPromptRunner(process);

  const result = await run(
    {
      runner: "codex",
      executable: "codex",
      expectedVersion: "0.159.3",
      model: "gpt-6-sol",
      prompt: "Reply with QUORUM_OK.",
      cwd: "/repo",
      timeoutMs: 60_000,
    },
    undefined,
    (event) => progress.push(event.message),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.text, "QUORUM_OK");
  assert.deepEqual(calls[1]?.args, [
    "exec",
    "--model",
    "gpt-6-sol",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--json",
    "Reply with QUORUM_OK.",
  ]);
  assert.deepEqual(progress, [
    "Checking runner version.",
    "Starting gpt-6-sol in read-only mode.",
    "Runner session started.",
    "Analyzing the request.",
    "Reading files: README.md",
    "Processing response.",
    "Response ready.",
  ]);
});

await test("process runner streams lines without changing captured output", async () => {
  const lines: string[] = [];
  const result = await runProcess({
    executable: process.execPath,
    args: [
      "-e",
      "process.stdout.write('alpha\\nbe'); setTimeout(() => process.stdout.end('ta'), 5)",
    ],
    cwd: process.cwd(),
    timeoutMs: 1_000,
    onStdoutLine: (line) => lines.push(line),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.stdout, "alpha\nbeta");
  assert.deepEqual(lines, ["alpha", "beta"]);
});

await test("direct prompt stops before generation on version mismatch", async () => {
  let calls = 0;
  const run = createDirectPromptRunner(() => {
    calls += 1;
    return Promise.resolve(success("codex-cli 0.158.0\n"));
  });

  const result = await run({
    runner: "codex",
    executable: "codex",
    expectedVersion: "0.159.3",
    model: "gpt-6-sol",
    prompt: "hello",
    cwd: "/repo",
    timeoutMs: 60_000,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "CAPABILITY_MISSING");
  assert.equal(calls, 1);
});

await test("direct prompt rejects failed Codex output and joins response segments", async () => {
  let calls = 0;
  const output = [
    '{"type":"item.completed","item":{"type":"agent_message","text":"one"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"two"}}',
    '{"type":"turn.completed"}',
  ].join("\n");
  const run = createDirectPromptRunner(() => {
    calls += 1;
    return Promise.resolve(
      calls === 1 ? success("codex-cli 0.159.3\n") : success(output),
    );
  });
  const request = {
    runner: "codex" as const,
    executable: "codex",
    expectedVersion: "0.159.3",
    model: "gpt-6-sol",
    prompt: "hello",
    cwd: "/repo",
    timeoutMs: 60_000,
  };

  const result = await run(request);
  assert.deepEqual(result, {
    ok: true,
    value: {
      runner: "codex",
      runnerVersion: "0.159.3",
      model: "gpt-6-sol",
      text: "one\n\ntwo",
    },
  });

  calls = 0;
  const failed = createDirectPromptRunner(() => {
    calls += 1;
    return Promise.resolve(
      calls === 1
        ? success("codex-cli 0.159.3\n")
        : success('{"type":"turn.failed"}\n'),
    );
  });
  const failure = await failed(request);
  assert.equal(failure.ok, false);
});

await test("direct Agy prompt preserves a bounded provider error", async () => {
  let calls = 0;
  const run = createDirectPromptRunner(() => {
    calls += 1;
    return Promise.resolve(
      calls === 1
        ? success("1.2.14\n")
        : {
            ok: true,
            value: {
              stdout: JSON.stringify({
                status: "ERROR",
                error: "Individual quota reached.",
              }),
              stderr: "provider diagnostic",
              exitCode: 1,
            },
          },
    );
  });

  const result = await run({
    runner: "agy",
    executable: "agy",
    expectedVersion: "1.2.14",
    model: "gemini-3.8-flash-medium",
    prompt: "hello",
    cwd: "/repo",
    timeoutMs: 60_000,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "CAPABILITY_MISSING");
  assert.match(result.error.message, /Individual quota reached/u);
  assert.doesNotMatch(result.error.message, /provider diagnostic/u);
});
