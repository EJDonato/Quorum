import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { failure, type Outcome } from "../contracts/errors.js";

const maximumBytes = 65_536;

function parseConfiguration(buffer: Buffer): Outcome<unknown> {
  try {
    const value: unknown = JSON.parse(buffer.toString("utf8"));
    return { ok: true, value };
  } catch (error) {
    if (error instanceof SyntaxError)
      return failure("INVALID_INPUT", "Configuration is not valid JSON.");
    throw error;
  }
}

async function readBounded(handle: FileHandle): Promise<Outcome<unknown>> {
  const before = await handle.stat();
  if (!before.isFile() || before.size > maximumBytes)
    return failure(
      "INVALID_INPUT",
      "Configuration must be a regular file of at most 64 KiB.",
    );
  const buffer = Buffer.alloc(maximumBytes + 1);
  let length = 0;
  while (length < buffer.length) {
    const result = await handle.read(
      buffer,
      length,
      buffer.length - length,
      null,
    );
    if (result.bytesRead === 0) break;
    length += result.bytesRead;
  }
  if (length > maximumBytes)
    return failure("INVALID_INPUT", "Configuration exceeds 64 KiB.");
  const after = await handle.stat();
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    return failure(
      "STALE_INPUT",
      "Configuration changed while reading; retry with stable input.",
    );
  }
  return parseConfiguration(buffer.subarray(0, length));
}

export async function readConfiguration(
  path: string,
): Promise<Outcome<unknown>> {
  try {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      return await readBounded(handle);
    } finally {
      await handle.close();
    }
  } catch {
    // Raw filesystem errors can contain paths or input; keep diagnostics bounded.
    return failure(
      "STORAGE_FAILED",
      "Cannot read configuration; provide a readable regular file without a leaf symlink.",
    );
  }
}
