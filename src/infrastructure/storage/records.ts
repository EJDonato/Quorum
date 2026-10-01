import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { failure, type Outcome } from "../../contracts/errors.js";
import { readArtifact } from "./artifacts.js";

export async function readRecord<T>(options: {
  dir: string;
  name: string;
  schema: z.ZodType<T>;
}): Promise<Outcome<T | null>> {
  try {
    const info = await lstat(join(options.dir, options.name));
    if (!info.isFile())
      return failure(
        "EVIDENCE_INVALID",
        "Transaction record is not a regular file.",
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { ok: true, value: null };
    return failure("STORAGE_FAILED", "Cannot inspect transaction record.");
  }
  const read = await readArtifact({
    baseDir: options.dir,
    relativePath: options.name,
  });
  if (!read.ok) return read;
  try {
    const parsed = options.schema.safeParse(
      JSON.parse(read.value.content.toString("utf8")),
    );
    return parsed.success
      ? { ok: true, value: parsed.data }
      : failure("EVIDENCE_INVALID", "Invalid transaction record.");
  } catch {
    return failure("EVIDENCE_INVALID", "Corrupt transaction JSON.");
  }
}
