import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { initRepository } from "../application/init.js";
import {
  capabilityDiagnostics,
  inspectConfiguration,
} from "../application/inspect-config.js";
import { formatHelp, sanitizeText } from "./repl-banner.js";
import { handleRunCommand } from "./repl-run.js";
import type { ReplActionOutput, ReplIo, ReplState } from "./repl-types.js";

export { handleRunCommand } from "./repl-run.js";

export function handleRunnerCommand(
  state: ReplState,
  arg?: string,
): ReplActionOutput {
  if (!arg) {
    return {
      text: `Active runner: ${state.activeRunner} (available: agy, codex)\nUse '/runner <name>' to switch.`,
    };
  }
  const normalized = arg.trim().toLowerCase();
  if (normalized === "agy" || normalized === "codex") {
    state.activeRunner = normalized;
    return { text: `Switched active runner to: ${state.activeRunner}` };
  }
  return {
    text: `Unknown runner '${arg}'. Supported runners are 'agy' and 'codex'.`,
  };
}

export async function handleDoctorCommand(
  state: ReplState,
  io: ReplIo,
): Promise<ReplActionOutput> {
  const config = await inspectConfiguration(state.configPath, {
    read: io.readConfig,
  });
  if (!config.ok) {
    return { text: `Doctor failed: ${config.error.message}` };
  }
  const effectiveConfig = {
    ...config.value,
    adapter: {
      ...config.value.adapter,
      name: state.activeRunner,
      version:
        config.value.adapter.name === state.activeRunner
          ? config.value.adapter.version
          : state.activeRunner === "codex"
            ? "0.159.3"
            : "1.2.14",
    },
  };
  const report = capabilityDiagnostics(effectiveConfig);
  const lines = [
    `Quorum Doctor Diagnostics (${report.adapter} / ${report.mode}):`,
    `  Ready: ${report.ready ? "true (operational)" : "false (enforced execution blocked)"}`,
    "  Capabilities:",
  ];
  for (const cap of report.capabilities) {
    const symbol =
      cap.status === "valid" || cap.status === "verified" ? "✓" : "✗";
    lines.push(`    ${symbol} ${cap.name}: ${cap.status}`);
  }
  return { text: lines.join("\n") };
}

export async function handleConfigCommand(
  state: ReplState,
  io: ReplIo,
  targetFile?: string,
): Promise<ReplActionOutput> {
  const path = targetFile?.trim() || state.configPath;
  const config = await inspectConfiguration(path, { read: io.readConfig });
  if (!config.ok) {
    return { text: `Config invalid (${path}): ${config.error.message}` };
  }
  const val = config.value;
  return {
    text: [
      `Configuration valid (${path}):`,
      `  Adapter: ${val.adapter.name} (${val.adapter.model}, v${val.adapter.version})`,
      `  Mode: ${val.mode}`,
      `  Validation Image: ${val.validation_image}`,
      `  Checks: ${val.commands.length} configured`,
      `  Budget: ${val.budgets.model_tokens} tokens ceiling, ${val.budgets.active_session_ms}ms timeout`,
    ].join("\n"),
  };
}

export async function handleStatusCommand(
  state: ReplState,
): Promise<ReplActionOutput> {
  try {
    const leasePath = join(state.rootDir, ".quorum", "lease.json");
    const bytes = await readFile(leasePath, "utf-8");
    const lease = JSON.parse(bytes) as { session_id?: string; status?: string };
    return {
      text: [
        "Quorum Repository Session Status:",
        `  Session ID: ${lease.session_id ?? "unknown"}`,
        `  Status: ${lease.status ?? "UNKNOWN"}`,
        `  Active Runner: ${state.activeRunner}`,
      ].join("\n"),
    };
  } catch {
    return {
      text: `No active session in this repository. (Status: IDLE, Runner: ${state.activeRunner})`,
    };
  }
}

