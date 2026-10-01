import { z } from "zod";
import {
  artifactReference,
  digest,
  gitObject,
  opaqueId,
  schemaVersion,
  utcTimestamp,
} from "./primitives.js";

export const finalizationIntentSchema = z.strictObject({
  schema_version: schemaVersion,
  transaction_id: opaqueId,
  session_id: opaqueId,
  candidate_id: digest,
  tree: gitObject,
  parent: gitObject,
  evidence_refs: z.array(artifactReference).min(1).max(512),
  message: z.string().min(1).max(4096),
  author_name: z.string().min(1).max(256),
  author_email: z.string().min(1).max(256),
  timestamp: utcTimestamp,
});
export type FinalizationIntent = z.infer<typeof finalizationIntentSchema>;

export const finalizationObjectSchema = z.strictObject({
  schema_version: schemaVersion,
  transaction_id: opaqueId,
  commit: gitObject,
  tree: gitObject,
  parent: gitObject,
});
