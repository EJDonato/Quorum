import assert from "node:assert/strict";
import test from "node:test";
import {
  createFoundationPlan,
  parseFoundationDocument,
  type FoundationDocument,
  type FoundationPublicationPort,
} from "../../src/application/foundation-plan.js";
import { failure } from "../../src/contracts/errors.js";

const responses = {
  product:
    "<quorum_document>\n# Product Requirements Document\n\nBuild a local app.\n</quorum_document>",
  architecture:
    "<quorum_document>\n# System Design\n\nUse explicit boundaries.\n</quorum_document>",
  delivery:
    "<quorum_document>\n# Implementation Plan\n\n1. Build a slice.\n</quorum_document>",
} as const;

await test("foundation planning drafts in dependency order and publishes once", async () => {
  const prompts: string[] = [];
  let published: readonly FoundationDocument[] = [];
  const publication: FoundationPublicationPort = {
    ensureAvailable: () => Promise.resolve({ ok: true, value: undefined }),
    publish: (documents) => {
      published = documents;
      return Promise.resolve({
        ok: true,
        value: {
          paths: documents.map((document) => document.name),
          transactionId: "tx-1",
        },
      });
    },
  };
  const result = await createFoundationPlan({
    requirements: "Build a private issue tracker.",
    publication,
    draft: (stage, prompt) => {
      prompts.push(prompt);
      return Promise.resolve({ ok: true, value: responses[stage] });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    published.map((document) => document.name),
    ["PRD.md", "SYSTEM_DESIGN.md", "PLAN.md"],
  );
  assert.doesNotMatch(prompts[0] ?? "", /BEGIN PRD\.md/);
  assert.match(prompts[1] ?? "", /BEGIN PRD\.md/);
  assert.match(prompts[2] ?? "", /BEGIN SYSTEM_DESIGN\.md/);
});

await test("foundation planning stops before drafting when targets exist", async () => {
  let drafts = 0;
  const result = await createFoundationPlan({
    requirements: "Build a private issue tracker.",
    publication: {
      ensureAvailable: () =>
        Promise.resolve(failure("INVALID_INPUT", "PRD.md already exists.")),
      publish: () => Promise.resolve(assert.fail("publish must not run")),
    },
    draft: () => {
      drafts += 1;
      return Promise.resolve({ ok: true, value: responses.product });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(drafts, 0);
});

await test("foundation planning rejects malformed stage output without publishing", async () => {
  let published = false;
  const result = await createFoundationPlan({
    requirements: "Build a private issue tracker.",
    publication: {
      ensureAvailable: () => Promise.resolve({ ok: true, value: undefined }),
      publish: () => {
        published = true;
        return Promise.resolve(assert.fail("publish must not run"));
      },
    },
    draft: () => Promise.resolve({ ok: true, value: "# Product Requirements" }),
  });
  assert.equal(result.ok, false);
  assert.equal(published, false);
});

await test("foundation document parsing enforces the stage heading", () => {
  const result = parseFoundationDocument(
    "architecture",
    "<quorum_document># Product Requirements Document</quorum_document>",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "EVIDENCE_INVALID");
});
