import assert from "node:assert/strict";
import test from "node:test";
import {
  isPathAuthorized,
  isToolAllowed,
  validateSafeRelativePath,
  type BrokerAuthContext,
} from "../../src/broker/authorizer.js";

await test("tool authorization enforces role and phase restrictions", () => {
  const plannerContext: BrokerAuthContext = {
    role: "PLANNER",
    phase: "PLANNING",
    grantedPaths: ["src", "tests"],
    protectedPaths: [".quorum", ".git"],
  };
  assert.equal(isToolAllowed("repo.read", plannerContext).ok, true);
  assert.equal(isToolAllowed("repo.search", plannerContext).ok, true);
  assert.equal(isToolAllowed("draft.apply_patch", plannerContext).ok, false);
  assert.equal(isToolAllowed("checks.run", plannerContext).ok, false);

  const securityContext: BrokerAuthContext = {
    role: "SECURITY",
    phase: "REVIEWING",
    grantedPaths: ["."],
    protectedPaths: [],
  };
  assert.equal(isToolAllowed("draft.apply_patch", securityContext).ok, false);
  assert.equal(isToolAllowed("checks.run", securityContext).ok, false);

  const qaReviewContext: BrokerAuthContext = {
    role: "QA",
    phase: "REVIEWING",
    grantedPaths: ["."],
    protectedPaths: [],
  };
  assert.equal(isToolAllowed("draft.apply_patch", qaReviewContext).ok, false);

  const qaTestAuthoringContext: BrokerAuthContext = {
    role: "QA",
    phase: "TEST_SPEC",
    grantedPaths: ["tests"],
    protectedPaths: ["src"],
  };
  assert.equal(
    isToolAllowed("draft.apply_patch", qaTestAuthoringContext).ok,
    true,
  );
  assert.equal(isToolAllowed("checks.run", qaTestAuthoringContext).ok, true);

  const devContext: BrokerAuthContext = {
    role: "DEVELOPER",
    phase: "IMPLEMENTING",
    grantedPaths: ["src"],
    protectedPaths: ["tests", ".quorum"],
  };
  assert.equal(isToolAllowed("draft.apply_patch", devContext).ok, true);
  assert.equal(isToolAllowed("checks.run", devContext).ok, true);
});

await test("path authorization rejects traversal, absolute paths, and metadata escapes", () => {
  assert.equal(validateSafeRelativePath("../escape.txt").ok, false);
  assert.equal(validateSafeRelativePath("/etc/passwd").ok, false);
  assert.equal(validateSafeRelativePath("src/../../etc/passwd").ok, false);
  assert.equal(validateSafeRelativePath("src/file.ts").ok, true);

  const context: BrokerAuthContext = {
    role: "DEVELOPER",
    phase: "IMPLEMENTING",
    grantedPaths: ["src"],
    protectedPaths: ["src/protected.ts", "tests"],
  };

  assert.equal(isPathAuthorized(".git/config", context).ok, false);
  assert.equal(isPathAuthorized(".quorum/config.json", context).ok, false);
  assert.equal(isPathAuthorized("tests/unit.test.ts", context).ok, false);
  assert.equal(isPathAuthorized("src/protected.ts", context).ok, false);
  assert.equal(isPathAuthorized("unauthorized/file.ts", context).ok, false);
  assert.equal(isPathAuthorized("src/valid.ts", context).ok, true);
});
