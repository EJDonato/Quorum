import * as readline from "node:readline";
import { formatBanner } from "./repl-banner.js";
import { dispatchReplLine } from "./repl-actions.js";
import type { ReplIo, ReplState, RunnerName } from "./repl-types.js";

const SLASH_COMMANDS = [
  "/help",
  "/runner",
  "/doctor",
  "/config",
  "/status",
  "/diff",
  "/clear",
  "/exit",
  "/quit",
];

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
  };
}

function createCompleter() {
  return (line: string): [string[], string] => {
    const hits = SLASH_COMMANDS.filter((cmd) => cmd.startsWith(line));
    return [hits.length ? hits : SLASH_COMMANDS, line];
  };
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

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    prompt: isTTY ? "\x1b[1;36mquorum>\x1b[0m " : "quorum> ",
    completer: createCompleter(),
  });

  rl.prompt();

  return new Promise<void>((resolve) => {
    rl.on("line", (line: string) => {
      void (async () => {
        const output = await dispatchReplLine(state, io, line);
        if (output.text) {
          stdout.write(output.text + "\n");
        }
        if (output.shouldExit || state.exitRequested) {
          rl.close();
          return;
        }
        rl.prompt();
      })();
    });

    rl.on("close", () => {
      resolve();
    });
  });
}
