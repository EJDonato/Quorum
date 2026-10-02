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

await test("dispatchReplLine routes freeform prompt to council dispatch", async () => {
  const io = createMockIo();
  const state: ReplState = {
    configPath: fixture,
    activeRunner: "agy",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const res = await dispatchReplLine(state, io, "Implement JWT authentication");
  assert.match(res.text, /Quorum Council Dispatch/);
  assert.match(res.text, /Prompt: "Implement JWT authentication"/);
  assert.match(res.text, /Assigned Runner: agy/);
  assert.match(res.text, /Workflow Pipeline Execution Stages/);
  assert.match(res.text, /Planner/);
  assert.match(res.text, /QA Authoring/);
  assert.match(res.text, /Developer/);
  assert.match(res.text, /Checks/);
  assert.match(res.text, /Ballot/);
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
