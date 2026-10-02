import type { DirectPromptProgress } from "../application/direct-prompt.js";
import { sanitizeText } from "./repl-banner.js";
import { ansi, supportsTerminalStyle } from "./terminal-style.js";
import type { RunnerName } from "./repl-types.js";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const verbs = [
  "Consulting",
  "Propagating",
  "Scheming",
  "Honing",
  "Inspecting",
  "Synthesizing",
];

export interface ReplProgressDisplay {
  report: (progress: DirectPromptProgress) => void;
  stop: () => void;
}

export function createReplProgressDisplay(options: {
  output: NodeJS.WritableStream;
  runner: RunnerName;
  color?: boolean;
}): ReplProgressDisplay {
  const { output, runner } = options;
  const color = options.color ?? supportsTerminalStyle(output);
  if (!color) return createPlainDisplay(output, runner);
  const startedAt = Date.now();
  let frameIndex = 0;
  let currentMessage = "Preparing runner";
  let currentPhase: DirectPromptProgress["phase"] = "starting";
  let lastLogged = "";
  let stopped = false;
  const render = () => {
    const frame = frames[frameIndex % frames.length] ?? "⠋";
    const verb = loadingVerb(Date.now() - startedAt);
    frameIndex += 1;
    const messageColor = progressColor(currentPhase);
    output.write(
      `\r\x1b[2K${ansi.cyan}[${runner}]${ansi.reset} ${ansi.magenta}${frame} ${verb}${ansi.reset} ${ansi.dim}+${formatElapsed(Date.now() - startedAt)} ·${ansi.reset} ${messageColor}${boundedMessage(output, runner, currentMessage)}${ansi.reset}`,
    );
  };
  render();
  const timer = setInterval(render, 90);
  timer.unref();
  return {
    report(progress) {
      if (stopped) return;
      currentMessage = sanitizeText(progress.message);
      currentPhase = progress.phase;
      const shouldLog =
        progress.phase !== "tool" && progress.phase !== "working";
      const logKey = `${progress.phase}:${currentMessage}`;
      if (shouldLog && logKey !== lastLogged) {
        output.write(
          `\r\x1b[2K${formatProgressLine(runner, progress, Date.now() - startedAt)}\n`,
        );
        lastLogged = logKey;
      }
      render();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      output.write("\r\x1b[2K");
    },
  };
}

export function loadingVerb(elapsedMs: number): string {
  const index = Math.floor(Math.max(0, elapsedMs) / 10_000) % verbs.length;
  return verbs[index] ?? "Working";
}

function boundedMessage(
  output: NodeJS.WritableStream,
  runner: RunnerName,
  message: string,
): string {
  const columns = (output as { columns?: number }).columns ?? 80;
  const available = Math.max(20, columns - runner.length - 30);
  const characters = [...message];
  return characters.length <= available
    ? message
    : `${characters.slice(0, available - 1).join("")}…`;
}

function createPlainDisplay(
  output: NodeJS.WritableStream,
  runner: RunnerName,
): ReplProgressDisplay {
  const startedAt = Date.now();
  return {
    report: (progress) => {
      output.write(
        `[${runner}] ${sanitizeText(progress.message)} (${formatElapsed(Date.now() - startedAt)})\n`,
      );
    },
    stop: () => undefined,
  };
}

function formatProgressLine(
  runner: RunnerName,
  progress: DirectPromptProgress,
  elapsedMs: number,
): string {
  const symbols = {
    checking: "◇",
    starting: "◆",
    working: "●",
    tool: "→",
    finishing: "✓",
  };
  const color = progressColor(progress.phase);
  return `${ansi.cyan}[${runner}]${ansi.reset} ${color}${symbols[progress.phase]} ${sanitizeText(progress.message)}${ansi.reset} ${ansi.dim}(${formatElapsed(elapsedMs)})${ansi.reset}`;
}

function formatElapsed(elapsedMs: number): string {
  return `${(Math.max(0, elapsedMs) / 1_000).toFixed(1)}s`;
}

function progressColor(phase: DirectPromptProgress["phase"]): string {
  return {
    checking: ansi.blue,
    starting: ansi.magenta,
    working: ansi.cyan,
    tool: ansi.green,
    finishing: ansi.yellow,
  }[phase];
}
