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
  let frameIndex = 0;
  let currentMessage = "Preparing runner";
  let stopped = false;
  const render = () => {
    const frame = frames[frameIndex % frames.length] ?? "⠋";
    const verb = verbs[Math.floor(frameIndex / 8) % verbs.length] ?? "Working";
    frameIndex += 1;
    output.write(
      `\r\x1b[2K${ansi.cyan}[${runner}]${ansi.reset} ${ansi.magenta}${frame} ${verb}${ansi.reset} ${ansi.dim}· ${currentMessage}${ansi.reset}`,
    );
  };
  render();
  const timer = setInterval(render, 90);
  timer.unref();
  return {
    report(progress) {
      if (stopped) return;
      currentMessage = sanitizeText(progress.message);
      output.write(`\r\x1b[2K${formatProgressLine(runner, progress)}\n`);
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

function createPlainDisplay(
  output: NodeJS.WritableStream,
  runner: RunnerName,
): ReplProgressDisplay {
  return {
    report: (progress) => {
      output.write(`[${runner}] ${sanitizeText(progress.message)}\n`);
    },
    stop: () => undefined,
  };
}

function formatProgressLine(
  runner: RunnerName,
  progress: DirectPromptProgress,
): string {
  const colors = {
    checking: ansi.blue,
    starting: ansi.magenta,
    working: ansi.cyan,
    tool: ansi.green,
    finishing: ansi.yellow,
  };
  const symbols = {
    checking: "◇",
    starting: "◆",
    working: "●",
    tool: "→",
    finishing: "✓",
  };
  const color = colors[progress.phase];
  return `${ansi.cyan}[${runner}]${ansi.reset} ${color}${symbols[progress.phase]} ${sanitizeText(progress.message)}${ansi.reset}`;
}
