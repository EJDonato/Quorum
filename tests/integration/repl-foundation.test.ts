import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { dispatchReplLine } from "../../src/cli/repl-actions.js";
import type { ReplIo, ReplState } from "../../src/cli/repl-types.js";
import { readConfiguration } from "../../src/infrastructure/configuration.js";

const fixture = resolve("tests/fixtures/config.json");

await test("/foundation drafts and publishes the three planning documents", async () => {
  const root = await mkdtemp(join(tmpdir(), "quorum-repl-foundation-"));
  let calls = 0;
  try {
    const io: ReplIo = {
      readConfig: readConfiguration,
      directPrompt: (request) => {
        calls += 1;
        const text = request.prompt.includes("system architect")
          ? "<quorum_document># System Design\n\nArchitecture.\n</quorum_document>"
          : request.prompt.includes("project delivery manager")
            ? "<quorum_document># Implementation Plan\n\n1. Deliver.\n</quorum_document>"
            : "<quorum_document># Product Requirements Document\n\nRequirements.\n</quorum_document>";
        return Promise.resolve({
          ok: true,
          value: {
            runner: "codex",
            runnerVersion: "0.159.3",
            model: "gpt-6-sol",
            text,
          },
        });
      },
    };
    const state = createState(root);
    const output = await dispatchReplLine(
      state,
      io,
      "/foundation Build a local issue tracker",
    );
    assert.match(output.text, /Foundation documents created as drafts/);
    assert.equal(calls, 3);
    assert.match(
      await readFile(join(root, "PRD.md"), "utf8"),
      /Product Requirements/,
    );
    assert.match(
      await readFile(join(root, "SYSTEM_DESIGN.md"), "utf8"),
      /System Design/,
    );
    assert.match(
      await readFile(join(root, "PLAN.md"), "utf8"),
      /Implementation Plan/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("/foundation does not call a runner when a target document exists", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "quorum-repl-foundation-existing-"),
  );
  let calls = 0;
  try {
    await writeFile(join(root, "PRD.md"), "existing\n");
    const io: ReplIo = {
      readConfig: readConfiguration,
      directPrompt: () => {
        calls += 1;
        return Promise.resolve(assert.fail("runner must not run"));
      },
    };
    const output = await dispatchReplLine(
      createState(root),
      io,
      "/foundation requirements",
    );
    assert.match(output.text, /never overwrites/);
    assert.equal(calls, 0);
    assert.equal(await readFile(join(root, "PRD.md"), "utf8"), "existing\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function createState(rootDir: string): ReplState {
  return {
    configPath: fixture,
    activeRunner: "codex",
    rootDir,
    activeSessionId: null,
    exitRequested: false,
  };
}
