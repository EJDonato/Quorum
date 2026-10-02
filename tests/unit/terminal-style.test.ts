import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  formatRunnerResponse,
  formatTerminalMarkdown,
  writeAnimatedTerminalText,
} from "../../src/cli/terminal-style.js";
import {
  createReplProgressDisplay,
  loadingVerb,
} from "../../src/cli/repl-progress.js";

await test("terminal markdown colors headings, emphasis, paths, code, and links", () => {
  const formatted = formatTerminalMarkdown(
    [
      "# Result",
      "Read **this file** at src/cli/repl.ts:12 or `README.md` and run `npm test`.",
      "Absolute: /Users/eltonjames/Desktop/Personal Apps/Quorum/src/cli/repl.ts:42",
      "Local: [source](/Users/eltonjames/Desktop/Personal Apps/Quorum/src/cli/repl.ts:42)",
      "Open [the docs](https://example.com/docs) or https://example.com/help.",
    ].join("\n"),
  );

  assert.match(formatted, /\x1b\[1m\x1b\[35mResult/u);
  assert.match(formatted, /\x1b\[1mthis file\x1b\[0m/u);
  assert.match(formatted, /\x1b\[32msrc\/cli\/repl\.ts:12\x1b\[0m/u);
  assert.match(formatted, /\x1b\[32mREADME\.md\x1b\[0m/u);
  assert.match(
    formatted,
    /\x1b\[32m\/Users\/eltonjames\/Desktop\/Personal Apps\/Quorum\/src\/cli\/repl\.ts:42\x1b\[0m/u,
  );
  assert.match(
    formatted,
    /\x1b\[2m\x1b\[32m\(\/Users\/eltonjames\/Desktop\/Personal Apps\/Quorum\/src\/cli\/repl\.ts:42\)\x1b\[0m/u,
  );
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
  const output = new PassThrough() as PassThrough & {
    columns?: number;
    isTTY?: boolean;
  };
  output.isTTY = true;
  output.columns = 80;
  let captured = "";
  output.on("data", (chunk: Buffer) => {
    captured += chunk.toString("utf8");
  });

  const display = createReplProgressDisplay({
    output,
    runner: "codex",
    color: true,
  });
  display.report({ phase: "tool", message: "Searching repository: src" });
  display.report({ phase: "tool", message: "Reading files: README.md" });
  display.stop();

  assert.match(captured, /Consulting/u);
  assert.match(captured, /\x1b\[32mReading files: README\.md\x1b\[0m/u);
  assert.match(captured, /\r\x1b\[2K/u);
  assert.doesNotMatch(captured, /\n/u);
});

await test("loading action words change once every ten seconds", () => {
  assert.equal(loadingVerb(0), "Consulting");
  assert.equal(loadingVerb(9_999), "Consulting");
  assert.equal(loadingVerb(10_000), "Propagating");
  assert.equal(loadingVerb(20_000), "Scheming");
});

await test("interactive response writer emits fast incremental chunks", async () => {
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

  await writeAnimatedTerminalText(output, "ab😀cdef", {
    chunkSize: 2,
    delayMs: 0,
  });

  assert.deepEqual(chunks, ["ab", "😀c", "de", "f"]);
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

  assert.match(captured, /^\[agy\] Still working\. \(\d+\.\d+s\)\n$/);
});
