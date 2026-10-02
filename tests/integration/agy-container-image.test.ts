import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { probeAgyContainerImage } from "../probes/agy-container-image.js";
import { agyContainerImageReportSchema } from "../probes/agy-container-image-report.js";
import type { Capture } from "../probes/process.js";

const imageId = `sha256:${"a".repeat(64)}`;
const containerId = "b".repeat(64);

async function harness(
  t: TestContext,
  options: { volume?: boolean; createFailure?: boolean } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), "agy-image-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  let present = false;
  const success = (stdout = "", exitCode = 0, stderr = ""): Capture => ({
    stdout,
    stderr,
    exitCode,
    interrupted: false,
    failure: null,
  });
  const process = async (args: string[]): Promise<Capture> => {
    if (args[0] === "info") return success("29.6.2\n");
    if (args[0] === "image")
      return success(
        JSON.stringify({
          Id: imageId,
          Os: "linux",
          Config: {
            Env: ["PATH=/image", "LANG=C"],
            Volumes: options.volume ? { "/data": {} } : null,
          },
        }),
      );
    if (args[0] === "create") {
      present = true;
      return options.createFailure
        ? success("", 1, "injected ambiguous create")
        : success(containerId);
    }
    if (args[0] === "inspect" && args[2] === "{{json .}}")
      return success(JSON.stringify(containerInspection(args)));
    if (args[0] === "inspect" && args[2]?.includes("quorum.fixture"))
      return success(args[3] ?? "");
    if (args[0] === "inspect")
      return present
        ? success(JSON.stringify(containerInspection(args)))
        : success("", 1, "Error: No such object: fixture\n");
    if (args[0] === "cp") {
      await writeFile(args[2] ?? "", "linux-agy-fixture");
      return success();
    }
    if (args[0] === "start") return success("1.2.14\n");
    if (args[0] === "rm") {
      present = false;
      return success();
    }
    return success("", 1, "unsupported");
  };
  return { cwd, process };
}

function containerInspection(args: string[]) {
  const id =
    args.find((value) => value.startsWith("quorum-agy-image-")) ?? "fixture";
  return {
    Id: containerId,
    Image: imageId,
    Config: {
      User: "65534:65534",
      Labels: { "quorum.fixture": id },
      Env: [
        "HOME=/home/quorum",
        "LANG=",
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "TMPDIR=/tmp",
      ],
      WorkingDir: "/workspace",
      Entrypoint: ["/usr/local/bin/agy"],
      Cmd: ["--version"],
    },
    HostConfig: {
      NetworkMode: "none",
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ["ALL"],
      CapAdd: null,
      Init: true,
      SecurityOpt: ["no-new-privileges"],
      IpcMode: "none",
      CgroupnsMode: "private",
      NanoCpus: 1_000_000_000,
      Memory: 268_435_456,
      MemorySwap: 268_435_456,
      PidsLimit: 32,
      Tmpfs: {
        "/tmp": "fixture",
        "/home/quorum": "fixture",
        "/workspace": "fixture",
      },
      LogConfig: { Type: "none" },
    },
    Mounts: [],
  };
}

void test("runner image probe verifies identity, isolation, binary and version", async (t) => {
  const h = await harness(t);
  const report = await probeAgyContainerImage({
    imageId,
    runnerPath: "/usr/local/bin/agy",
    expectedVersion: "1.2.14",
    cwd: h.cwd,
    process: (args) => h.process(args),
  });
  assert.equal(report.failure, null);
  assert.equal(report.container_configuration_verified, true);
  assert.equal(report.version_command_passed, true);
  assert.equal(report.cleanup_confirmed, true);
  assert.match(report.executable_digest ?? "", /^sha256:[a-f0-9]{64}$/u);
  assert.equal(agyContainerImageReportSchema.safeParse(report).success, true);
});

void test("runner image probe blocks implicit writable volumes before launch", async (t) => {
  const h = await harness(t, { volume: true });
  const report = await probeAgyContainerImage({
    imageId,
    runnerPath: "/usr/local/bin/agy",
    expectedVersion: "1.2.14",
    cwd: h.cwd,
    process: (args) => h.process(args),
  });
  assert.equal(report.failure, "IMAGE_POLICY_FAILED");
  assert.equal(report.container_created, false);
  assert.equal(report.cleanup_confirmed, true);
});

void test("runner image probe reconciles an ambiguous create failure", async (t) => {
  const h = await harness(t, { createFailure: true });
  const report = await probeAgyContainerImage({
    imageId,
    runnerPath: "/usr/local/bin/agy",
    expectedVersion: "1.2.14",
    cwd: h.cwd,
    process: (args) => h.process(args),
  });
  assert.equal(report.failure, "CREATE_FAILED");
  assert.equal(report.container_created, false);
  assert.equal(report.cleanup_confirmed, true);
});
