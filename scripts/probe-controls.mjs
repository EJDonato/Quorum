import { parseArgs } from "node:util";
import { open, mkdtemp, rename, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { discoverControls } from "../dist/tests/probes/control-discovery.js";
import {
  controlDiscoverySchema,
  unverifiedObservations,
} from "../dist/tests/probes/control-protocol.js";

function options() {
  const { values } = parseArgs({
    options: {
      runner: { type: "string" },
      executable: { type: "string" },
      "expected-version": { type: "string" },
      "report-dir": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    !["codex", "agy"].includes(values.runner) ||
    !values.executable ||
    !isAbsolute(values.executable) ||
    !/^\d+\.\d+\.\d+[\w.-]*$/.test(values["expected-version"] ?? "") ||
    (values["report-dir"] && !isAbsolute(values["report-dir"]))
  ) {
    throw new Error(
      "Usage: npm run probe:controls -- --runner codex|agy --executable /absolute/path --expected-version VERSION [--report-dir /absolute/existing/directory]",
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
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function main() {
  const values = options();
  const base = await realpath(values["report-dir"] ?? tmpdir());
  const cwd = await mkdtemp(join(base, "quorum-controls-"));
  await syncDirectory(base);
  await durableJson(join(cwd, "intent.json"), {
    schema_version: "1.0.0",
    kind: "runner_control_metadata",
    runner: values.runner,
    expected_version: values["expected-version"],
    model_calls_authorized: false,
    max_model_attempts: 0,
  });
  await syncDirectory(cwd);
  process.stderr.write(
    `Control discovery intent: ${join(cwd, "intent.json")}\n`,
  );
  let report;
  try {
    report = await discoverControls({
      runner: values.runner,
      executable: values.executable,
      expectedVersion: values["expected-version"],
      cwd,
    });
  } catch {
    report = {
      schema_version: "1.0.0",
      kind: "runner_control_metadata",
      runner: values.runner,
      expected_version: values["expected-version"],
      observed_version: null,
      executable_digest: null,
      binary_unchanged: false,
      steps: [
        {
          id: "version",
          attempted: null,
          exit_code: null,
          failure: "INFRASTRUCTURE_FAILED",
        },
      ],
      known_features: {
        shell_tool: null,
        unified_exec: null,
        token_budget: null,
        rollout_budget: null,
      },
      protocol_fields: { dynamic_tools: false, output_schema: false },
      capability_observations: unverifiedObservations(),
      enforced_conformance: false,
    };
  }
  const checked = controlDiscoverySchema.safeParse(report);
  if (!checked.success) throw new Error("Invalid control discovery report");
  const temporary = join(cwd, "report.json.tmp");
  const path = join(cwd, "report.json");
  await durableJson(temporary, checked.data);
  await rename(temporary, path);
  await syncDirectory(cwd);
  process.stdout.write(JSON.stringify(checked.data) + "\n");
  process.stderr.write(`Control discovery report: ${path}\n`);
  process.exitCode = report.steps.some((step) => step.failure !== null) ? 1 : 0;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? `${error.message}\n`
      : "Control discovery failed; inspect the reserved intent directory. No capability was proven.\n",
  );
  process.exitCode = 1;
}
