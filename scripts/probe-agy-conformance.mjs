import { parseArgs } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { captureProcess } from "../dist/tests/probes/process.js";
import { startAgyFakeProvider } from "../dist/tests/probes/agy-conformance-provider.js";
import { agyConformanceReportSchema } from "../dist/tests/probes/agy-conformance-report.js";
import { agyResultPayloadSchema } from "../dist/tests/probes/agy-offline-protocol.js";
import {
  buildAgyConformanceReport,
  digest,
  durableJson,
  fileExists,
  initialAgyConformanceReport,
  startAgyProbeProxy,
  syncDirectory,
} from "./agy-conformance-support.mjs";

function options() {
  const { values } = parseArgs({
    options: {
      executable: { type: "string" },
      "expected-version": { type: "string" },
      model: { type: "string" },
      "report-dir": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    !isAbsolute(values.executable ?? "") ||
    !/^\d+\.\d+\.\d+$/u.test(values["expected-version"] ?? "") ||
    !/^[a-zA-Z0-9._-]{1,128}$/u.test(values.model ?? "") ||
    (values["report-dir"] && !isAbsolute(values["report-dir"]))
  )
    throw new Error(
      "Usage: npm run probe:agy:conformance -- --executable /absolute/agy --expected-version VERSION --model MODEL [--report-dir /absolute/existing/directory]",
    );
  return values;
}

async function main() {
  const values = options();
  const base = await realpath(values["report-dir"] ?? tmpdir());
  const root = await mkdtemp(join(base, "quorum-agy-conformance-"));
  await syncDirectory(base);
  await durableJson(join(root, "intent.json"), {
    schema_version: "1.0.0",
    kind: "agy_offline_conformance",
    expected_version: values["expected-version"],
    model: values.model,
    external_model_attempts: 0,
    local_request_limit: 4,
    timeout_ms: 30_000,
    enforced_conformance: false,
  });
  await syncDirectory(root);
  process.stderr.write(
    `Offline conformance intent: ${join(root, "intent.json")}\n`,
  );

  let stage = "platform";
  let provider;
  let proxy;
  let report = initialAgyConformanceReport(values["expected-version"]);
  try {
    if (process.platform !== "darwin") throw new Error("Unsupported platform");
    stage = "setup";
    const executable = await realpath(values.executable);
    const executableBytes = await readFile(executable);
    const executableDigest = digest(executableBytes);
    const home = join(root, "home");
    const cwd = join(root, "work");
    await mkdir(join(home, ".gemini", "antigravity-cli"), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(join(cwd, ".agents"), { recursive: true, mode: 0o700 });
    provider = await startAgyFakeProvider({
      sentinel: "AGY_UPSTREAM_FIXTURE_KEY",
      workspace: cwd,
    });
    const proxyHarness = await startAgyProbeProxy({
      root,
      model: values.model,
      upstreamPort: provider.port,
    });
    proxy = proxyHarness.proxy;
    const config = JSON.stringify({
      toolPermission: "always-proceed",
      modelProvider: "gemini",
    });
    const hookCommand =
      `/usr/bin/curl --silent --show-error --fail-with-body --max-time 5 ` +
      `--header 'Content-Type: application/json' --data-binary @- ` +
      `http://127.0.0.1:${provider.port}/hook`;
    const hooks = JSON.stringify({
      "quorum-broker-gate": {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: hookCommand, timeout: 5 }],
          },
        ],
      },
    });
    const profile =
      `(version 1)(allow default)(deny network*)(deny file-write*)` +
      `(deny file-read* (subpath ${JSON.stringify(homedir())}))` +
      `(allow file-read* (literal ${JSON.stringify(executable)}))` +
      `(allow file-read* file-write* (subpath ${JSON.stringify(root)}))` +
      `(allow network-bind (local ip "localhost:*"))` +
      `(allow network-inbound (local ip "localhost:*"))` +
      `(allow network-outbound (remote ip "localhost:${provider.port}"))` +
      `(allow network-outbound (remote ip "localhost:${proxy.port}"))`;
    await writeFile(
      join(home, ".gemini", "antigravity-cli", "settings.json"),
      config,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    await writeFile(join(cwd, ".agents", "hooks.json"), hooks, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(join(root, "sandbox.sb"), profile, {
      flag: "wx",
      mode: 0o600,
    });
    await durableJson(join(root, "execution-plan.json"), {
      executable,
      executable_digest: executableDigest,
      config_digest: digest(config),
      hooks_digest: digest(hooks),
      sandbox_digest: digest(profile),
      cwd,
      model: values.model,
      network: [`127.0.0.1:${proxy.port}`, `127.0.0.1:${provider.port}/hook`],
      credential_mode: "non_secret_runner_sentinel_replaced_by_proxy",
      external_model_attempts: 0,
    });
    await syncDirectory(root);
    const env = {
      HOME: home,
      TMPDIR: home,
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      NO_COLOR: "1",
      GEMINI_API_KEY: "QUORUM_PROXY_SENTINEL",
      GOOGLE_GEMINI_BASE_URL: proxy.url,
    };
    const capture = (args) =>
      captureProcess({
        executable: "/usr/bin/sandbox-exec",
        args: ["-f", join(root, "sandbox.sb"), executable, ...args],
        cwd,
        env,
        timeoutMs: 30_000,
        maxOutputBytes: 1_048_576,
      });
    stage = "version";
    const version = await capture(["--version"]);
    const matched = /^(\d+\.\d+\.\d+)\s*$/u.exec(version.stdout)?.[1];
    if (version.failure || version.exitCode !== 0 || !matched)
      throw new Error("Version discovery failed");
    if (matched !== values["expected-version"]) {
      report.failure = "VERSION_MISMATCH";
      throw new Error("Version mismatch");
    }
    stage = "runner";
    const run = await capture([
      "--sandbox",
      "--mode",
      "accept-edits",
      "--model",
      values.model,
      "--print-timeout",
      "20s",
      "--output-format",
      "json",
      "--print",
      "Reply with QUORUM_OK. Do not use tools.",
    ]);
    let envelope;
    try {
      envelope = agyResultPayloadSchema.safeParse(JSON.parse(run.stdout));
    } catch {
      envelope = { success: false };
    }
    stage = "evidence";
    report = buildAgyConformanceReport({
      report,
      observedVersion: matched,
      executableDigest,
      binaryUnchanged: executableDigest === digest(await readFile(executable)),
      config,
      hooks,
      profile,
      provider,
      run,
      envelope,
      deniedEffectAbsent: !(await fileExists(join(cwd, "QUORUM_TOOL_LEAK"))),
      proxyRequests: proxy.requestsHandled(),
      ledgerEvents: await proxyHarness.ledgerEvents(),
    });
  } catch {
    report.failure_stage = stage;
  } finally {
    if (proxy) await proxy.close();
    if (provider) await provider.close();
  }
  const checked = agyConformanceReportSchema.parse(report);
  const temporary = join(root, "report.json.tmp");
  await durableJson(temporary, checked);
  await rename(temporary, join(root, "report.json"));
  await syncDirectory(root);
  process.stdout.write(JSON.stringify(checked) + "\n");
  process.stderr.write(
    `Offline conformance report: ${join(root, "report.json")}\n`,
  );
  process.exitCode = checked.failure === null ? 0 : 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? `${error.message}\n`
      : "Offline Antigravity conformance failed before report completion.\n",
  );
  process.exitCode = 1;
}
