import type { CommandResult } from "./commands.js";

export function present(result: CommandResult): {
  stdout: string;
  stderr: string;
} {
  if (result.json)
    return { stdout: `${JSON.stringify(result.body)}\n`, stderr: "" };
  const safeText = result.text.replace(
    /[\u0000-\u001f\u007f-\u009f]/g,
    (character) =>
      character === "\n"
        ? "\n"
        : `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return result.exitCode === 0
    ? { stdout: `${safeText}\n`, stderr: "" }
    : { stdout: "", stderr: `${safeText}\n` };
}
