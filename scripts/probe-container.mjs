import { parseArgs } from "node:util";
import { mkdtemp, open, realpath, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { probeContainerBoundary } from "../dist/tests/probes/container-boundary.js";

function options() {
  const { values } = parseArgs({
    options: {
      "image-id": { type: "string" },
      "report-dir": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    !/^sha256:[a-f0-9]{64}$/.test(values["image-id"] ?? "") ||
    (values["report-dir"] && !isAbsolute(values["report-dir"]))
  )
    throw new Error(
      "Usage: npm run probe:container -- --image-id sha256:HEX [--report-dir /absolute/existing/directory]",
    );
  return values;
}

async function durableJson(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function main() {
  const values = options();
  const base = await realpath(values["report-dir"] ?? tmpdir());
  const directory = await mkdtemp(join(base, "quorum-container-report-"));
  await syncDirectory(base);
  await durableJson(join(directory, "intent.json"), {
    schema_version: "1.0.0",
    kind: "synthetic_container_boundary",
    image_id: values["image-id"],
    model_calls_authorized: false,
    original_source_mount: false,
    artifact_store_mount: false,
    network_mode: "none",
    read_only_root: true,
  });
  await syncDirectory(directory);
  process.stderr.write(
    `Container probe intent: ${join(directory, "intent.json")}\n`,
  );
  let report;
  try {
    report = await probeContainerBoundary({
      baseDirectory: directory,
      imageId: values["image-id"],
    });
  } catch {
    report = {
      schema_version: "1.0.0",
      kind: "synthetic_container_boundary",
      image_id: values["image-id"],
      docker_version: null,
      container_id: null,
      launched: null,
      exit_code: null,
      failure: "INFRASTRUCTURE_FAILED",
      observations: {},
      cleanup_confirmed: false,
      runner_isolation_proven: false,
    };
  }
  const temporary = join(directory, "report.json.tmp");
  const path = join(directory, "report.json");
  await durableJson(temporary, report);
  await rename(temporary, path);
  await syncDirectory(directory);
  process.stdout.write(JSON.stringify(report) + "\n");
  process.stderr.write(`Container probe report: ${path}\n`);
  process.exitCode =
    report.failure === null &&
    report.cleanup_confirmed &&
    Object.values(report.observations).every((value) => value === true)
      ? 0
      : 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? `${error.message}\n`
      : "Container probe failed; inspect the reserved intent directory. No runner capability was proven.\n",
  );
  process.exitCode = 1;
}
