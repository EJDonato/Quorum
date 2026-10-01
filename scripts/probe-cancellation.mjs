import { parseArgs } from "node:util";
import { mkdtemp, open, realpath, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { runCancellationProbeSuite } from "../dist/tests/probes/cancellation.js";

function options() {
  const { values } = parseArgs({
    options: {
      "report-dir": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values["report-dir"] && !isAbsolute(values["report-dir"])) {
    throw new Error(
      "Usage: npm run probe:cancellation -- [--report-dir /absolute/existing/directory]",
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
  const values = options();
  const base = await realpath(values["report-dir"] ?? tmpdir());
  const directory = await mkdtemp(join(base, "quorum-cancel-report-"));
  await syncDirectory(base);
  await durableJson(join(directory, "intent.json"), {
    schema_version: "1.0.0",
    kind: "descendant_cancellation_probe",
    model_calls_authorized: false,
    recorded_at: new Date().toISOString(),
  });
  await syncDirectory(directory);
  process.stderr.write(
    `Cancellation probe intent: ${join(directory, "intent.json")}\n`,
  );
  let report;
  try {
    report = await runCancellationProbeSuite({ baseDir: directory });
  } catch {
    report = {
      schema_version: "1.0.0",
      kind: "descendant_cancellation_probe",
      recorded_at: new Date().toISOString(),
      process_group_cleanup_effective: false,
      detached_escape_observed: false,
      container_boundary_required: true,
    };
  }
  const temporary = join(directory, "report.json.tmp");
  const path = join(directory, "report.json");
  await durableJson(temporary, report);
  await rename(temporary, path);
  await syncDirectory(directory);
  process.stdout.write(JSON.stringify(report) + "\n");
  process.stderr.write(`Cancellation probe report: ${path}\n`);
  process.exitCode =
    report.process_group_cleanup_effective && report.detached_escape_observed
      ? 0
      : 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    error instanceof Error ? error.message + "\n" : "Unknown error\n",
  );
  process.exitCode = 1;
}
