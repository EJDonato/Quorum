import assert from "node:assert/strict";
import { test } from "node:test";
import { admitCodexResponsesRequest } from "../../src/infrastructure/model-gateway/codex-request-firewall.js";

const repoTool = {
  type: "namespace",
  name: "repo",
  description: "Broker repository reads",
  tools: [
    {
      type: "function",
      name: "read",
      description: "Read a scoped file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  ],
};

function request(tools: unknown[] = [repoTool]) {
  return {
    client_metadata: { client: "codex" },
    include: ["reasoning.encrypted_content"],
    input: [{ type: "message", role: "user", content: [] }],
    instructions: "Host-supplied role instructions",
    model: "gpt-6-sol",
    parallel_tool_calls: false,
    prompt_cache_key: "host-context-digest",
    reasoning: { effort: "medium" },
    store: false,
    stream: true,
    tool_choice: "auto",
    tools,
  };
}

void test("admits the exact broker tool manifest and injects an immutable host output ceiling", () => {
  const result = admitCodexResponsesRequest({
    request: request(),
    model: "gpt-6-sol",
    outputTokensLimit: 64,
    authorizedTools: [repoTool],
  });
  assert.ok(result.ok);
  assert.equal(result.value.max_output_tokens, 64);
  assert.equal(result.value.stream, true);
  assert.equal(result.value.store, false);
  assert.ok(Object.isFrozen(result.value));
  assert.ok(Object.isFrozen(result.value.tools[0]));
});

void test("rejects the observed Codex built-in before provider transmission", () => {
  const result = admitCodexResponsesRequest({
    request: request([
      { type: "function", name: "request_user_input", parameters: {} },
      repoTool,
    ]),
    model: "gpt-6-sol",
    outputTokensLimit: 64,
    authorizedTools: [repoTool],
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "CAPABILITY_MISSING");
});

void test("rejects model, remote-state, ceiling and request-shape overrides", () => {
  for (const changed of [
    { ...request(), model: "gpt-6-astra" },
    { ...request(), previous_response_id: "remote" },
    { ...request(), conversation: "remote" },
    { ...request(), max_output_tokens: 100000 },
    { ...request(), store: true },
    { ...request(), stream: false },
    {
      ...request(),
      input: Array.from({ length: 20 }, () => "x".repeat(65536)),
    },
  ]) {
    const result = admitCodexResponsesRequest({
      request: changed,
      model: "gpt-6-sol",
      outputTokensLimit: 64,
      authorizedTools: [repoTool],
    });
    assert.ok(!result.ok);
  }
});

void test("rejects modified schemas, duplicate identities and non-function tools", () => {
  const variants = [
    [{ ...repoTool, description: "runner changed this" }],
    [repoTool, repoTool],
    [{ type: "web_search_preview" }],
    [{ type: "function", name: "shell", parameters: {} }],
    [
      {
        type: "namespace",
        name: "repo",
        tools: [{ type: "shell", name: "read" }],
      },
    ],
  ];
  for (const tools of variants) {
    const result = admitCodexResponsesRequest({
      request: request(tools),
      model: "gpt-6-sol",
      outputTokensLimit: 64,
      authorizedTools: [repoTool],
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "CAPABILITY_MISSING");
  }
});
