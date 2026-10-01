import assert from "node:assert/strict";
import test from "node:test";
import { containerAbsent } from "../probes/container-boundary.js";

await test("cleanup confirms only an explicit Docker no-such-object response", () => {
  assert.equal(
    containerAbsent({
      exitCode: 1,
      failure: null,
      stderr: "error: no such object: fixture-id\n",
    }),
    true,
  );
  for (const result of [
    {
      exitCode: 1,
      failure: null,
      stderr: "Cannot connect to the Docker daemon",
    },
    {
      exitCode: 1,
      failure: "TIMED_OUT",
      stderr: "error: no such object: fixture-id",
    },
    { exitCode: 0, failure: null, stderr: "error: no such object: fixture-id" },
    { exitCode: null, failure: "LAUNCH_FAILED", stderr: "" },
  ])
    assert.equal(containerAbsent(result), false);
});
