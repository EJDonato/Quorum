import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  formatRunnerResponse,
  formatTerminalMarkdown,
} from "../../src/cli/terminal-style.js";
import { createReplProgressDisplay } from "../../src/cli/repl-progress.js";

await test("terminal markdown colors headings, emphasis, paths, code, and links", () => {
  const formatted = formatTerminalMarkdown(
    [
      "# Result",
      "Read **this file** at src/cli/repl.ts:12 or `README.md` and run `npm test`.",
      "Open [the docs](https://example.com/docs) or https://example.com/help.",
    ].join("\n"),
  );

  assert.match(formatted, /\x1b\[1m\x1b\[35mResult/u);
  assert.match(formatted, /\x1b\[1mthis file\x1b\[0m/u);
  assert.match(formatted, /\x1b\[32msrc\/cli\/repl\.ts:12\x1b\[0m/u);
  assert.match(formatted, /\x1b\[32mREADME\.md\x1b\[0m/u);
  assert.match(formatted, /\x1b\[36mnpm test\x1b\[0m/u);
  assert.match(formatted, /\x1b\[34m\x1b\[4mthe docs/u);
  assert.match(formatted, /\x1b\[34m\x1b\[4mhttps:\/\/example\.com\/help/u);
});

await test("runner response stays plain when color is unavailable", () => {
  const formatted = formatRunnerResponse({
    runner: "codex",
    model: "gpt-6-sol",
    text: "Use **bold** and README.md.\x1b[31m",
    color: false,
  });

  assert.doesNotMatch(formatted, /\x1b\[/u);
  assert.match(formatted, /Use \*\*bold\*\* and README\.md\.\\u001b\[31m/u);
});

await test("interactive progress uses colored animation and clears it on stop", () => {
  const output = new PassThrough() as PassThrough & { isTTY?: boolean };
  output.isTTY = true;
  let captured = "";
  output.on("data", (chunk: Buffer) => {
    captured += chunk.toString("utf8");
  });

  const display = createReplProgressDisplay({
    output,
    runner: "codex",
    color: true,
  });
  display.report({ phase: "tool", message: "Reading files: README.md" });
  display.stop();

  assert.match(captured, /Consulting/u);
  assert.match(captured, /\x1b\[32m→ Reading files: README\.md\x1b\[0m/u);
  assert.match(captured, /\r\x1b\[2K/u);
});

await test("non-interactive progress remains stable plain text", () => {
  const output = new PassThrough();
  let captured = "";
  output.on("data", (chunk: Buffer) => {
    captured += chunk.toString("utf8");
  });

  const display = createReplProgressDisplay({ output, runner: "agy" });
  display.report({ phase: "working", message: "Still working." });
  display.stop();

  assert.equal(captured, "[agy] Still working.\n");
});
