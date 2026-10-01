import { sessionStateSchema } from "../../src/contracts/session.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freezeCandidate } from "../../src/application/freeze.js";
import { evaluateBallot } from "../../src/application/evaluate-ballot.js";
import type { FinalizeOptions } from "../../src/application/finalize.js";
import { createSessionWorkspace } from "../../src/infrastructure/workspace/manager.js";
import { identity } from "./evidence.js";
import { fakeEvaluation } from "./workflow.js";

export async function finalizationFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "quorum-finalization-"));
  const sourceDir = join(rootDir, "source");
  const git = (cwd: string, args: string[]) =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .trim();
  git(rootDir, ["init", "-b", "main", sourceDir]);
  git(sourceDir, ["config", "user.name", "Fixture"]);
  git(sourceDir, ["config", "user.email", "fixture@local"]);
  await writeFile(join(sourceDir, "app.ts"), "export const value = 1;\n");
  git(sourceDir, ["add", "app.ts"]);
  git(sourceDir, ["commit", "-m", "base"]);
  const baseSha = git(sourceDir, ["rev-parse", "HEAD"]);
  const sessionId = "finalization-fixture";
  const workspace = await createSessionWorkspace({
    rootDir,
    sourceDir,
    sessionId,
    baseSha,
  });
  assert.ok(workspace.ok);
  const { draftDir, workspaceDir: artifactsDir } = workspace.value;
  await writeFile(join(draftDir, "app.ts"), "export const value = 2;\n");
  const frozen = await freezeCandidate({
    sessionId,
    draftDir,
    artifactsDir,
    baseSha,
    objectFormat: "sha1",
    policyHash: identity.policy_hash,
    configDigest: identity.configuration_digest,
    planDigest: identity.plan_digest,
    acceptanceDigest: identity.acceptance_digest,
    contractDigest: identity.contract_digest,
    testsDigest: identity.tests_digest,
    envDigest: identity.validation_environment_digest,
    adapter: identity.adapter,
    personaDigest: identity.persona_digest,
  });
  assert.ok(frozen.ok);
  const verification = fakeEvaluation(frozen.value.manifest);
  const ballot = await evaluateBallot(verification);
  assert.ok(ballot.ok && ballot.value.quorum_achieved);
  const options: FinalizeOptions = {
    sessionId,
    sourceDir,
    draftDir,
    artifactsDir,
    baseSha,
    objectFormat: "sha1",
    candidateId: frozen.value.manifest.candidate_id,
    treeOid: frozen.value.manifest.identity.tree.oid,
    evidenceRefs: ballot.value.evidence,
    verification,
    loadSession: () =>
      Promise.resolve({
        ok: true,
        value: sessionStateSchema.parse(verification.session),
      }),
  };
  return {
    rootDir,
    options,
    git,
    candidate: frozen.value.manifest,
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
  };
}
