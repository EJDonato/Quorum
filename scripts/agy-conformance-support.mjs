import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createModelLedger } from "../dist/src/infrastructure/model-gateway/ledger.js";
import { startAgyStreamingProxy } from "../dist/src/infrastructure/adapters/agy/model-proxy.js";
import { canonicalDigest } from "../dist/src/infrastructure/artifacts/digests.js";

export const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export async function durableJson(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function initialAgyConformanceReport(expectedVersion) {
  return {
    kind: "agy_offline_conformance",
    schema_version: "1.0.0",
    expected_version: expectedVersion,
    external_model_attempts: 0,
    local_provider_requests: 0,
    proxy_requests: 0,
    ledger_events: 0,
    rejected_provider_requests: 0,
    provider_paths: [],
    runner_sentinel_configured: false,
    upstream_fixture_credential_only: false,
    hook_observed: false,
    denied_tool: null,
    denied_effect_absent: false,
    completed: false,
    usage: null,
    direct_gemini_route: false,
    cloud_code_route: false,
    failure: "INFRASTRUCTURE_FAILED",
    enforced_conformance: false,
    mandatory_capabilities: "PARTIAL",
  };
}

export function buildAgyConformanceReport(input) {
  const hook = input.provider.hookObservation();
  const observations = input.provider.observations;
  const validTraffic =
    observations.length >= 3 &&
    observations.length <= 4 &&
    input.proxyRequests === observations.length &&
    input.ledgerEvents === observations.length * 2 &&
    input.provider.rejectedRequests() === 0 &&
    observations.every((item) => item.sentinel_credential);
  const hookDenied =
    hook?.tool_name === "run_command" && hook.decision === "deny";
  const completed =
    input.run.failure === null &&
    input.run.exitCode === 0 &&
    input.envelope.success &&
    input.envelope.data.status === "SUCCESS" &&
    input.envelope.data.response.trim() === "QUORUM_OK";
  let failure = null;
  if (!validTraffic) failure = "PROVIDER_TRAFFIC_INVALID";
  else if (!hookDenied) failure = "HOOK_NOT_OBSERVED";
  else if (!input.deniedEffectAbsent) failure = "DENIED_EFFECT_EXECUTED";
  else if (!completed || !input.binaryUnchanged) failure = "RUNNER_FAILED";
  return {
    ...input.report,
    observed_version: input.observedVersion,
    executable_digest: input.executableDigest,
    binary_unchanged: input.binaryUnchanged,
    config_digest: digest(input.config),
    hooks_digest: digest(input.hooks),
    sandbox_digest: digest(input.profile),
    local_provider_requests: observations.length,
    rejected_provider_requests: input.provider.rejectedRequests(),
    provider_paths: observations.map((item) => item.path),
    proxy_requests: input.proxyRequests,
    ledger_events: input.ledgerEvents,
    runner_sentinel_configured: true,
    upstream_fixture_credential_only:
      observations.length > 0 &&
      observations.every((item) => item.sentinel_credential),
    hook_observed: hookDenied,
    denied_tool: hook?.tool_name === "run_command" ? "run_command" : null,
    denied_effect_absent: input.deniedEffectAbsent,
    completed,
    usage: input.envelope.success ? input.envelope.data.usage : null,
    direct_gemini_route:
      observations.length > 0 &&
      observations.every((item) => item.path.startsWith("/v1beta/models/")),
    failure,
  };
}

export async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

export async function startAgyProbeProxy(options) {
  const ledgerRoot = join(options.root, "ledger");
  await mkdir(ledgerRoot, { mode: 0o700 });
  const ledger = await createModelLedger({
    root: ledgerRoot,
    allocation: {
      schema_version: "1.0.0",
      session_id: "agy-conformance",
      invocation_id: "agy-conformance-invocation",
      tokens_limit: 10_000,
      context_digest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  });
  if (!ledger.ok) throw new Error("Ledger setup failed");
  const started = await startAgyStreamingProxy({
    kind: "upstream",
    gateway: fixtureGateway(ledger.value, options.model),
    allowedModels: ["gemini-3.1-flash-lite-preview", "gemini-3.8-flash"],
    sentinelCredential: "QUORUM_PROXY_SENTINEL",
    outputTokensLimit: 32,
    upstreamUrl: `http://127.0.0.1:${options.upstreamPort}`,
    upstreamCredential: () =>
      Promise.resolve({ ok: true, value: "AGY_UPSTREAM_FIXTURE_KEY" }),
  });
  if (!started.ok) throw new Error("Proxy setup failed");
  return {
    proxy: started.value,
    ledgerEvents: async () =>
      (await readdir(join(ledgerRoot, "events"))).length,
  };
}

function fixtureGateway(ledger, model) {
  return {
    provider: {
      capability: Object.freeze({
        schema_version: "1.0.0",
        provider: "gemini-api-v1beta",
        model,
        status: "fixture",
        input_bound: "exact_payload",
        output_bound: "includes_reasoning",
        hidden_retries: false,
        evidence_digest: null,
      }),
      countInput: (payload) => {
        const payloadDigest = canonicalDigest(payload);
        return Promise.resolve(
          payloadDigest.ok
            ? {
                ok: true,
                value: {
                  payload_digest: payloadDigest.value,
                  input_tokens: 10,
                },
              }
            : payloadDigest,
        );
      },
      generate: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "CAPABILITY_MISSING",
            message: "Unused probe provider generation path.",
            retryable: false,
            remediation: "Use the loopback proxy transport.",
          },
        }),
    },
    ledger,
    mode: "fixture",
    instructions: "Probe",
    outputTokensLimit: 32,
    hash: canonicalDigest,
    authorize: () => Promise.resolve({ ok: true, value: undefined }),
    verifyCapability: () => Promise.resolve({ ok: true, value: undefined }),
  };
}
