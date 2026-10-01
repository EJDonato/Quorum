import { z } from "zod";

export const schemaVersion = z.literal("1.0.0");
export const opaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
export const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const positiveCount = count.min(1);
export const utcTimestamp = z.iso.datetime({ offset: false });
export const artifactReference = z.strictObject({
  artifact_id: opaqueId,
  digest,
});
export const executionStatus = z.enum([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
  "PROTOCOL_ERROR",
]);
export const boundedText = z.string().min(1).max(4096);
export const versionLabel = z.string().min(1).max(128);
export const gitObject = z.discriminatedUnion("format", [
  z.strictObject({
    format: z.literal("sha1"),
    oid: z.string().regex(/^[a-f0-9]{40}$/),
  }),
  z.strictObject({
    format: z.literal("sha256"),
    oid: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);

// Paths are literal repository-relative paths, not shell patterns or grants.
export const repositoryPath = z
  .string()
  .min(1)
  .max(4096)
  .regex(
    /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*[\u0000-\u001f\u007f])(?!(?:.*\/)?\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\/$).+$/,
  );
