import * as readline from "node:readline";
import { formatBanner } from "./repl-banner.js";
import { dispatchReplLine } from "./repl-actions.js";
import { runInteractiveTerminal } from "./repl-interactive.js";
import { SLASH_COMMAND_DEFINITIONS } from "./repl-commands-def.js";
import type { ReplIo, ReplState, RunnerName } from "./repl-types.js";

export async function createInitialReplState(
  io: ReplIo,
  rootDir = process.cwd(),
  configPath = ".quorum/config.json",
): Promise<ReplState> {
  let activeRunner: RunnerName = "agy";
  const config = await io.readConfig(configPath);
  if (config.ok && typeof config.value === "object" && config.value !== null) {
    const raw = config.value as { adapter?: { name?: string } };
    if (raw.adapter?.name === "codex" || raw.adapter?.name === "agy") {
      activeRunner = raw.adapter.name;
    }
  }
  return {
    configPath,
    activeRunner,
    rootDir,
    activeSessionId: null,
    exitRequested: false,
    directSessions: {},
    timings: [],
  };
}

function startFallbackRepl(io: ReplIo, state: ReplState): Promise<void> {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const isTTY = Boolean((stdout as unknown as { isTTY?: boolean }).isTTY);

  const completer = (line: string): [string[], string] => {
    const names = SLASH_COMMAND_DEFINITIONS.map((c) => c.name);
    const hits = names.filter((cmd) => cmd.startsWith(line));
    return [hits.length ? hits : names, line];
  };

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    prompt: isTTY ? "\x1b[1;36mquorum>\x1b[0m " : "quorum> ",
    completer,
  });

  rl.prompt();

  return new Promise<void>((resolve) => {
    let queue = Promise.resolve();
    let inputClosed = false;
    rl.on("line", (line: string) => {
      queue = queue.then(async () => {
        if (state.exitRequested) return;
        const output = await dispatchReplLine(state, io, line);
        if (output.text) stdout.write(output.text + "\n");
        if (output.shouldExit || state.exitRequested) {
          if (!inputClosed) rl.close();
        } else if (!inputClosed) {
          rl.prompt();
        }
      });
    });

    rl.on("close", () => {
      inputClosed = true;
      void queue.then(() => resolve());
    });
  });
}

export async function startRepl(
  io: ReplIo,
  initialState?: ReplState,
): Promise<void> {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const isTTY = Boolean((stdout as unknown as { isTTY?: boolean }).isTTY);

  const state = initialState ?? (await createInitialReplState(io));
  stdout.write(formatBanner(state, isTTY) + "\n");

  const canUseRawMode =
    isTTY && typeof (stdin as NodeJS.ReadStream).setRawMode === "function";

  if (canUseRawMode) {
    await runInteractiveTerminal(io, state);
  } else {
    await startFallbackRepl(io, state);
  }
}
