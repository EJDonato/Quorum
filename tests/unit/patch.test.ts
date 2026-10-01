import assert from "node:assert/strict";
import test from "node:test";
import { extractPatchPaths } from "../../src/broker/patch.js";

await test("extractPatchPaths identifies added, deleted, and modified paths", () => {
  const patch = `diff --git a/src/hello.ts b/src/hello.ts
--- a/src/hello.ts
+++ b/src/hello.ts
@@ -1,2 +1,3 @@
 line 1
+line new
 line 2
diff --git a/src/removed.ts b/dev/null
--- a/src/removed.ts
+++ /dev/null
@@ -1 +0,0 @@
-goodbye
diff --git a/dev/null b/src/added.ts
--- /dev/null
+++ b/src/added.ts
@@ -0,0 +1 @@
+welcome
`;

  const paths = extractPatchPaths(patch);
  assert.equal(paths.ok, true);
  if (paths.ok) {
    assert.deepEqual(paths.value.sort(), [
      "src/added.ts",
      "src/hello.ts",
      "src/removed.ts",
    ]);
  }
});

await test("extractPatchPaths fails on malformed patch without paths", () => {
  const result = extractPatchPaths(
    "random text without patch headers\njust words",
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INVALID_INPUT");
  }
});
