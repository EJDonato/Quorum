export interface SlashCommandDefinition {
  name: string;
  syntax: string;
  description: string;
  needsArg: boolean;
}

export const SLASH_COMMAND_DEFINITIONS: readonly SlashCommandDefinition[] = [
  {
    name: "/help",
    syntax: "/help",
    description: "Show command reference",
    needsArg: false,
  },
  {
    name: "/run",
    syntax: "/run <prompt>",
    description: "Execute council workflow session",
    needsArg: true,
  },
  {
    name: "/foundation",
    syntax: "/foundation <requirements>",
    description: "Draft PRD, system design, and implementation plan",
    needsArg: true,
  },
  {
    name: "/init",
    syntax: "/init",
    description: "Initialize .quorum/ configuration and persona templates",
    needsArg: false,
  },
  {
    name: "/runner",
    syntax: "/runner [agy|codex]",
    description: "Show or switch active runner",
    needsArg: false,
  },
  {
    name: "/doctor",
    syntax: "/doctor",
    description: "Check runtime capabilities and verifications",
    needsArg: false,
  },
  {
    name: "/config",
    syntax: "/config [file]",
    description: "Inspect and validate configuration file",
    needsArg: false,
  },
  {
    name: "/status",
    syntax: "/status",
    description: "Check active session and lease state",
    needsArg: false,
  },
  {
    name: "/diff",
    syntax: "/diff",
    description: "Display current candidate diff",
    needsArg: false,
  },
  {
    name: "/clear",
    syntax: "/clear",
    description: "Clear terminal screen",
    needsArg: false,
  },
  {
    name: "/exit",
    syntax: "/exit",
    description: "Exit the Quorum CLI terminal",
    needsArg: false,
  },
  {
    name: "/quit",
    syntax: "/quit",
    description: "Exit the Quorum CLI terminal",
    needsArg: false,
  },
];

export function getMatchingSlashCommands(
  line: string,
): SlashCommandDefinition[] {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) return [];
  const firstWord = trimmed.split(/\s+/)[0] ?? "";
  if (trimmed.includes(" ") && firstWord.length > 1) {
    return [];
  }
  const prefix = firstWord.toLowerCase();
  return SLASH_COMMAND_DEFINITIONS.filter((cmd) => cmd.name.startsWith(prefix));
}
