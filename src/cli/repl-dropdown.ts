import type { SlashCommandDefinition } from "./repl-commands-def.js";

export function formatDropdownRow(
  item: SlashCommandDefinition,
  isSelected: boolean,
  isColor: boolean,
): string {
  const cyan = isColor ? "\x1b[36m" : "";
  const bold = isColor ? "\x1b[1;37m" : "";
  const dim = isColor ? "\x1b[90m" : "";
  const reset = isColor ? "\x1b[0m" : "";

  const pointer = isSelected ? `${cyan}❯${reset}` : " ";
  const syntaxText = isSelected
    ? `${bold}${item.syntax.padEnd(22)}${reset}`
    : `${item.syntax.padEnd(22)}`;

  return `  ${pointer} ${syntaxText} ${dim}${item.description}${reset}`;
}

export interface DropdownOptions {
  selectedIndex: number;
  cursorCol: number;
}

export function renderDropdown(
  stdout: NodeJS.WritableStream,
  matches: readonly SlashCommandDefinition[],
  options: DropdownOptions,
): number {
  const { selectedIndex, cursorCol } = options;
  if (matches.length === 0) return 0;

  // Clear any existing lines below prompt line
  stdout.write("\x1b[B\x1b[J\x1b[A");

  // Render each match on its own row below prompt
  for (let i = 0; i < matches.length; i++) {
    const item = matches[i];
    if (!item) continue;
    const row = formatDropdownRow(item, i === selectedIndex, true);
    stdout.write(`\n\x1b[2K${row}`);
  }

  // Restore cursor back to the prompt line at cursorCol
  const moveRight = cursorCol > 0 ? `\x1b[${cursorCol}C` : "";
  stdout.write(`\x1b[${matches.length}A\r${moveRight}`);

  return matches.length;
}

export function clearDropdown(
  stdout: NodeJS.WritableStream,
  renderedLines: number,
  cursorCol: number,
): void {
  if (renderedLines <= 0) return;
  const moveRight = cursorCol > 0 ? `\x1b[${cursorCol}C` : "";
  stdout.write(`\x1b[B\x1b[J\x1b[A\r${moveRight}`);
}
