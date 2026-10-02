import { parseArgs } from "node:util";
import { mkdtemp, open, realpath, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { probeCodexContainerImage } from "../dist/tests/probes/codex-container-image.js";
import { codexContainerImageReportSchema } from "../dist/tests/probes/codex-container-image-report.js";

function options() {
  const { values } = parseArgs({
    options: {
      "image-id": { type: "string" },
      "runner-path": { type: "string" },
      "expected-version": { type: "string" },
      "report-dir": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(values["image-id"] ?? "") ||
    !/^\/[A-Za-z0-9._/-]+$/u.test(values["runner-path"] ?? "") ||
    !/^\d+\.\d+\.\d+$/u.test(values["expected-version"] ?? "") ||
    (values["report-dir"] && !isAbsolute(values["report-dir"]))
  )
    throw new Error(
      "Usage: npm run probe:codex:container-image -- --image-id sha256:HEX --runner-path /absolute/codex --expected-version VERSION [--report-dir /absolute/existing/directory]",
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
  const root = await mkdtemp(join(base, "quorum-codex-container-image-"));
  await syncDirectory(base);
  await durableJson(join(root, "intent.json"), {
    schema_version: "1.0.0",
    kind: "codex_container_image_probe",
    image_id: values["image-id"],
    runner_path: values["runner-path"],
    expected_version: values["expected-version"],
    pull_allowed: false,
    network_mode: "none",
    model_calls_authorized: false,
  });
  await syncDirectory(root);
  process.stderr.write(`Codex image intent: ${join(root, "intent.json")}\n`);
  const report = await probeCodexContainerImage({
    imageId: values["image-id"],
    runnerPath: values["runner-path"],
    expectedVersion: values["expected-version"],
    cwd: root,
  });
  const checked = codexContainerImageReportSchema.parse(report);
  const temporary = join(root, "report.json.tmp");
  const path = join(root, "report.json");
  await durableJson(temporary, checked);
  await rename(temporary, path);
  await syncDirectory(root);
  process.stdout.write(JSON.stringify(checked) + "\n");
  process.stderr.write(`Codex image report: ${path}\n`);
  process.exitCode = checked.failure === null ? 0 : 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? `${error.message}\n`
      : "Codex image probe failed before its report could be completed.\n",
  );
  process.exitCode = 1;
}
