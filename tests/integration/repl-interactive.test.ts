import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { dispatchReplLine } from "../../src/cli/repl-actions.js";
import { runInteractiveTerminal } from "../../src/cli/repl-interactive.js";
import type { ReplIo, ReplState } from "../../src/cli/repl-types.js";

await test(
  "interactive backspace clears slash suggestions and exit releases stdin",
  { timeout: 2_000 },
  async () => {
    const stdin = new PassThrough() as PassThrough & {
      setRawMode: (enabled: boolean) => void;
    };
    const stdout = new PassThrough();
    const rawModes: boolean[] = [];
    let captured = "";
    stdin.setRawMode = (enabled) => rawModes.push(enabled);
    Object.defineProperty(stdout, "isTTY", { value: true });
    stdout.on("data", (chunk: Buffer) => {
      captured += chunk.toString("utf8");
    });
    const io: ReplIo = {
      readConfig: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "unused",
            retryable: false,
            remediation: "unused",
          },
        }),
      stdin,
      stdout,
    };
    const state: ReplState = {
      configPath: ".quorum/config.json",
      activeRunner: "codex",
      rootDir: process.cwd(),
      activeSessionId: null,
      exitRequested: false,
    };

    const running = runInteractiveTerminal(io, state);
    stdin.write("/");
    await nextTurn();
    assert.match(captured, /\/help/);

    stdin.write("\x7f");
    await nextTurn();
    const lastClear = captured.lastIndexOf("\x1b[B\x1b[J\x1b[A");
    assert.ok(lastClear >= 0);
    const redrawn = captured.slice(lastClear);
    assert.match(redrawn, /quorum>/);
    assert.doesNotMatch(redrawn, /\/help/);

    stdin.write("/exit\r");
    await running;
    assert.deepEqual(rawModes, [true, false]);
    assert.equal(stdin.isPaused(), true);
    assert.equal(state.exitRequested, true);
    assert.match(captured, /Exiting Quorum CLI/);
  },
);

await test("/quit is not an exit alias", async () => {
  const state: ReplState = {
    configPath: ".quorum/config.json",
    activeRunner: "agy",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };
  const output = await dispatchReplLine(
    state,
    {
      readConfig: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "unused",
            retryable: false,
            remediation: "unused",
          },
        }),
    },
    "/quit",
  );
  assert.match(output.text, /Unknown slash command/);
  assert.equal(output.shouldExit, undefined);
  assert.equal(state.exitRequested, false);
});

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
