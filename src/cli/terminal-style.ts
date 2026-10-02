import { sanitizeText } from "./repl-banner.js";
import type { RunnerName } from "./repl-types.js";

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  underline: "\x1b[4m",
};

interface RunnerResponseOptions {
  runner: RunnerName;
  model: string;
  text: string;
  color: boolean;
}

export function supportsTerminalStyle(output: NodeJS.WritableStream): boolean {
  return isInteractiveTerminal(output) && process.env.NO_COLOR === undefined;
}

export function isInteractiveTerminal(output: NodeJS.WritableStream): boolean {
  return Boolean((output as { isTTY?: boolean }).isTTY);
}

export function formatRunnerResponse(options: RunnerResponseOptions): string {
  const { runner, model, text, color } = options;
  if (!color)
    return [
      `${runner} response (${model}, read-only direct mode):`,
      sanitizeText(text),
      "",
      "This response is not Quorum approval evidence. Use /run <task> for the council workflow.",
    ].join("\n");
  return [
    `${ansi.bold}${ansi.cyan}${runner} response${ansi.reset} ${ansi.dim}(${model}, read-only direct mode)${ansi.reset}`,
    formatTerminalMarkdown(text),
    "",
    `${ansi.yellow}◆${ansi.reset} ${ansi.dim}This response is not Quorum approval evidence. Use ${ansi.bold}/run <task>${ansi.reset}${ansi.dim} for the council workflow.${ansi.reset}`,
  ].join("\n");
}

export function formatTerminalMarkdown(text: string): string {
  const safe = sanitizeText(text);
  let inCodeBlock = false;
  return safe
    .split("\n")
    .map((line) => {
      if (/^\s*```/u.test(line)) {
        inCodeBlock = !inCodeBlock;
        return `${ansi.dim}${line}${ansi.reset}`;
      }
      if (inCodeBlock) return `${ansi.green}│ ${line}${ansi.reset}`;
      return formatMarkupLine(line);
    })
    .join("\n");
}

function formatMarkupLine(line: string): string {
  const styled: string[] = [];
  const protect = (value: string): string => {
    const index = styled.push(value) - 1;
    return `\u{e000}${index}\u{e001}`;
  };
  let output = line.replace(/^\s*(#{1,6})\s+(.+)$/u, (_match, _marks, title) =>
    protect(`${ansi.bold}${ansi.magenta}${String(title)}${ansi.reset}`),
  );
  output = output.replace(
    /\[([^\]\n]+)\]\(((?:\.?\.?\/|\/)[^)\n]+\.(?:c|css|go|html|java|js|json|jsx|md|mjs|py|rs|sh|ts|tsx|txt|yaml|yml)(?::\d+)?)\)/gu,
    (_match, label, path) =>
      protect(
        `${ansi.green}${ansi.underline}${String(label)}${ansi.reset} ${ansi.dim}${ansi.green}(${String(path)})${ansi.reset}`,
      ),
  );
  output = output.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gu,
    (_match, label, url) =>
      protect(
        `${ansi.blue}${ansi.underline}${String(label)}${ansi.reset} ${ansi.dim}(${String(url)})${ansi.reset}`,
      ),
  );
  output = output.replace(/https?:\/\/[^\s<>()]+/gu, (url) =>
    protect(`${ansi.blue}${ansi.underline}${url}${ansi.reset}`),
  );
  output = output.replace(/\*\*([^*\n]+)\*\*/gu, (_match, content) =>
    protect(`${ansi.bold}${String(content)}${ansi.reset}`),
  );
  output = output.replace(/`([^`\n]+)`/gu, (_match, code) =>
    protect(
      `${isFilePath(String(code)) ? ansi.green : ansi.cyan}${String(code)}${ansi.reset}`,
    ),
  );
  output = output.replace(filePathPattern(), (path) =>
    protect(`${ansi.green}${path}${ansi.reset}`),
  );
  output = output.replace(
    /^(\s*)([-*]|\d+\.)\s/u,
    (_match, space, marker) =>
      `${String(space)}${ansi.cyan}${String(marker)}${ansi.reset} `,
  );
  return output.replace(/\u{e000}(\d+)\u{e001}/gu, (_match, index) => {
    return styled[Number(index)] ?? "";
  });
}

function filePathPattern(): RegExp {
  return /(?<![\w:])(?:\/(?:[A-Za-z0-9_.-]+(?: [A-Za-z0-9_.-]+)*\/)*[A-Za-z0-9_.-]+\.(?:c|css|go|html|java|js|json|jsx|md|mjs|py|rs|sh|ts|tsx|txt|yaml|yml)(?::\d+)?|(?:\.?\.?\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:c|css|go|html|java|js|json|jsx|md|mjs|py|rs|sh|ts|tsx|txt|yaml|yml)(?::\d+)?)/gu;
}

function isFilePath(value: string): boolean {
  const match = value.match(filePathPattern());
  return match?.length === 1 && match[0] === value;
}

export async function writeAnimatedTerminalText(
  output: NodeJS.WritableStream,
  text: string,
  options: { chunkSize?: number; delayMs?: number } = {},
): Promise<void> {
  const visibleLength = [...text.replace(/\x1b\[[0-9;]*m/gu, "")].length;
  const chunkSize =
    options.chunkSize ?? Math.max(8, Math.ceil(visibleLength / 500));
  const delayMs = options.delayMs ?? 4;
  const parts = text.split(/(\x1b\[[0-9;]*m)/gu).filter(Boolean);
  for (const part of parts) {
    if (/^\x1b\[[0-9;]*m$/u.test(part)) {
      output.write(part);
      continue;
    }
    const characters = [...part];
    for (let index = 0; index < characters.length; index += chunkSize) {
      output.write(characters.slice(index, index + chunkSize).join(""));
      if (delayMs > 0) await wait(delayMs);
    }
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export { ansi };
