import type { Outcome } from "../contracts/errors.js";
import type {
  CandidateIdentity,
  CandidateManifest,
} from "../contracts/candidate.js";
import { canonicalDigest } from "../infrastructure/artifacts/digests.js";
import {
  computeDraftDiff,
  writeDraftTree,
} from "../infrastructure/git/operations.js";
import { writeArtifact } from "../infrastructure/storage/artifacts.js";
import { createCandidateIdentity } from "./candidates.js";

export interface FreezeOptions {
  sessionId: string;
  draftDir: string;
  artifactsDir: string;
  baseSha: string;
  objectFormat: "sha1" | "sha256";
  policyHash: string;
  configDigest: string;
  planDigest: string;
  acceptanceDigest: string;
  contractDigest: string;
  testsDigest: string;
  envDigest: string;
  adapter: {
    name: "agy" | "codex";
    version: string;
    model: string;
    model_version: string;
  };
  personaDigest: string;
}

export interface FreezeResult {
  manifest: CandidateManifest;
  diff: string;
}

export async function freezeCandidate(
  options: FreezeOptions,
): Promise<Outcome<FreezeResult>> {
  const treeRes = await writeDraftTree(options.draftDir);
  if (!treeRes.ok) return treeRes;

  const diffRes = await computeDraftDiff({
    draftDir: options.draftDir,
    baseSha: options.baseSha,
  });
  if (!diffRes.ok) return diffRes;

  const identity: CandidateIdentity = {
    schema_version: "1.0.0",
    session_id: options.sessionId,
    base_commit: { format: options.objectFormat, oid: options.baseSha },
    tree: { format: options.objectFormat, oid: treeRes.value.treeOid },
    policy_hash: options.policyHash,
    configuration_digest: options.configDigest,
    plan_digest: options.planDigest,
    acceptance_digest: options.acceptanceDigest,
    contract_digest: options.contractDigest,
    tests_digest: options.testsDigest,
    validation_environment_digest: options.envDigest,
    adapter: options.adapter,
    persona_digest: options.personaDigest,
  };

  const manifestRes = createCandidateIdentity(identity, {
    digest: canonicalDigest,
  });
  if (!manifestRes.ok) return manifestRes;

  const candidateId = manifestRes.value.candidate_id;
  const manifestWrite = await writeArtifact({
    baseDir: options.artifactsDir,
    relativePath: `candidates/${candidateId}/manifest.json`,
    content: JSON.stringify(manifestRes.value, null, 2) + "\n",
  });
  if (!manifestWrite.ok) return manifestWrite;

  const diffWrite = await writeArtifact({
    baseDir: options.artifactsDir,
    relativePath: `candidates/${candidateId}/candidate.diff`,
    content: diffRes.value,
  });
  if (!diffWrite.ok) return diffWrite;

  return {
    ok: true,
    value: {
      manifest: manifestRes.value,
      diff: diffRes.value,
    },
  };
}
