import { parseArgs } from "node:util";
import { isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
const { values } = parseArgs({
  options: {
    image: { type: "string" },
    socket: { type: "string" },
    docker: { type: "string", default: "/usr/local/bin/docker" },
  },
  strict: true,
});
if (
  !/^[^\s@]+@sha256:[a-f0-9]{64}$/.test(values.image ?? "") ||
  !isAbsolute(values.socket ?? "") ||
  !isAbsolute(values.docker)
) {
  process.stderr.write(
    "Usage: npm run test:validation:container -- --image REPOSITORY@sha256:HEX --socket /absolute/docker.sock [--docker /absolute/docker]\n",
  );
  process.exitCode = 2;
} else {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "dist/tests/validation-container/live.test.js",
      "dist/tests/validation-container/preparation.test.js",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        QUORUM_VALIDATION_IMAGE: values.image,
        QUORUM_VALIDATION_SOCKET: values.socket,
        QUORUM_VALIDATION_DOCKER: values.docker,
      },
    },
  );
  process.exitCode = result.status ?? 1;
}
