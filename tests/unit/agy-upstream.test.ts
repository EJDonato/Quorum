import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseAgyUsage,
  validateAgyUpstream,
} from "../../src/infrastructure/adapters/agy/upstream.js";

const transport = (upstreamUrl: string) => ({
  kind: "upstream" as const,
  upstreamUrl,
  upstreamCredential: () =>
    Promise.resolve({ ok: true as const, value: "fixture" }),
});

void test("agy upstream transport permits only explicit official or loopback bases", () => {
  assert.ok(
    validateAgyUpstream(transport("https://generativelanguage.googleapis.com"))
      .ok,
  );
  assert.ok(validateAgyUpstream(transport("http://127.0.0.1:1234")).ok);
  assert.equal(validateAgyUpstream(transport("https://example.com")).ok, false);
  assert.equal(
    validateAgyUpstream(transport("http://localhost:1234")).ok,
    false,
  );
  assert.equal(
    validateAgyUpstream(
      transport("https://generativelanguage.googleapis.com/evil"),
    ).ok,
    false,
  );
});

void test("agy usage parser rejects duplicate usage records", () => {
  const record = JSON.stringify({
    usageMetadata: {
      promptTokenCount: 2,
      candidatesTokenCount: 1,
      totalTokenCount: 3,
    },
  });
  const parsed = parseAgyUsage(
    Buffer.from(`data: ${record}\n\ndata: ${record}\n\n`),
    "text/event-stream",
  );
  assert.equal(parsed.ok, false);
});
