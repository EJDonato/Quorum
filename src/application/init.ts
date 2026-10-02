import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultBudgetLimits,
  repositoryConfigSchema,
  type RepositoryConfig,
} from "../contracts/config.js";
import { failure, type Outcome } from "../contracts/errors.js";
import { CANONICAL_PROMPT_TEMPLATES } from "../prompts/defaults.js";

export const DISCLOSURE_NOTICE =
  "Disclosure: Repository source files within configured path scopes will be transmitted to the configured model provider during agent invocations. Local secret detection and redaction is best-effort and does not guarantee prevention of disclosure. Never place plaintext credentials or secrets in repository files.";

export interface CreateConfigOptions {
  adapter?: "agy" | "codex" | undefined;
  mode?: "enforced" | "advisory" | undefined;
  model?: string | undefined;
  adapterVersion?: string | undefined;
}

export interface InitOptions extends CreateConfigOptions {
  rootDir?: string | undefined;
  writeFileFn?: ((path: string, content: string) => Promise<void>) | undefined;
  readFileFn?: ((path: string) => Promise<string>) | undefined;
  mkdirFn?: ((path: string) => Promise<void>) | undefined;
}

export interface InitResult {
  configPath: string;
  configCreated: boolean;
  agentsDir: string;
  createdPersonas: string[];
  preservedPersonas: string[];
  disclosure: string;
}

export function createDefaultConfig(
  options: CreateConfigOptions = {},
): RepositoryConfig {
  const adapterName = options.adapter ?? "codex";
  const defaultVersion = adapterName === "codex" ? "0.159.3" : "1.2.14";
  const defaultModel =
    adapterName === "codex" ? "gpt-6-sol" : "gemini-3.8-flash-medium";
  const model = options.model ?? defaultModel;
  const version = options.adapterVersion ?? defaultVersion;
  return repositoryConfigSchema.parse({
    schema_version: "1.0.0",
    adapter: {
      name: adapterName,
      version,
      model,
    },
    mode: options.mode ?? "enforced",
    validation_image:
      "quorum-validation@sha256:0000000000000000000000000000000000000000000000000000000000000000",
    commands: [
      { check_id: "test", kind: "test", executable: "npm", args: ["test"] },
      {
        check_id: "typecheck",
        kind: "typecheck",
        executable: "npm",
        args: ["run", "typecheck"],
      },
    ],
    permitted_environment_keys: ["NODE_ENV", "PATH"],
    paths: {
      implementation: ["src"],
      tests: ["tests"],
      protected: ["package.json", "package-lock.json", ".quorum"],
      sensitive: [".env", "secrets"],
    },
    budgets: defaultBudgetLimits,
  });
}

async function pathExists(
  path: string,
  readFn: (path: string) => Promise<string>,
): Promise<boolean> {
  try {
    await readFn(path);
    return true;
  } catch {
    return false;
  }
}

async function initPersonas(
  agentsDir: string,
  writer: (p: string, c: string) => Promise<void>,
  reader: (p: string) => Promise<string>,
): Promise<{ created: string[]; preserved: string[] }> {
  const created: string[] = [];
  const preserved: string[] = [];

  for (const [key, content] of Object.entries(CANONICAL_PROMPT_TEMPLATES)) {
    const templatePath = join(agentsDir, `${key}.md`);
    const exists = await pathExists(templatePath, reader);
    if (exists) {
      preserved.push(key);
    } else {
      await writer(templatePath, `${content}\n`);
      created.push(key);
    }
  }

  return { created, preserved };
}

export async function initRepository(
  options: InitOptions = {},
): Promise<Outcome<InitResult>> {
  const rootDir = options.rootDir ?? process.cwd();
  const quorumDir = join(rootDir, ".quorum");
  const configPath = join(quorumDir, "config.json");
  const agentsDir = join(quorumDir, "agents");

  const writer = options.writeFileFn ?? ((p, c) => writeFile(p, c, "utf8"));
  const reader = options.readFileFn ?? ((p) => readFile(p, "utf8"));
  const makeDir =
    options.mkdirFn ??
    (async (p: string) => {
      await mkdir(p, { recursive: true });
    });

  try {
    await makeDir(agentsDir);
    const configExists = await pathExists(configPath, reader);
    let configCreated = false;

    if (!configExists) {
      const config = createDefaultConfig(options);
      await writer(configPath, `${JSON.stringify(config, null, 2)}\n`);
      configCreated = true;
    }

    const { created, preserved } = await initPersonas(
      agentsDir,
      writer,
      reader,
    );

    return {
      ok: true,
      value: {
        configPath,
        configCreated,
        agentsDir,
        createdPersonas: created,
        preservedPersonas: preserved,
        disclosure: DISCLOSURE_NOTICE,
      },
    };
  } catch (error) {
    return failure(
      "STORAGE_FAILED",
      `Failed to initialize Quorum repository: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
