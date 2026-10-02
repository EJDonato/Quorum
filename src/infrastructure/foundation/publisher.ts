import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type {
  FoundationDocument,
  FoundationPublicationPort,
} from "../../application/foundation-plan.js";
import { failure, type Outcome } from "../../contracts/errors.js";

const targetNames = ["PRD.md", "SYSTEM_DESIGN.md", "PLAN.md"] as const;

interface OwnedFile {
  path: string;
  dev: number;
  ino: number;
}

export function createFoundationPublisher(
  requestedRoot: string,
): FoundationPublicationPort {
  return {
    ensureAvailable: () => ensureTargetsAvailable(requestedRoot),
    publish: (documents) => publishDocuments(requestedRoot, documents),
  };
}

async function ensureTargetsAvailable(rootDir: string): Promise<Outcome<void>> {
  const root = await canonicalRoot(rootDir);
  if (!root.ok) return root;
  for (const name of targetNames) {
    const target = join(root.value, name);
    try {
      await lstat(target);
      return failure(
        "INVALID_INPUT",
        `${name} already exists. Foundation drafting never overwrites project documents.`,
      );
    } catch (error) {
      if (!isMissing(error))
        return failure("STORAGE_FAILED", `Could not inspect ${name}.`);
    }
  }
  return { ok: true, value: undefined };
}

async function publishDocuments(
  rootDir: string,
  documents: readonly FoundationDocument[],
): Promise<Outcome<{ paths: string[]; transactionId: string }>> {
  const validated = validateDocumentSet(documents);
  if (!validated.ok) return validated;
  const available = await ensureTargetsAvailable(rootDir);
  if (!available.ok) return available;
  const root = await canonicalRoot(rootDir);
  if (!root.ok) return root;
  const transactionId = randomUUID();
  const journalDir = join(root.value, ".quorum", "foundation", transactionId);
  const owned: OwnedFile[] = [];
  try {
    await mkdir(journalDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(journalDir, "intent.json"),
      JSON.stringify(
        {
          transactionId,
          targets: validated.value.map((document) => ({
            name: document.name,
            digest: sha256(document.content),
          })),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    for (const document of validated.value) {
      await writeOwnedFile(
        join(root.value, document.name),
        document.content,
        owned,
      );
    }
    const paths = validated.value.map((document) =>
      join(root.value, document.name),
    );
    await writeFile(
      join(journalDir, "receipt.json"),
      JSON.stringify({ transactionId, paths }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return { ok: true, value: { paths, transactionId } };
  } catch {
    await rollbackOwnedFiles(owned);
    return failure(
      "STORAGE_FAILED",
      "Foundation documents could not be published; Quorum attempted to remove only files owned by this transaction. Inspect its private intent before retrying.",
    );
  }
}

async function canonicalRoot(rootDir: string): Promise<Outcome<string>> {
  try {
    const root = await realpath(resolve(rootDir));
    const stats = await lstat(root);
    if (!stats.isDirectory())
      return failure("INVALID_INPUT", "Foundation root is not a directory.");
    return { ok: true, value: root };
  } catch {
    return failure("STORAGE_FAILED", "Foundation root could not be resolved.");
  }
}

function validateDocumentSet(
  documents: readonly FoundationDocument[],
): Outcome<FoundationDocument[]> {
  if (
    documents.length !== targetNames.length ||
    targetNames.some(
      (name) =>
        documents.filter(
          (document) =>
            document.name === name &&
            document.content.length > 0 &&
            document.content.length <= 24_001,
        ).length !== 1,
    )
  )
    return failure("INVALID_INPUT", "Foundation document set is incomplete.");
  const byName = new Map(
    documents.map((document) => [document.name, document]),
  );
  const ordered = targetNames.flatMap((name) => {
    const document = byName.get(name);
    return document ? [document] : [];
  });
  return ordered.length === targetNames.length
    ? { ok: true, value: ordered }
    : failure("INVALID_INPUT", "Foundation document set is incomplete.");
}

async function writeOwnedFile(
  path: string,
  content: string,
  owned: OwnedFile[],
): Promise<void> {
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o644,
  );
  try {
    const stats = await handle.stat();
    owned.push({ path, dev: stats.dev, ino: stats.ino });
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function rollbackOwnedFiles(files: readonly OwnedFile[]): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  for (const file of [...files].reverse()) {
    try {
      const stats = await lstat(file.path);
      if (stats.isFile() && stats.dev === file.dev && stats.ino === file.ino)
        await unlink(file.path);
    } catch {
      // Preserve an uncertain path rather than deleting something we do not own.
    }
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export function displayFoundationPath(rootDir: string, path: string): string {
  const displayed = relative(resolve(rootDir), path);
  return displayed.startsWith("..") ? path : displayed;
}
