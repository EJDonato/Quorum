import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCodexTransport } from "../../src/infrastructure/model-gateway/codex-upstream.js";

void test("Codex transport accepts only bounded loopback or official endpoints", () => {
  for (const upstreamUrl of [
    "http://127.0.0.1:32123/v1",
    "http://127.0.0.1:32123/v1/responses",
    "https://api.openai.com/v1",
  ]) {
    assert.ok(validateCodexTransport({ upstreamUrl }).ok);
  }
});

void test("Codex transport rejects alternate hosts, credentials, parameters and unsafe bounds", () => {
  for (const options of [
    { upstreamUrl: "https://attacker.invalid/v1" },
    { upstreamUrl: "http://localhost:32123/v1" },
    { upstreamUrl: "https://user:secret@api.openai.com/v1" },
    { upstreamUrl: "https://api.openai.com/v1?redirect=1" },
    { upstreamUrl: "https://api.openai.com/other" },
    { upstreamUrl: "https://api.openai.com/v1", timeoutMs: 0 },
    { upstreamUrl: "https://api.openai.com/v1", maxResponseBytes: 1_048_577 },
  ]) {
    const result = validateCodexTransport(options);
    assert.ok(!result.ok);
    assert.equal(result.error.code, "INVALID_INPUT");
  }
});
