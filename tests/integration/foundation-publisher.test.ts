import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { FoundationDocument } from "../../src/application/foundation-plan.js";
import { createFoundationPublisher } from "../../src/infrastructure/foundation/publisher.js";

const documents: FoundationDocument[] = [
  { name: "PRD.md", content: "# Product Requirements Document\n" },
  { name: "SYSTEM_DESIGN.md", content: "# System Design\n" },
  { name: "PLAN.md", content: "# Implementation Plan\n" },
];

await test("foundation publisher exclusively creates all documents and receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "quorum-foundation-"));
  try {
    const publisher = createFoundationPublisher(root);
    const result = await publisher.publish(documents);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      await readFile(join(root, "PRD.md"), "utf8"),
      documents[0]?.content,
    );
    assert.equal(
      await readFile(join(root, "SYSTEM_DESIGN.md"), "utf8"),
      documents[1]?.content,
    );
    const receipt = await readFile(
      join(
        root,
        ".quorum",
        "foundation",
        result.value.transactionId,
        "receipt.json",
      ),
      "utf8",
    );
    assert.match(receipt, /PLAN\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("foundation publisher preserves an existing document and creates nothing else", async () => {
  const root = await mkdtemp(join(tmpdir(), "quorum-foundation-existing-"));
  try {
    await writeFile(join(root, "SYSTEM_DESIGN.md"), "user content\n");
    const result = await createFoundationPublisher(root).publish(documents);
    assert.equal(result.ok, false);
    assert.equal(
      await readFile(join(root, "SYSTEM_DESIGN.md"), "utf8"),
      "user content\n",
    );
    await assert.rejects(readFile(join(root, "PRD.md"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(join(root, "PLAN.md"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
