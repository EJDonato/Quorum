import type { ReplState, ReplTiming } from "./repl-types.js";

const MAX_TIMINGS = 40;

export function recordReplTiming(state: ReplState, timing: ReplTiming): void {
  const timings = state.timings ?? [];
  timings.push(timing);
  state.timings = timings.slice(-MAX_TIMINGS);
}

export function formatRecentTimings(state: ReplState): string {
  const timings = state.timings ?? [];
  if (timings.length === 0) return "No operation timings recorded yet.";
  return [
    "Recent Quorum timings:",
    ...timings.map(
      (timing) =>
        `  ${timing.operation}/${timing.stage}: ${formatDuration(timing.durationMs)}`,
    ),
  ].join("\n");
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1_000).toFixed(1)}s`;
}
