import assert from "node:assert/strict";
import test from "node:test";
import { containerAbsent } from "../probes/container-boundary.js";
import { type ContainerCancellationReport } from "../probes/container-cancellation.js";

await test("container cancellation report structure requires confirmed cgroup containment", () => {
  const validReport: ContainerCancellationReport = {
    schema_version: "1.0.0",
    kind: "container_cancellation_probe",
    image_id:
      "sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a",
    docker_version: "29.6.2",
    container_id: "quorum-cancel-test",
    launched: true,
    stubborn_tree_started: true,
    cancelled: true,
    cleanup_confirmed: true,
    cgroup_containment_effective: true,
    failure: null,
  };

  assert.equal(validReport.cgroup_containment_effective, true);
  assert.equal(validReport.cleanup_confirmed, true);
  assert.equal(validReport.failure, null);

  const unconfirmed: ContainerCancellationReport = {
    ...validReport,
    cleanup_confirmed: false,
    cgroup_containment_effective: false,
    failure: "CANCELLATION_FAILED",
  };

  assert.equal(unconfirmed.cgroup_containment_effective, false);
  assert.equal(unconfirmed.failure, "CANCELLATION_FAILED");
});

await test("container absent parser validates exact absence stderr patterns", () => {
  assert.equal(
    containerAbsent({
      exitCode: 1,
      failure: null,
      stderr: "Error: No such object: quorum-cancel-123\n",
    }),
    true,
  );

  assert.equal(
    containerAbsent({
      exitCode: 1,
      failure: null,
      stderr: "error: no such object: quorum-cancel-123\n",
    }),
    true,
  );

  assert.equal(
    containerAbsent({
      exitCode: 0,
      failure: null,
      stderr: "running\n",
    }),
    false,
  );
});
