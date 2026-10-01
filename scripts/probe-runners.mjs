import { parseArgs } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { responseJsonSchema } from "../dist/tests/probes/protocol.js";
import { runSchemaProbe } from "../dist/tests/probes/report.js";

function argumentsForProbe() {
  const { values } = parseArgs({
    options: {
      live: { type: "boolean" },
      runner: { type: "string" },
      model: { type: "string" },
      executable: { type: "string" },
      "expected-version": { type: "string" },
      "report-dir": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    !values.live ||
    !["codex", "agy"].includes(values.runner) ||
    !values.model ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(values.model) ||
    !values.executable ||
    !isAbsolute(values.executable) ||
    !values["expected-version"] ||
    !/^\d+\.\d+\.\d+[\w.-]*$/.test(values["expected-version"]) ||
    (values["report-dir"] && !isAbsolute(values["report-dir"]))
  ) {
    throw new Error(
      "Usage: npm run probe:runners -- --live --runner codex|agy --model MODEL --executable /absolute/path --expected-version VERSION [--report-dir /absolute/existing/directory]",
    );
  }
  if (process.platform === "win32") throw new Error("POSIX_REQUIRED");
  return values;
}

async function prepareReport(values) {
  const cwd = await mkdtemp(
    join(values["report-dir"] ?? tmpdir(), "quorum-probe-"),
  );
  const schemaPath = join(cwd, "response.schema.json");
  const reportPath = join(cwd, "report.json");
  await writeFile(
    join(cwd, "intent.json"),
    JSON.stringify(
      {
        schema_version: "1.0.0",
        runner: values.runner,
        requested_model: values.model,
        expected_version: values["expected-version"],
        recorded_at: new Date().toISOString(),
        max_model_attempts: 1,
        hard_token_ceiling: false,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  process.stderr.write(`Probe report reserved: ${reportPath}\n`);
  return { cwd, schemaPath, reportPath };
}

async function main() {
  const values = argumentsForProbe();
  const { cwd, schemaPath, reportPath } = await prepareReport(values);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let report;
  try {
    await writeFile(schemaPath, JSON.stringify(responseJsonSchema), {
      mode: 0o600,
      flag: "wx",
    });
    report = await runSchemaProbe({
      runner: values.runner,
      model: values.model,
      executable: values.executable,
      expectedVersion: values["expected-version"],
      cwd,
      schemaPath,
      signal: controller.signal,
    });
  } catch {
    report = {
      schema_version: "1.1.0",
      kind: "structured_output_smoke",
      runner: values.runner,
      expected_version: values["expected-version"],
      requested_model: values.model,
      attempts: 0,
      enforced_conformance: false,
      execution_failure: "INFRASTRUCTURE_FAILED",
      result: { ok: false, reason: "EXECUTION_FAILED" },
    };
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(JSON.stringify(report) + "\n");
  process.stderr.write(`Probe report: ${reportPath}\n`);
  process.exitCode = report.result.ok ? 0 : 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? error.message + "\n"
      : "Probe infrastructure or report persistence failed; inspect the reserved intent/report directory. No passing evidence recorded.\n",
  );
  process.exitCode = 1;
}
