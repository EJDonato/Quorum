import { randomUUID } from "node:crypto";
import { failure, type Outcome } from "../contracts/errors.js";
import {
  artifactReadInputSchema,
  checksRunInputSchema,
  draftApplyPatchInputSchema,
  repoReadInputSchema,
  repoSearchInputSchema,
  roleSubmitInputSchema,
  scopeRequestInputSchema,
} from "../contracts/tools.js";
import {
  readArtifact,
  writeArtifact,
} from "../infrastructure/storage/artifacts.js";
import {
  isToolAllowed,
  type BrokerAuthContext,
  type RoleName,
  type StagePhase,
} from "./authorizer.js";
import { applyDraftPatch } from "./patch.js";
import { readRepoFile, searchRepoFiles } from "./repo-tools.js";

export interface BrokerSessionContext {
  sessionId: string;
  invocationId: string;
  role: RoleName;
  phase: StagePhase;
  draftDir: string;
  artifactsDir: string;
  grantedPaths: string[];
  protectedPaths: string[];
}

export type BrokerToolCall =
  | { tool: "repo.read"; params: unknown }
  | { tool: "repo.search"; params: unknown }
  | { tool: "artifact.read"; params: unknown }
  | { tool: "draft.apply_patch"; params: unknown }
  | { tool: "checks.run"; params: unknown }
  | { tool: "role.submit"; params: unknown }
  | { tool: "scope.request"; params: unknown };

async function dispatchWorkspaceTool(
  context: BrokerSessionContext,
  authContext: BrokerAuthContext,
  call: BrokerToolCall,
): Promise<Outcome<unknown>> {
  if (call.tool === "repo.read") {
    const p = repoReadInputSchema.safeParse(call.params);
    if (!p.success) return failure("INVALID_INPUT", "Invalid repo.read input.");
    return readRepoFile({
      draftDir: context.draftDir,
      input: p.data,
      context: authContext,
    });
  }
  if (call.tool === "repo.search") {
    const p = repoSearchInputSchema.safeParse(call.params);
    if (!p.success)
      return failure("INVALID_INPUT", "Invalid repo.search input.");
    return searchRepoFiles({
      draftDir: context.draftDir,
      input: p.data,
      context: authContext,
    });
  }
  if (call.tool === "draft.apply_patch") {
    const p = draftApplyPatchInputSchema.safeParse(call.params);
    if (!p.success)
      return failure("INVALID_INPUT", "Invalid draft.apply_patch input.");
    return applyDraftPatch({
      draftDir: context.draftDir,
      patch: p.data.patch,
      expectedDraftDigest: p.data.expected_draft_digest,
      context: authContext,
    });
  }
  return failure("INVALID_INPUT", "Unknown workspace tool.");
}

async function dispatchArtifactTool(
  context: BrokerSessionContext,
  call: BrokerToolCall,
): Promise<Outcome<unknown>> {
  if (call.tool === "artifact.read") {
    const p = artifactReadInputSchema.safeParse(call.params);
    if (!p.success)
      return failure("INVALID_INPUT", "Invalid artifact.read input.");
    return handleArtifactRead(context.artifactsDir, p.data.artifact_id);
  }
  if (call.tool === "role.submit") {
    const p = roleSubmitInputSchema.safeParse(call.params);
    if (!p.success)
      return failure("INVALID_INPUT", "Invalid role.submit input.");
    return handleRoleSubmit(context.artifactsDir, context.role, p.data.body);
  }
  if (call.tool === "scope.request") {
    const p = scopeRequestInputSchema.safeParse(call.params);
    if (!p.success)
      return failure("INVALID_INPUT", "Invalid scope.request input.");
    return handleScopeRequest(context.artifactsDir, p.data);
  }
  if (call.tool === "checks.run") {
    const p = checksRunInputSchema.safeParse(call.params);
    if (!p.success)
      return failure("INVALID_INPUT", "Invalid checks.run input.");
    return failure(
      "CAPABILITY_MISSING",
      "No isolated check executor is installed; no check evidence was created.",
    );
  }
  return failure("INVALID_INPUT", "Unknown artifact tool.");
}

export async function executeBrokerTool(
  context: BrokerSessionContext,
  call: BrokerToolCall,
): Promise<Outcome<unknown>> {
  const authContext: BrokerAuthContext = {
    role: context.role,
    phase: context.phase,
    grantedPaths: context.grantedPaths,
    protectedPaths: context.protectedPaths,
  };

  const allowed = isToolAllowed(call.tool, authContext);
  if (!allowed.ok) return allowed;

  if (
    call.tool === "repo.read" ||
    call.tool === "repo.search" ||
    call.tool === "draft.apply_patch"
  ) {
    return dispatchWorkspaceTool(context, authContext, call);
  }
  return dispatchArtifactTool(context, call);
}

async function handleArtifactRead(
  artifactsDir: string,
  artifactId: string,
): Promise<Outcome<{ payload: unknown; digest: string }>> {
  const read = await readArtifact({
    baseDir: artifactsDir,
    relativePath: `${artifactId}.json`,
  });
  if (!read.ok) return read;
  try {
    const payload: unknown = JSON.parse(read.value.content.toString("utf8"));
    return { ok: true, value: { payload, digest: read.value.digest } };
  } catch {
    return failure("EVIDENCE_INVALID", "Corrupt artifact payload.");
  }
}

async function handleRoleSubmit(
  artifactsDir: string,
  role: RoleName,
  body: Record<string, unknown>,
): Promise<Outcome<{ result_ref: string }>> {
  const resultRef = randomUUID().replaceAll("-", "");
  const payload = {
    schema_version: "1.0.0",
    result_ref: resultRef,
    role,
    submitted_at: new Date().toISOString(),
    body,
  };
  const write = await writeArtifact({
    baseDir: artifactsDir,
    relativePath: `${resultRef}.json`,
    content: JSON.stringify(payload, null, 2) + "\n",
  });
  if (!write.ok) return write;
  return { ok: true, value: { result_ref: resultRef } };
}

async function handleScopeRequest(
  artifactsDir: string,
  data: { paths: string[]; reason: string },
): Promise<Outcome<{ request_ref: string; status: "SUBMITTED" }>> {
  const requestRef = randomUUID().replaceAll("-", "");
  const payload = {
    schema_version: "1.0.0",
    request_ref: requestRef,
    status: "SUBMITTED" as const,
    created_at: new Date().toISOString(),
    ...data,
  };
  const write = await writeArtifact({
    baseDir: artifactsDir,
    relativePath: `scope-${requestRef}.json`,
    content: JSON.stringify(payload, null, 2) + "\n",
  });
  if (!write.ok) return write;
  return { ok: true, value: { request_ref: requestRef, status: "SUBMITTED" } };
}
