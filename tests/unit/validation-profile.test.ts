import assert from "node:assert/strict";
import test from "node:test";
import { imageInspectionSchema } from "../../src/infrastructure/validation/docker-profile.js";
await test("Docker images may omit Volumes, while declared volumes remain visible to preflight", () => {
  const base = {
    Id: `sha256:${"a".repeat(64)}`,
    Os: "linux",
    RepoDigests: [],
    Config: { Env: [] },
  };
  assert.ok(imageInspectionSchema.safeParse(base).success);
  const declared = imageInspectionSchema.parse({
    ...base,
    Config: { Env: [], Volumes: { "/data": {} } },
  });
  assert.deepEqual(Object.keys(declared.Config.Volumes ?? {}), ["/data"]);
  assert.equal(
    imageInspectionSchema.safeParse({ ...base, Os: "windows" }).success,
    false,
  );
});
