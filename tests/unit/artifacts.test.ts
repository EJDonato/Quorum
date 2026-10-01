import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  computeSha256,
  readArtifact,
  validateSafeRelativePath,
  writeArtifact,
} from "../../src/infrastructure/storage/artifacts.js";

await test("validateSafeRelativePath prevents path traversal and absolute escapes", () => {
  const base = "/tmp/quorum-base";
  assert.equal(validateSafeRelativePath(base, "valid/sub/file.json").ok, true);
  assert.equal(validateSafeRelativePath(base, "../escaped.txt").ok, false);
  assert.equal(validateSafeRelativePath(base, "/absolute/path").ok, false);
  assert.equal(validateSafeRelativePath(base, "a/../../escaped").ok, false);
});

await test("writeArtifact creates immutable file with read-only permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorum-test-art-"));
  try {
    const content = JSON.stringify({ key: "value" });
    const written = await writeArtifact({
      baseDir: dir,
      relativePath: "candidates/c1/manifest.json",
      content,
    });
    assert.equal(written.ok, true);
    if (!written.ok) return;

    assert.equal(written.value.digest, computeSha256(content));
    const fileStat = await stat(written.value.fullPath);
    // On POSIX, mode 0o444 check (read-only)
    assert.equal((fileStat.mode & 0o222) === 0, true);

    const read = await readArtifact({
      baseDir: dir,
      relativePath: "candidates/c1/manifest.json",
      expectedDigest: written.value.digest,
    });
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value.content.toString("utf8"), content);

    // Mismatched expected digest fails
    const badRead = await readArtifact({
      baseDir: dir,
      relativePath: "candidates/c1/manifest.json",
      expectedDigest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    });
    assert.equal(badRead.ok, false);
    if (!badRead.ok) {
      assert.equal(badRead.error.code, "EVIDENCE_INVALID");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
