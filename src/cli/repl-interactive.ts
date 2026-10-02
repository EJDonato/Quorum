import * as readline from "node:readline";
import { getMatchingSlashCommands } from "./repl-commands-def.js";
import { clearDropdown, renderDropdown } from "./repl-dropdown.js";
import { dispatchReplLine } from "./repl-actions.js";
import type { ReplIo, ReplState } from "./repl-types.js";

interface BufferState {
  buffer: string;
  cursorIndex: number;
  selectedIndex: number;
  dropdownLineCount: number;
}

const PROMPT_STR = "quorum> ";
const PROMPT_COLOR = "\x1b[1;36mquorum>\x1b[0m ";

function refreshDisplay(
  stdout: NodeJS.WritableStream,
  state: BufferState,
): void {
  if (state.dropdownLineCount > 0) {
    clearDropdown(stdout, state.dropdownLineCount, 0);
    state.dropdownLineCount = 0;
  }
  const cursorCol = PROMPT_STR.length + state.cursorIndex;
  stdout.write(`\r\x1b[K${PROMPT_COLOR}${state.buffer}`);

  const matches = getMatchingSlashCommands(state.buffer);
  if (matches.length > 0) {
    if (state.selectedIndex >= matches.length) state.selectedIndex = 0;
    state.dropdownLineCount = renderDropdown(stdout, matches, {
      selectedIndex: state.selectedIndex,
      cursorCol,
    });
  } else {
    const moveRight = cursorCol > 0 ? `\x1b[${cursorCol}C` : "";
    stdout.write(`\r${moveRight}`);
  }
}

function handleKeyNavigation(key: readline.Key, state: BufferState): boolean {
  const matches = getMatchingSlashCommands(state.buffer);
  if (key.name === "down" && matches.length > 0) {
    state.selectedIndex = (state.selectedIndex + 1) % matches.length;
    return true;
  }
  if (key.name === "up" && matches.length > 0) {
    state.selectedIndex =
      (state.selectedIndex - 1 + matches.length) % matches.length;
    return true;
  }
  if (key.name === "left" && state.cursorIndex > 0) {
    state.cursorIndex--;
    return true;
  }
  if (key.name === "right" && state.cursorIndex < state.buffer.length) {
    state.cursorIndex++;
    return true;
  }
  return false;
}

function handleTextEdit(
  str: string | undefined,
  key: readline.Key,
  state: BufferState,
): boolean {
  if (key.name === "backspace" && state.cursorIndex > 0) {
    state.buffer =
      state.buffer.slice(0, state.cursorIndex - 1) +
      state.buffer.slice(state.cursorIndex);
    state.cursorIndex--;
    state.selectedIndex = 0;
    return true;
  }
  if (key.name === "delete" && state.cursorIndex < state.buffer.length) {
    state.buffer =
      state.buffer.slice(0, state.cursorIndex) +
      state.buffer.slice(state.cursorIndex + 1);
    state.selectedIndex = 0;
    return true;
  }
  if (str && str.length === 1 && str >= " ") {
    state.buffer =
      state.buffer.slice(0, state.cursorIndex) +
      str +
      state.buffer.slice(state.cursorIndex);
    state.cursorIndex++;
    state.selectedIndex = 0;
    return true;
  }
  return false;
}

function handleTabAutocomplete(state: BufferState): boolean {
  const matches = getMatchingSlashCommands(state.buffer);
  if (matches.length === 0) return false;
  const selected = matches[state.selectedIndex] ?? matches[0];
  if (!selected) return false;
  state.buffer = selected.name + (selected.needsArg ? " " : "");
  state.cursorIndex = state.buffer.length;
  state.selectedIndex = 0;
  return true;
}

interface TerminalContext {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  state: BufferState;
  io: ReplIo;
  replState: ReplState;
  resolve: () => void;
}

export async function runInteractiveTerminal(
  io: ReplIo,
  replState: ReplState,
): Promise<void> {
  const stdin = (io.stdin ?? process.stdin) as NodeJS.ReadStream;
  const stdout = (io.stdout ?? process.stdout) as NodeJS.WriteStream;

  const state: BufferState = {
    buffer: "",
    cursorIndex: 0,
    selectedIndex: 0,
    dropdownLineCount: 0,
  };

  stdin.setRawMode?.(true);
  stdin.resume();
  readline.emitKeypressEvents(stdin);
  refreshDisplay(stdout, state);

  return new Promise<void>((resolve) => {
    bindTerminalEvents({ stdin, stdout, state, io, replState, resolve });
  });
}

function bindTerminalEvents(ctx: TerminalContext): void {
  const { stdin, stdout, state, replState } = ctx;

  const keyHandler = (str: string | undefined, key: readline.Key): void => {
    if ((key.ctrl && key.name === "c") || (key.ctrl && key.name === "d")) {
      clearDropdown(stdout, state.dropdownLineCount, 0);
      stdout.write("\nExiting Quorum CLI. Goodbye!\n");
      replState.exitRequested = true;
      closeInteractiveTerminal(ctx, keyHandler);
      return;
    }
    if (key.name === "return") {
      void handleSubmitLine(ctx, keyHandler);
      return;
    }
    if (key.name === "tab") {
      if (handleTabAutocomplete(state)) refreshDisplay(stdout, state);
      return;
    }
    if (handleKeyNavigation(key, state) || handleTextEdit(str, key, state)) {
      refreshDisplay(stdout, state);
    }
  };

  stdin.on("keypress", keyHandler);
}

async function handleSubmitLine(
  ctx: TerminalContext,
  keyHandler: (str: string | undefined, key: readline.Key) => void,
): Promise<void> {
  const { stdin, stdout, state, io, replState } = ctx;
  const matches = getMatchingSlashCommands(state.buffer);
  if (matches.length > 0 && !state.buffer.includes(" ")) {
    const sel = matches[state.selectedIndex] ?? matches[0];
    if (sel && sel.needsArg && state.buffer !== sel.name) {
      state.buffer = `${sel.name} `;
      state.cursorIndex = state.buffer.length;
      refreshDisplay(stdout, state);
      return;
    }
    if (sel && !sel.needsArg) state.buffer = sel.name;
  }

  clearDropdown(stdout, state.dropdownLineCount, 0);
  stdout.write("\n");
  stdin.setRawMode?.(false);

  const output = await dispatchReplLine(replState, io, state.buffer);
  if (output.text) stdout.write(output.text + "\n");

  if (output.shouldExit || replState.exitRequested) {
    closeInteractiveTerminal(ctx, keyHandler, false);
    return;
  }

  state.buffer = "";
  state.cursorIndex = 0;
  state.selectedIndex = 0;
  state.dropdownLineCount = 0;
  stdin.setRawMode?.(true);
  refreshDisplay(stdout, state);
}

function closeInteractiveTerminal(
  ctx: TerminalContext,
  keyHandler: (str: string | undefined, key: readline.Key) => void,
  disableRawMode = true,
): void {
  ctx.stdin.removeListener("keypress", keyHandler);
  if (disableRawMode) ctx.stdin.setRawMode?.(false);
  ctx.stdin.pause();
  ctx.resolve();
}
