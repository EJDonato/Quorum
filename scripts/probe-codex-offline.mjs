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
  offlineEnvironment,
  runOfflineProtocol,
} from "../dist/tests/probes/codex-offline-process.js";
import { startFakeProvider } from "../dist/tests/probes/codex-fake-provider.js";
import { offlineReportSchema } from "../dist/tests/probes/codex-offline-report.js";

function options() {
  const { values } = parseArgs({
    options: {
      executable: { type: "string" },
      "expected-version": { type: "string" },
      "fake-provider": { type: "boolean", default: false },
      "report-dir": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    !isAbsolute(values.executable ?? "") ||
    !/^\d+\.\d+\.\d+$/.test(values["expected-version"] ?? "") ||
    (values["report-dir"] && !isAbsolute(values["report-dir"]))
  )
    throw new Error(
      "Usage: npm run probe:codex:offline -- --executable /absolute/codex --expected-version VERSION [--fake-provider] [--report-dir /absolute/existing/directory]",
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

const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function main() {
  const values = options();
  const base = await realpath(values["report-dir"] ?? tmpdir());
  const root = await mkdtemp(join(base, "quorum-codex-offline-"));
  await syncDirectory(base);
  await durableJson(join(root, "intent.json"), {
    schema_version: "1.1.0",
    kind: "codex_offline_protocol",
    expected_version: values["expected-version"],
    external_model_attempts: 0,
    fake_provider: values["fake-provider"],
    timeout_ms: 10000,
    max_output_bytes: 1048576,
    max_fixture_requests: 1,
    enforced_conformance: false,
  });
  await syncDirectory(root);
  process.stderr.write(`Offline probe intent: ${join(root, "intent.json")}\n`);
  let provider;
  let stage = "platform";
  let report = {
    kind: "codex_offline_protocol",
    schema_version: "1.1.0",
    expected_version: values["expected-version"],
    failure: "INFRASTRUCTURE_FAILED",
    enforced_conformance: false,
    external_model_attempts: 0,
    initialized: false,
    registered: false,
    completed: false,
    effective_tool_inventory: null,
    usage: null,
    provider_requests: [],
    mandatory_capabilities: "UNVERIFIED",
  };
  try {
    if (process.platform !== "darwin")
      throw new Error("Offline OS boundary unavailable");
    stage = "isolation_setup";
    const executable = await realpath(values.executable);
    const binaryDigest = digest(await readFile(executable));
    const home = join(root, "home");
    const cwd = join(root, "work");
    await mkdir(home, { mode: 0o700 });
    await mkdir(cwd, { mode: 0o700 });
    if (values["fake-provider"]) provider = await startFakeProvider();
    const profile =
      `(version 1)(allow default)(deny network*)(deny file-write*)` +
      `(deny file-read* (subpath ${JSON.stringify(homedir())}))` +
      `(allow file-read* (literal ${JSON.stringify(executable)}))` +
      `(allow file-read* file-write* (subpath ${JSON.stringify(root)}))` +
      (provider
        ? `(allow network-outbound (remote ip "localhost:${provider.port}"))`
        : "");
    await writeFile(join(root, "sandbox.sb"), profile, {
      flag: "wx",
      mode: 0o600,
    });
    const config =
      `model = "quorum-fixture-model"\nmodel_provider = "quorum_fixture"\n` +
      `web_search = "disabled"\n[features]\nshell_tool = false\nunified_exec = false\n` +
      `multi_agent = false\ngoals = false\nhooks = false\nplugins = false\nview_image = false\n` +
      `[tools.experimental_request_user_input]\nenabled = false\n` +
      `[model_providers.quorum_fixture]\nname = "Offline fixture"\n` +
      `base_url = "http://127.0.0.1:${provider?.port ?? 9}/v1"\nwire_api = "responses"\n` +
      `requires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\nsupports_websockets = false\n`;
    await writeFile(join(home, "config.toml"), config, {
      flag: "wx",
      mode: 0o600,
    });
    const env = offlineEnvironment(home);
    await durableJson(join(root, "execution-plan.json"), {
      executable,
      executable_digest: binaryDigest,
      config_digest: digest(config),
      sandbox_digest: digest(profile),
      env,
      cwd,
      wrapper: "/usr/bin/sandbox-exec",
      profile: join(root, "sandbox.sb"),
      commands: [
        ["--version"],
        [
          "app-server",
          "generate-json-schema",
          "--experimental",
          "--out",
          join(root, "schemas"),
        ],
        ["app-server"],
      ],
      external_model_attempts: 0,
      fake_provider_port: provider?.port ?? null,
    });
    await syncDirectory(root);
    const capture = (args) =>
      captureProcess({
        executable: "/usr/bin/sandbox-exec",
        args: ["-f", join(root, "sandbox.sb"), executable, ...args],
        cwd,
        env,
        timeoutMs: 10000,
        maxOutputBytes: 1048576,
      });
    stage = "version";
    const version = await capture(["--version"]);
    if (version.failure || version.exitCode !== 0)
      throw new Error("Version discovery failed");
    const matched = /^codex-cli (\d+\.\d+\.\d+)\s*$/.exec(version.stdout);
    if (matched?.[1] !== values["expected-version"])
      throw new Error("Version mismatch");
    const schemas = join(root, "schemas");
    stage = "schemas";
    const generated = await capture([
      "app-server",
      "generate-json-schema",
      "--experimental",
      "--out",
      schemas,
    ]);
    if (generated.failure || generated.exitCode !== 0)
      throw new Error("Schema generation failed");
    const protocolDigests = {};
    for (const name of [
      "v1/InitializeParams.json",
      "v2/ThreadStartParams.json",
      "v2/TurnStartParams.json",
    ])
      protocolDigests[name] = digest(await readFile(join(schemas, name)));
    stage = "protocol";
    const result = await runOfflineProtocol({
      executable: "/usr/bin/sandbox-exec",
      args: ["-f", join(root, "sandbox.sb"), executable, "app-server"],
      cwd,
      env,
      fakeProvider: values["fake-provider"],
      timeoutMs: 10000,
      maxOutputBytes: 1048576,
    });
    const unchanged = binaryDigest === digest(await readFile(executable));
    report = {
      ...report,
      failure: unchanged ? result.failure : "BINARY_CHANGED",
      observed_version: matched[1],
      executable_digest: binaryDigest,
      binary_unchanged: unchanged,
      protocol_digests: protocolDigests,
      config_digest: digest(config),
      sandbox_digest: digest(profile),
      initialized: result.protocol.initialized,
      registered: result.protocol.registered,
      completed: result.protocol.completed,
      notifications: result.protocol.methods,
      usage: result.protocol.usage,
      provider_requests: provider?.observations ?? [],
      rejected_provider_requests: provider?.rejectedRequests() ?? 0,
      exit_code: result.exitCode,
      cleanup: "PROCESS_GROUP_ONLY_UNVERIFIED",
    };
    if (
      provider &&
      (provider.observations.length !== 1 || provider.rejectedRequests() !== 0)
    )
      report.failure ??= "INVALID_PROVIDER_TRAFFIC";
  } catch {
    report = {
      ...report,
      failure: "INFRASTRUCTURE_FAILED",
      failure_stage: stage,
    };
  } finally {
    if (provider) await provider.close();
  }
  const temporary = join(root, "report.json.tmp");
  const checked = offlineReportSchema.parse(report);
  await durableJson(temporary, checked);
  await rename(temporary, join(root, "report.json"));
  await syncDirectory(root);
  process.stdout.write(JSON.stringify(checked) + "\n");
  process.stderr.write(`Offline probe report: ${join(root, "report.json")}\n`);
  process.exitCode = report.failure === null ? 0 : 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? `${error.message}\n`
      : "Offline probe failed; inspect the reserved intent directory. No capability was proven.\n",
  );
  process.exitCode = 1;
}
