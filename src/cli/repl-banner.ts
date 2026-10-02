import type { ReplState } from "./repl-types.js";

export function formatBanner(state: ReplState, isColor: boolean): string {
  const cyan = isColor ? "\x1b[1;36m" : "";
  const bold = isColor ? "\x1b[1m" : "";
  const gray = isColor ? "\x1b[90m" : "";
  const reset = isColor ? "\x1b[0m" : "";

  return [
    "",
    `${cyan}  ___                           ${reset}`,
    `${cyan} / _ \\ _   _  ___  _ __ _   _ _ __ ___  ${reset}`,
    `${cyan}| | | | | | |/ _ \\| '__| | | | '_ \` _ \\ ${reset}`,
    `${cyan}| |_| | |_| | (_) | |  | |_| | | | | | |${reset}`,
    `${cyan} \\__\\_\\\\__,_|\\___/|_|   \\__,_|_| |_| |_|${reset}`,
    "",
    `${bold}Quorum Interactive Council v0.1.0${reset}`,
    `${gray}Active Runner:${reset} ${state.activeRunner}  ${gray}|  Config:${reset} ${state.configPath}`,
    `${gray}Type a prompt for a read-only runner answer; use /run for a council workflow.${reset}`,
    `${gray}Type /help for slash commands. (/exit to quit)${reset}`,
    "",
  ].join("\n");
}

export function formatHelp(isColor: boolean): string {
  const bold = isColor ? "\x1b[1m" : "";
  const yellow = isColor ? "\x1b[33m" : "";
  const reset = isColor ? "\x1b[0m" : "";

  return [
    `${bold}Available Slash Commands:${reset}`,
    `  ${yellow}/help${reset}                Show this command reference`,
    `  ${yellow}/run <prompt>${reset}        Execute council workflow session with active runner`,
    `  ${yellow}/foundation <requirements>${reset}`,
    "                       Draft PRD, system design, and implementation plan",
    `  ${yellow}/init${reset}                Initialize .quorum/ configuration and persona templates`,
    `  ${yellow}/runner [agy|codex]${reset}  Show or switch active runner`,
    `  ${yellow}/doctor${reset}              Check runtime capabilities and verifications`,
    `  ${yellow}/config [file]${reset}       Inspect and validate configuration file`,
    `  ${yellow}/status${reset}              Check active session and lease state`,
    `  ${yellow}/diff${reset}                Display current candidate diff`,
    `  ${yellow}/clear${reset}               Clear terminal screen`,
    `  ${yellow}/exit${reset}                Exit the Quorum CLI terminal`,
    "",
    `${bold}Prompt Usage:${reset}`,
    "  Type natural language directly for a read-only runner response.",
    "  Direct responses are not approval evidence and cannot finalize changes.",
    "  Use /foundation <requirements> once to create the project's planning documents.",
    "  Use /run <task> to start the Planner, QA, Developer, and Security workflow.",
  ].join("\n");
}

export function sanitizeText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, (ch) =>
    ch === "\n" || ch === "\t"
      ? ch
      : `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
