import { z } from "zod";
import {
  artifactReference,
  digest,
  gitObject,
  opaqueId,
  schemaVersion,
} from "./primitives.js";

export const commitReceiptSchema = z
  .strictObject({
    schema_version: schemaVersion,
    transaction_id: opaqueId,
    session_id: opaqueId,
    candidate_id: digest,
    commit: gitObject,
    tree: gitObject,
    parent: gitObject,
    evidence_refs: z.array(artifactReference).min(1).max(512),
  })
  .superRefine((receipt, context) => {
    if (
      receipt.commit.format !== receipt.tree.format ||
      receipt.commit.format !== receipt.parent.format
    ) {
      context.addIssue({
        code: "custom",
        message: "Receipt Git object formats differ",
      });
    }
  });

export type CommitReceipt = z.infer<typeof commitReceiptSchema>;
