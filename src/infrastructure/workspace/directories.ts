import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inspectPath } from "./scoped-read.js";

// Create one level at a time, rejecting existing links before descending.
// This operates only in host-owned storage; concurrent untrusted writers are unsupported.
export async function ensurePrivateDirectory(
  root: string,
  relativePath: string,
): Promise<void> {
  await inspectPath(root, ".");
  let current = "";
  for (const component of relativePath.split("/")) {
    if (!component || component === "." || component === "..")
      throw new Error("Invalid path");
    current = current ? `${current}/${component}` : component;
    try {
      await mkdir(join(root, current), { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (!(await inspectPath(root, current)).isDirectory())
      throw new Error("Not an owned directory");
  }
}
