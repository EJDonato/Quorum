import { parseArgs } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { captureProcess } from "../dist/tests/probes/process.js";
import {
  probeArguments,
  responseJsonSchema,
  validateProbe,
} from "../dist/tests/probes/protocol.js";

async function main() {
  const { values } = parseArgs({
    options: {
      live: { type: "boolean" },
      runner: { type: "string" },
      model: { type: "string" },
      executable: { type: "string" },
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
    !isAbsolute(values.executable)
  ) {
    throw new Error(
      "Usage: npm run probe:runners -- --live --runner codex|agy --model MODEL --executable /absolute/path",
    );
  }
  if (process.platform === "win32")
    throw new Error("This probe supports POSIX hosts only.");
  const cwd = await mkdtemp(join(tmpdir(), "quorum-probe-"));
  const schemaPath = join(cwd, "response.schema.json");
  await writeFile(schemaPath, JSON.stringify(responseJsonSchema), {
    mode: 0o600,
  });
  const version = await captureProcess({
    executable: values.executable,
    args: ["--version"],
    cwd,
    timeoutMs: 10_000,
  });
  if (
    version.interrupted ||
    version.exitCode !== 0 ||
    !/^(?:codex-cli )?\d+\.\d+\.\d+[\w.-]*\s*$/.test(version.stdout)
  ) {
    throw new Error("Version discovery failed; no model request launched.");
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const capture = await captureProcess({
    executable: values.executable,
    args: probeArguments({
      runner: values.runner,
      model: values.model,
      schemaPath,
    }),
    cwd,
    timeoutMs: 60_000,
    signal: controller.signal,
  });
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
  const result = validateProbe({ runner: values.runner, ...capture });
  const report = {
    schema_version: "1.0.0",
    kind: "structured_output_smoke",
    recorded_at: new Date().toISOString(),
    runner: values.runner,
    runner_version: version.stdout.trim(),
    requested_model: values.model,
    model_identity_verified: false,
    timeout_ms: 60_000,
    attempts: 1,
    enforced_conformance: false,
    cleanup_confirmed: false,
    exit_code: capture.exitCode,
    execution_failure: capture.failure,
    result,
  };
  const reportPath = join(cwd, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(JSON.stringify(report) + "\n");
  process.stderr.write(`Probe report: ${reportPath}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

try {
  await main();
} catch (error) {
  // Only host validation messages are exposed; runner output is never interpolated.
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? error.message + "\n"
      : "Probe infrastructure failed; no passing evidence recorded.\n",
  );
  process.exitCode = 1;
}
