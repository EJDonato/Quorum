import { parseArgs } from "node:util";
import {
  open,
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  writeFile,
  rename,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { captureProcess } from "../dist/tests/probes/process.js";
import {
  agyOfflineEnvironment,
  runAgyOfflineProtocol,
} from "../dist/tests/probes/agy-offline-process.js";
import { agyOfflineReportSchema } from "../dist/tests/probes/agy-offline-report.js";

function parseOptions() {
  const { values } = parseArgs({
    options: {
      executable: { type: "string" },
      "expected-version": { type: "string" },
      "report-dir": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    !isAbsolute(values.executable ?? "") ||
    !/^\d+\.\d+\.\d+$/.test(values["expected-version"] ?? "") ||
    (values["report-dir"] && !isAbsolute(values["report-dir"]))
  ) {
    throw new Error(
      "Usage: npm run probe:agy:offline -- --executable /absolute/agy --expected-version VERSION [--report-dir /absolute/dir]",
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

const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const brokerToolNames = new Set([
  "repo.read",
  "repo.search",
  "artifact.read",
  "draft.apply_patch",
  "checks.run",
  "role.submit",
  "scope.request",
]);

async function main() {
  const values = parseOptions();
  const base = await realpath(values["report-dir"] ?? tmpdir());
  const root = await mkdtemp(join(base, "quorum-agy-offline-"));
  await syncDirectory(base);

  await durableJson(join(root, "intent.json"), {
    schema_version: "1.0.0",
    kind: "agy_offline_protocol",
    expected_version: values["expected-version"],
    external_model_attempts: 0,
    timeout_ms: 10000,
    max_output_bytes: 1048576,
    enforced_conformance: false,
  });
  await syncDirectory(root);
  process.stderr.write(`Offline probe intent: ${join(root, "intent.json")}\n`);

  let stage = "platform";
  let report = {
    kind: "agy_offline_protocol",
    schema_version: "1.0.0",
    expected_version: values["expected-version"],
    failure: "INFRASTRUCTURE_FAILED",
    enforced_conformance: false,
    external_model_attempts: 0,
    initialized: false,
    completed: false,
    effective_tool_inventory: null,
    native_tool_count: null,
    broker_tools_exclusive: false,
    usage: null,
    mandatory_capabilities: "UNVERIFIED",
  };

  try {
    if (process.platform !== "darwin") {
      throw new Error("Offline OS boundary unavailable");
    }
    stage = "isolation_setup";
    const executable = await realpath(values.executable);
    const binaryDigest = digest(await readFile(executable));
    const home = join(root, "home");
    const cwd = join(root, "work");
    await mkdir(home, { mode: 0o700 });
    await mkdir(cwd, { mode: 0o700 });
    const cliDir = join(home, ".gemini", "antigravity-cli");
    await mkdir(cliDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(cliDir, "settings.json"),
      JSON.stringify({ toolPermission: "always-proceed" }),
      { flag: "wx", mode: 0o600 },
    );

    const profile =
      `(version 1)(allow default)(deny network*)` +
      `(allow network-bind (local ip "localhost:*"))` +
      `(allow network-inbound (local ip "localhost:*"))` +
      `(deny file-read* (subpath ${JSON.stringify(homedir())}))` +
      `(allow file-read* (literal ${JSON.stringify(executable)}))` +
      `(allow file-read* file-write* (subpath ${JSON.stringify(root)}))`;

    await writeFile(join(root, "sandbox.sb"), profile, {
      flag: "wx",
      mode: 0o600,
    });
    const env = agyOfflineEnvironment(home);

    stage = "version";
    const versionRes = await captureProcess({
      executable,
      args: ["--version"],
      cwd,
      env,
      timeoutMs: 10000,
      maxOutputBytes: 1048576,
    });
    if (versionRes.failure || versionRes.exitCode !== 0) {
      throw new Error("Version discovery failed");
    }
    const matched = /(\d+\.\d+\.\d+)/.exec(versionRes.stdout);
    if (!matched || matched[1] !== values["expected-version"]) {
      throw new Error("Version mismatch");
    }

    stage = "protocol";
    const result = await runAgyOfflineProtocol({
      executable: "/usr/bin/sandbox-exec",
      args: [
        "-f",
        join(root, "sandbox.sb"),
        executable,
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "-p",
        "",
      ],
      cwd,
      env,
      initOnly: true,
      timeoutMs: 10000,
      maxOutputBytes: 1048576,
    });

    const tools = result.protocol.tools;
    const isExclusive =
      tools !== null &&
      tools.length > 0 &&
      tools.every((t) => brokerToolNames.has(t));
    const failureReason = !isExclusive
      ? "TOOL_ENFORCEMENT_FAILED"
      : result.failure;

    report = {
      ...report,
      failure: failureReason,
      observed_version: matched[1],
      executable_digest: binaryDigest,
      binary_unchanged: binaryDigest === digest(await readFile(executable)),
      sandbox_digest: digest(profile),
      initialized: result.protocol.initialized,
      completed: result.protocol.completed,
      effective_tool_inventory: tools,
      native_tool_count: tools ? tools.length : null,
      broker_tools_exclusive: isExclusive,
      usage: result.protocol.usage,
      events: result.protocol.events,
      exit_code: result.exitCode,
      cleanup: "PROCESS_GROUP_ONLY_UNVERIFIED",
    };
  } catch {
    report = {
      ...report,
      failure: "INFRASTRUCTURE_FAILED",
      failure_stage: stage,
    };
  }

  const temporary = join(root, "report.json.tmp");
  const checked = agyOfflineReportSchema.parse(report);
  await durableJson(temporary, checked);
  await rename(temporary, join(root, "report.json"));
  await syncDirectory(root);

  process.stdout.write(JSON.stringify(checked) + "\n");
  process.stderr.write(`Offline probe report: ${join(root, "report.json")}\n`);
  process.exitCode = 0;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? `${error.message}\n`
      : "Offline probe failed; inspect the reserved intent directory.\n",
  );
  process.exitCode = 1;
}
