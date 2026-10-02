import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { resolve } from "node:path";
import { readConfiguration } from "../../src/infrastructure/configuration.js";
import { createInitialReplState, startRepl } from "../../src/cli/repl.js";
import {
  dispatchReplLine,
  handleConfigCommand,
  handleDoctorCommand,
  handleRunnerCommand,
} from "../../src/cli/repl-actions.js";
import type { ReplIo, ReplState } from "../../src/cli/repl-types.js";

const fixture = resolve("tests/fixtures/config.json");

function createMockIo(): ReplIo {
  return {
    readConfig: readConfiguration,
  };
}

await test("createInitialReplState detects runner from configuration", async () => {
  const io = createMockIo();
  const state = await createInitialReplState(io, process.cwd(), fixture);
  assert.equal(state.activeRunner, "codex");
  assert.equal(state.configPath, fixture);
  assert.equal(state.exitRequested, false);
});

await test("/runner slash command shows and switches active runner", () => {
  const state: ReplState = {
    configPath: fixture,
    activeRunner: "agy",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const show = handleRunnerCommand(state);
  assert.match(show.text, /Active runner: agy/);

  const switchToCodex = handleRunnerCommand(state, "codex");
  assert.equal(state.activeRunner, "codex");
  assert.match(switchToCodex.text, /Switched active runner to: codex/);

  const switchToAgy = handleRunnerCommand(state, "agy");
  assert.equal(state.activeRunner, "agy");
  assert.match(switchToAgy.text, /Switched active runner to: agy/);

  const invalid = handleRunnerCommand(state, "unknown-runner");
  assert.match(invalid.text, /Unknown runner 'unknown-runner'/);
});

await test("/doctor slash command inspects capabilities through configuration", async () => {
  const io = createMockIo();
  const state: ReplState = {
    configPath: fixture,
    activeRunner: "codex",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const output = await handleDoctorCommand(state, io);
  assert.match(output.text, /Quorum Doctor Diagnostics/);
  assert.match(output.text, /configuration: valid/);
  assert.match(output.text, /runner_conformance: unverified/);
});

await test("/config slash command validates target configuration", async () => {
  const io = createMockIo();
  const state: ReplState = {
    configPath: fixture,
    activeRunner: "codex",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const output = await handleConfigCommand(state, io);
  assert.match(output.text, /Configuration valid/);
  assert.match(output.text, /Adapter: codex/);
  assert.match(output.text, /Mode: enforced/);

  const invalidOutput = await handleConfigCommand(
    state,
    io,
    "absent-config.json",
  );
  assert.match(invalidOutput.text, /Config invalid/);
});

await test("dispatchReplLine handles /help, /status, /diff, /clear, and /exit", async () => {
  const io = createMockIo();
  const state: ReplState = {
    configPath: fixture,
    activeRunner: "agy",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const help = await dispatchReplLine(state, io, "/help");
  assert.match(help.text, /Available Slash Commands/);

  const status = await dispatchReplLine(state, io, "/status");
  assert.match(status.text, /No active session/);

  const diff = await dispatchReplLine(state, io, "/diff");
  assert.match(diff.text, /No active candidate diff/);

  const exit = await dispatchReplLine(state, io, "/exit");
  assert.equal(exit.shouldExit, true);
  assert.equal(state.exitRequested, true);
});

await test("startRepl processes stream of commands and exits cleanly", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let capturedStdout = "";
  stdout.on("data", (chunk: Buffer) => {
    capturedStdout += chunk.toString("utf-8");
  });

  const io: ReplIo = {
    readConfig: readConfiguration,
    stdin,
    stdout,
  };

  const state: ReplState = {
    configPath: fixture,
    activeRunner: "agy",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const replPromise = startRepl(io, state);
  stdin.write("/runner codex\n");
  stdin.write("/status\n");
  stdin.write("/exit\n");

  await replPromise;
  assert.match(capturedStdout, /Quorum Interactive Council/);
  assert.match(capturedStdout, /Switched active runner to: codex/);
  assert.match(capturedStdout, /Exiting Quorum CLI/);
  assert.equal(state.activeRunner, "codex");
  assert.equal(state.exitRequested, true);
});

await test("startRepl drains an asynchronous prompt after piped input closes", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let capturedStdout = "";
  stdout.on("data", (chunk: Buffer) => {
    capturedStdout += chunk.toString("utf8");
  });
  const io: ReplIo = {
    readConfig: readConfiguration,
    directPrompt: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        ok: true,
        value: {
          runner: "agy",
          runnerVersion: "1.2.14",
          model: "gemini-3.8-flash-medium",
          text: "A delayed answer.",
        },
      };
    },
    stdin,
    stdout,
  };
  const state: ReplState = {
    configPath: fixture,
    activeRunner: "agy",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const replPromise = startRepl(io, state);
  stdin.end("explain quorum\n");
  await replPromise;

  assert.match(capturedStdout, /A delayed answer/);
  assert.match(capturedStdout, /not Quorum approval evidence/);
});

await test("/run slash command validates prompt and executes session runner", async () => {
  let sessionExecuted = false;
  const io: ReplIo = {
    readConfig: readConfiguration,
    sessionRunner: (opts) => {
      sessionExecuted = true;
      return Promise.resolve({
        ok: true,
        value: {
          sessionId: opts.sessionId,
          state: {
            schema_version: "1.0.0",
            session_id: opts.sessionId,
            repository_id: "repo-1",
            base_commit: { format: "sha1", oid: opts.baseSha },
            mode: "enforced",
            state: "COMPLETED",
            state_sequence: 10,
            current_candidate_id: "cand-1",
            input_digest: "sha256:" + "0".repeat(64),
            limits: {
              repairs_per_stage: 2,
              repairs_total: 5,
              invocation_timeout_ms: 600000,
              check_timeout_ms: 600000,
              active_session_ms: 10000,
              model_tokens: 1000,
            },
            budget: {
              repairs_by_stage: {
                PLANNING: 0,
                DESIGN_REVIEW: 0,
                TEST_SPEC: 0,
                IMPLEMENTING: 0,
                VALIDATING: 0,
                REVIEWING: 0,
              },
              repairs_total: 0,
              tokens_charged: 100,
              active_elapsed_ms: 500,
            },
            blocking_reason: null,
          },
          candidateId: "cand-1",
          receipt: {
            schema_version: "1.0.0",
            transaction_id: "tx-1",
            session_id: opts.sessionId,
            candidate_id: "cand-1",
            commit: {
              format: "sha1",
              oid: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
            },
            tree: {
              format: "sha1",
              oid: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
            },
            parent: { format: "sha1", oid: opts.baseSha },
            evidence_refs: [
              { artifact_id: "art-1", digest: "sha256:" + "1".repeat(64) },
            ],
          },
        },
      });
    },
  };

  const state: ReplState = {
    configPath: fixture,
    activeRunner: "agy",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const missingPrompt = await dispatchReplLine(state, io, "/run");
  assert.match(missingPrompt.text, /Missing prompt for \/run/);

  const ran = await dispatchReplLine(state, io, "/run Add test helper");
  assert.match(ran.text, /completed!/);
  assert.match(ran.text, /State: COMPLETED/);
  assert.match(
    ran.text,
    /Commit OID: 4b825dc642cb6eb9a060e54bf8d69288fbee4904/,
  );
  assert.equal(sessionExecuted, true);
  assert.ok(state.activeSessionId);
});

await test("/doctor reports operational readiness for verified configurations", async () => {
  const io: ReplIo = {
    readConfig: () =>
      Promise.resolve({
        ok: true,
        value: {
          schema_version: "1.0.0",
          adapter: {
            name: "codex",
            version: "0.159.3",
            model: "codex-1",
          },
          mode: "enforced",
          validation_image:
            "quorum-validation@sha256:0000000000000000000000000000000000000000000000000000000000000000",
          commands: [
            {
              check_id: "test",
              kind: "test",
              executable: "npm",
              args: ["test"],
            },
          ],
          permitted_environment_keys: ["NODE_ENV"],
          paths: {
            implementation: ["src"],
            tests: ["tests"],
            protected: ["package.json"],
            sensitive: [".env"],
          },
          budgets: {
            repairs_per_stage: 2,
            repairs_total: 6,
            invocation_timeout_ms: 600000,
            check_timeout_ms: 600000,
            active_session_ms: 3600000,
            model_tokens: 200000,
          },
        },
      }),
  };
  const state: ReplState = {
    configPath: ".quorum/config.json",
    activeRunner: "codex",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const output = await handleDoctorCommand(state, io);
  assert.match(output.text, /Ready: true \(operational\)/);
  assert.match(output.text, /✓ runner_conformance: verified/);
  assert.match(output.text, /✓ broker_only_tools: verified/);
  assert.match(output.text, /✓ container_isolation: verified/);
  assert.match(output.text, /✓ usage_and_hard_token_ceiling: verified/);
  assert.match(output.text, /✓ descendant_cancellation: verified/);
  assert.match(output.text, /✓ validation_environment: verified/);
});
