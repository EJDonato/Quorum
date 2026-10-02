import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { startAgyFakeProvider } from "../probes/agy-conformance-provider.js";
import { agyConformanceReportSchema } from "../probes/agy-conformance-report.js";

async function setup(t: TestContext) {
  const provider = await startAgyFakeProvider({
    sentinel: "QUORUM_PROXY_SENTINEL",
    workspace: "/fixture/work",
  });
  t.after(() => provider.close());
  const post = (
    path: string,
    body: unknown,
    credential = "QUORUM_PROXY_SENTINEL",
  ) =>
    fetch(`http://127.0.0.1:${provider.port}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": credential,
      },
      body: JSON.stringify(body),
    });
  return { provider, post };
}

const route = "/v1beta/models/gemini-fixture:streamGenerateContent?alt=sse";
const baseRequest = {
  contents: [{ role: "user", parts: [{ text: "fixture" }] }],
  generationConfig: {},
  systemInstruction: { parts: [{ text: "fixture" }] },
};

void test("real-runner fixture requests a native tool, records denial, and completes", async (t) => {
  const harness = await setup(t);
  const resolver = await harness.post(route, baseRequest);
  assert.equal(resolver.status, 200);

  const declaration = {
    name: "run_command",
    parametersJsonSchema: {
      type: "object",
      properties: {
        CommandLine: { type: "string" },
        Cwd: { type: "string" },
        WaitMsBeforeAsync: { type: "integer" },
        toolSummary: { type: "string" },
        toolAction: { type: "string" },
      },
      required: [
        "CommandLine",
        "Cwd",
        "WaitMsBeforeAsync",
        "toolSummary",
        "toolAction",
      ],
    },
  };
  const actual = {
    ...baseRequest,
    tools: [{ functionDeclarations: [declaration] }],
  };
  const first = await harness.post(route, actual);
  assert.match(await first.text(), /"functionCall"/u);

  const hook = await harness.post(
    "/hook",
    {
      toolCall: { name: "run_command", args: { CommandLine: "fixture" } },
      stepIdx: 2,
    },
    "not-used-for-hook",
  );
  assert.deepEqual(await hook.json(), {
    decision: "deny",
    reason:
      "Unauthorized tool 'run_command'. Quorum enforces broker-only tools.",
  });
  assert.deepEqual(harness.provider.hookObservation(), {
    tool_name: "run_command",
    argument_names: ["CommandLine"],
    decision: "deny",
  });

  const second = await harness.post(route, actual);
  assert.match(await second.text(), /QUORUM_OK/u);
  assert.equal(harness.provider.observations.length, 3);
  assert.equal(harness.provider.rejectedRequests(), 0);
});

void test("fake provider rejects a non-sentinel credential", async (t) => {
  const harness = await setup(t);
  const response = await harness.post(route, baseRequest, "unexpected-key");
  assert.equal(response.status, 400);
  assert.equal(harness.provider.observations.length, 0);
  assert.equal(harness.provider.rejectedRequests(), 1);
});

void test("conformance report cannot promote component evidence", () => {
  const report = {
    kind: "agy_offline_conformance",
    schema_version: "1.0.0",
    expected_version: "1.2.14",
    external_model_attempts: 0,
    local_provider_requests: 3,
    proxy_requests: 3,
    ledger_events: 6,
    rejected_provider_requests: 0,
    provider_paths: [route, route, route],
    runner_sentinel_configured: true,
    upstream_fixture_credential_only: true,
    hook_observed: true,
    denied_tool: "run_command",
    denied_effect_absent: true,
    completed: true,
    usage: {
      input_tokens: 20,
      output_tokens: 5,
      thinking_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 25,
    },
    direct_gemini_route: true,
    cloud_code_route: false,
    failure: null,
    enforced_conformance: false,
    mandatory_capabilities: "PARTIAL",
  };
  assert.equal(agyConformanceReportSchema.safeParse(report).success, true);
  assert.equal(
    agyConformanceReportSchema.safeParse({
      ...report,
      enforced_conformance: true,
    }).success,
    false,
  );
});
