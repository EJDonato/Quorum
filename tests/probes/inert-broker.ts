import { z } from "zod";

const inertRequestSchema = z.strictObject({
  tool: z.literal("repo.read"),
  path: z.literal("fixture.txt"),
});

// Synthetic broker fixture only. It cannot establish runner tool isolation.
export function inertBrokerCall(raw: unknown): "QUORUM_FIXTURE" | "DENIED" {
  return inertRequestSchema.safeParse(raw).success
    ? "QUORUM_FIXTURE"
    : "DENIED";
}
