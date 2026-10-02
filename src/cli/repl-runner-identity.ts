import type { ReplState } from "./repl-types.js";

export function directRunnerIdentity(
  state: ReplState,
  configured: { name: string; version: string; model: string },
): { version: string; model: string } {
  const defaults =
    state.activeRunner === "agy"
      ? { version: "1.2.14", model: "gemini-3.8-flash-medium" }
      : { version: "0.159.3", model: "gpt-6-sol" };
  if (configured.name !== state.activeRunner) return defaults;
  const placeholder =
    configured.model === "codex-1" || configured.model === "gemini-2.5-pro";
  return {
    version: configured.version,
    model: placeholder ? defaults.model : configured.model,
  };
}
