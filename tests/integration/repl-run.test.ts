import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { resolve } from "node:path";
import { readConfiguration } from "../../src/infrastructure/configuration.js";
import {
  dispatchReplLine,
  handleDoctorCommand,
} from "../../src/cli/repl-actions.js";
import type { ReplIo, ReplState } from "../../src/cli/repl-types.js";

const fixture = resolve("tests/fixtures/config.json");

await test("dispatchReplLine sends freeform text to direct read-only runner", async () => {
  let promptSeen = "";
  let timeoutSeen = 0;
  const stdout = new PassThrough();
  let progressOutput = "";
  stdout.on("data", (chunk: Buffer) => {
    progressOutput += chunk.toString("utf8");
  });
  const io: ReplIo = {
    readConfig: readConfiguration,
    stdout,
    directPrompt: (request, _signal, onProgress) => {
      promptSeen = request.prompt;
      timeoutSeen = request.timeoutMs;
      onProgress?.({ phase: "checking", message: "Checking runner version." });
      onProgress?.({ phase: "tool", message: "Reading files: README.md" });
      return Promise.resolve({
        ok: true,
        value: {
          runner: "agy",
          runnerVersion: "1.2.14",
          model: "gemini-3.8-flash-medium",
          text: "Quorum coordinates revision-bound coding roles.",
        },
      });
    },
  };
  const state: ReplState = {
    configPath: fixture,
    activeRunner: "agy",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const res = await dispatchReplLine(state, io, "explain how quorum works");
  assert.equal(promptSeen, "explain how quorum works");
  assert.equal(timeoutSeen, 120_000);
  assert.match(progressOutput, /\[agy\] Checking runner version/);
  assert.match(progressOutput, /\[agy\] Reading files: README.md/);
  assert.match(res.text, /agy response/);
  assert.match(res.text, /Quorum coordinates revision-bound coding roles/);
  assert.match(res.text, /not Quorum approval evidence/);
  assert.doesNotMatch(res.text, /Workflow Pipeline Execution Stages/);
});

await test("freeform prompt reports direct runner failure without claiming dispatch", async () => {
  const io: ReplIo = {
    readConfig: readConfiguration,
    directPrompt: () =>
      Promise.resolve({
        ok: false,
        error: {
          code: "CAPABILITY_MISSING",
          message: "Pinned runner is unavailable.",
          retryable: false,
          remediation: "Install the pinned runner.",
        },
      }),
  };
  const state: ReplState = {
    configPath: fixture,
    activeRunner: "codex",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const res = await dispatchReplLine(state, io, "explain how quorum works");
  assert.match(res.text, /Direct codex prompt failed/);
  assert.match(res.text, /Pinned runner is unavailable/);
  assert.doesNotMatch(res.text, /Council Dispatch/);
});

await test("/run slash command validates prompt and executes session runner", async () => {
  let sessionExecuted = false;
  const io: ReplIo = {
    readConfig: readConfiguration,
    sessionRunner: (opts) => {
      sessionExecuted = true;
      return Promise.resolve({
        ok: true,
        value: {
          sessionId: opts.sessionId,
          state: {
            schema_version: "1.0.0",
            session_id: opts.sessionId,
            repository_id: "repo-1",
            base_commit: { format: "sha1", oid: opts.baseSha },
            mode: "enforced",
            state: "COMPLETED",
            state_sequence: 10,
            current_candidate_id: "cand-1",
            input_digest: "sha256:" + "0".repeat(64),
            limits: {
              repairs_per_stage: 2,
              repairs_total: 5,
              invocation_timeout_ms: 600000,
              check_timeout_ms: 600000,
              active_session_ms: 10000,
              model_tokens: 1000,
            },
            budget: {
              repairs_by_stage: {
                PLANNING: 0,
                DESIGN_REVIEW: 0,
                TEST_SPEC: 0,
                IMPLEMENTING: 0,
                VALIDATING: 0,
                REVIEWING: 0,
              },
              repairs_total: 0,
              tokens_charged: 100,
              active_elapsed_ms: 500,
            },
            blocking_reason: null,
          },
          candidateId: "cand-1",
          receipt: {
            schema_version: "1.0.0",
            transaction_id: "tx-1",
            session_id: opts.sessionId,
            candidate_id: "cand-1",
            commit: {
              format: "sha1",
              oid: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
            },
            tree: {
              format: "sha1",
              oid: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
            },
            parent: { format: "sha1", oid: opts.baseSha },
            evidence_refs: [
              { artifact_id: "art-1", digest: "sha256:" + "1".repeat(64) },
            ],
          },
        },
      });
    },
  };

  const state: ReplState = {
    configPath: fixture,
    activeRunner: "agy",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const missingPrompt = await dispatchReplLine(state, io, "/run");
  assert.match(missingPrompt.text, /Missing prompt for \/run/);

  const ran = await dispatchReplLine(state, io, "/run Add test helper");
  assert.match(ran.text, /completed!/);
  assert.match(ran.text, /State: COMPLETED/);
  assert.match(
    ran.text,
    /Commit OID: 4b825dc642cb6eb9a060e54bf8d69288fbee4904/,
  );
  assert.equal(sessionExecuted, true);
  assert.ok(state.activeSessionId);
});

await test("/doctor reports operational readiness for verified configurations", async () => {
  const io: ReplIo = {
    readConfig: () =>
      Promise.resolve({
        ok: true,
        value: {
          schema_version: "1.0.0",
          adapter: {
            name: "codex",
            version: "0.159.3",
            model: "codex-1",
          },
          mode: "enforced",
          validation_image:
            "quorum-validation@sha256:0000000000000000000000000000000000000000000000000000000000000000",
          commands: [
            {
              check_id: "test",
              kind: "test",
              executable: "npm",
              args: ["test"],
            },
          ],
          permitted_environment_keys: ["NODE_ENV"],
          paths: {
            implementation: ["src"],
            tests: ["tests"],
            protected: ["package.json"],
            sensitive: [".env"],
          },
          budgets: {
            repairs_per_stage: 2,
            repairs_total: 6,
            invocation_timeout_ms: 600000,
            check_timeout_ms: 600000,
            active_session_ms: 3600000,
            model_tokens: 200000,
          },
        },
      }),
  };
  const state: ReplState = {
    configPath: ".quorum/config.json",
    activeRunner: "codex",
    rootDir: process.cwd(),
    activeSessionId: null,
    exitRequested: false,
  };

  const output = await handleDoctorCommand(state, io);
  assert.match(output.text, /Ready: true \(operational\)/);
  assert.match(output.text, /✓ runner_conformance: verified/);
  assert.match(output.text, /✓ broker_only_tools: verified/);
  assert.match(output.text, /✓ container_isolation: verified/);
  assert.match(output.text, /✓ usage_and_hard_token_ceiling: verified/);
  assert.match(output.text, /✓ descendant_cancellation: verified/);
  assert.match(output.text, /✓ validation_environment: verified/);
});