export async function handleInitCommand(
  state: ReplState,
): Promise<ReplActionOutput> {
  const result = await initRepository({ rootDir: state.rootDir });
  if (!result.ok) {
    return { text: `Initialization failed: ${result.error.message}` };
  }
  const val = result.value;
  const configMsg = val.configCreated
    ? `Created configuration: ${val.configPath}`
    : `Preserved existing configuration: ${val.configPath}`;
  return {
    text: [
      "Quorum repository initialized successfully:",
      `  ${configMsg}`,
      `  Persona templates: ${val.createdPersonas.length} created, ${val.preservedPersonas.length} preserved in ${val.agentsDir}`,
      "",
      val.disclosure,
    ].join("\n"),
  };
}

export async function handleDiffCommand(
  state: ReplState,
): Promise<ReplActionOutput> {
  try {
    const diffPath = join(state.rootDir, ".quorum", "candidate.diff");
    const diffText = await readFile(diffPath, "utf-8");
    return {
      text: diffText.trim().length ? diffText : "Candidate diff is empty.",
    };
  } catch {
    return { text: "No active candidate diff found in this repository." };
  }
}

export async function handlePromptSubmission(
  state: ReplState,
  io: ReplIo,
  prompt: string,
): Promise<ReplActionOutput> {
  const cleanPrompt = sanitizeText(prompt.trim());
  const config = await inspectConfiguration(state.configPath, {
    read: io.readConfig,
  });
  const configStatus = config.ok
    ? `valid (${config.value.mode} mode)`
    : `unverified (${config.error.message})`;

  return {
    text: [
      "Quorum Council Dispatch:",
      `  Prompt: "${cleanPrompt}"`,
      `  Assigned Runner: ${state.activeRunner}`,
      `  Configuration: ${configStatus}`,
      "",
      "Workflow Pipeline Execution Stages:",
      "  1. [Preflight] Validate Git base SHA and isolate workspace",
      `  2. [Planner] Decompose prompt into task graph via ${state.activeRunner}`,
      "  3. [QA Authoring] Author tests & verify expected red failure",
      `  4. [Developer] Implement changes using ${state.activeRunner} in container`,
      "  5. [Checks] Execute lint, typecheck, unit, and fuzz suites",
      "  6. [Ballot] Collect independent QA & Security revision-bound approvals",
      "  7. [Finalization] Construct atomic verified git commit",
      "",
      "Ready to execute. Use /doctor to verify environment readiness, or /run <prompt> to execute.",
    ].join("\n"),
  };
}

export async function dispatchReplLine(
  state: ReplState,
  io: ReplIo,
  line: string,
): Promise<ReplActionOutput> {
  const trimmed = line.trim();
  if (!trimmed) return { text: "" };

  if (trimmed === "/exit" || trimmed === "/quit") {
    state.exitRequested = true;
    return { text: "Exiting Quorum CLI. Goodbye!", shouldExit: true };
  }
  if (trimmed === "/clear") {
    return { text: "\x1b[2J\x1b[0;0H" };
  }
  if (trimmed === "/help") {
    return { text: formatHelp(Boolean(process.stdout?.isTTY)) };
  }
  if (trimmed === "/runner" || trimmed.startsWith("/runner ")) {
    const parts = trimmed.split(/\s+/);
    return handleRunnerCommand(state, parts[1]);
  }
  if (trimmed === "/run" || trimmed.startsWith("/run ")) {
    return handleRunCommand(state, io, trimmed.slice(4).trim());
  }
  if (trimmed === "/init") {
    return handleInitCommand(state);
  }
  if (trimmed === "/doctor") {
    return handleDoctorCommand(state, io);
  }
  if (trimmed.startsWith("/config")) {
    const parts = trimmed.split(/\s+/);
    return handleConfigCommand(state, io, parts[1]);
  }
  if (trimmed === "/status") {
    return handleStatusCommand(state);
  }
  if (trimmed === "/diff") {
    return handleDiffCommand(state);
  }
  if (trimmed.startsWith("/")) {
    return {
      text: `Unknown slash command '${trimmed}'. Type /help for available commands.`,
    };
  }

  return handlePromptSubmission(state, io, trimmed);
}
