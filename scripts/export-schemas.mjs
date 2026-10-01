import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { repositoryConfigSchema } from "../dist/src/contracts/config.js";
import { sessionStateSchema } from "../dist/src/contracts/session.js";
import {
  eventSchema,
  transitionInputSchema,
} from "../dist/src/contracts/events.js";
import { errorSchema } from "../dist/src/contracts/errors.js";

const schemas = {
  RepositoryConfig: repositoryConfigSchema,
  SessionState: sessionStateSchema,
  Event: eventSchema,
  TransitionInput: transitionInputSchema,
  Error: errorSchema,
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
