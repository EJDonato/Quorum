import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(path);
    } else if (/\.(?:ts|mjs)$/.test(path)) {
      const content = await readFile(path, "utf8");
      const lines = content.split("\n").length - Number(content.endsWith("\n"));
      const isTest = path.startsWith("tests/");
      const target = isTest ? 350 : 250;
      const limit = isTest ? 500 : 350;
      if (lines > target)
        process.stderr.write(
          `${path}: ${lines} lines exceeds target ${target}\n`,
        );
      if (lines > limit) process.exitCode = 1;
    }
  }
}

for (const directory of ["src", "tests", "scripts"]) await inspect(directory);
