import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { repositoryConfigSchema } from "../dist/src/contracts/config.js";
import { sessionStateSchema } from "../dist/src/contracts/session.js";
import {
  eventSchema,
  transitionInputSchema,
} from "../dist/src/contracts/events.js";
import { errorSchema } from "../dist/src/contracts/errors.js";
import { motionSchema } from "../dist/src/contracts/motion.js";
import { candidateManifestSchema } from "../dist/src/contracts/candidate.js";
import {
  invocationRequestSchema,
  invocationResultSchema,
} from "../dist/src/contracts/invocation.js";
import { checkResultSchema } from "../dist/src/contracts/checks.js";
import {
  reviewBodySchema,
  reviewResultSchema,
} from "../dist/src/contracts/reviews.js";
import { ballotSchema } from "../dist/src/contracts/ballot.js";
import { ballotRequirementsSchema } from "../dist/src/contracts/ballot-input.js";
import { commitReceiptSchema } from "../dist/src/contracts/receipt.js";

const schemas = {
  RepositoryConfig: repositoryConfigSchema,
  SessionState: sessionStateSchema,
  Event: eventSchema,
  TransitionInput: transitionInputSchema,
  Error: errorSchema,
  Motion: motionSchema,
  CandidateManifest: candidateManifestSchema,
  InvocationRequest: invocationRequestSchema,
  InvocationResult: invocationResultSchema,
  CheckResult: checkResultSchema,
  ReviewBody: reviewBodySchema,
  ReviewResult: reviewResultSchema,
  Ballot: ballotSchema,
  BallotRequirements: ballotRequirementsSchema,
  CommitReceipt: commitReceiptSchema,
};
const check = process.argv.includes("--check");
if (!check) await mkdir("schemas", { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const content = `${JSON.stringify(z.toJSONSchema(schema, { target: "draft-2020-12" }), null, 2)}\n`;
  const path = `schemas/${name}.json`;
  if (check) {
    if ((await readFile(path, "utf8")) !== content)
      throw new Error(`Stale schema: ${path}`);
  } else await writeFile(path, content);
}
