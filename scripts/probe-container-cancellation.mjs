import { parseArgs } from "node:util";
import { mkdtemp, open, realpath, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { probeContainerCancellation } from "../dist/tests/probes/container-cancellation.js";

function parseOptions() {
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
  ) {
    throw new Error(
      "Usage: npm run probe:container:cancellation -- --image-id sha256:HEX [--report-dir /absolute/dir]",
    );
  }
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
  const values = parseOptions();
  const base = await realpath(values["report-dir"] ?? tmpdir());
  const directory = await mkdtemp(
    join(base, "quorum-container-cancel-report-"),
  );
  await syncDirectory(base);

  await durableJson(join(directory, "intent.json"), {
    schema_version: "1.0.0",
    kind: "container_cancellation_probe",
    image_id: values["image-id"],
    descendant_cancellation_expected: true,
  });
  await syncDirectory(directory);
  process.stderr.write(
    `Container cancellation intent: ${join(directory, "intent.json")}\n`,
  );

  let report;
  try {
    report = await probeContainerCancellation({
      imageId: values["image-id"],
      cwd: directory,
    });
  } catch (error) {
    report = {
      schema_version: "1.0.0",
      kind: "container_cancellation_probe",
      image_id: values["image-id"],
      docker_version: null,
      container_id: "",
      launched: false,
      stubborn_tree_started: false,
      cancelled: false,
      cleanup_confirmed: false,
      cgroup_containment_effective: false,
      failure: `ERROR: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }

  const temporary = join(directory, "report.json.tmp");
  const path = join(directory, "report.json");
  await durableJson(temporary, report);
  await rename(temporary, path);
  await syncDirectory(directory);

  process.stdout.write(JSON.stringify(report) + "\n");
  process.stderr.write(`Container cancellation report: ${path}\n`);

  process.exitCode =
    report.failure === null &&
    report.cgroup_containment_effective &&
    report.cleanup_confirmed
      ? 0
      : 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? `${error.message}\n`
      : "Container probe failed; inspect the reserved intent directory.\n",
  );
  process.exitCode = 1;
}
