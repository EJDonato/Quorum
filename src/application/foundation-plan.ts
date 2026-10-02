import { failure, type Outcome } from "../contracts/errors.js";
import {
  buildFoundationPrompt,
  type FoundationStage,
} from "../prompts/foundation.js";

export type FoundationDocumentName = "PRD.md" | "SYSTEM_DESIGN.md" | "PLAN.md";

export interface FoundationDocument {
  name: FoundationDocumentName;
  content: string;
}

export interface FoundationPublication {
  paths: string[];
  transactionId: string;
}

export interface FoundationPublicationPort {
  ensureAvailable(): Promise<Outcome<void>>;
  publish(
    documents: readonly FoundationDocument[],
  ): Promise<Outcome<FoundationPublication>>;
}

export type FoundationDraftPort = (
  stage: FoundationStage,
  prompt: string,
) => Promise<Outcome<string>>;

export interface FoundationPlanOptions {
  requirements: string;
  draft: FoundationDraftPort;
  publication: FoundationPublicationPort;
}

const stages: readonly FoundationStage[] = [
  "product",
  "architecture",
  "delivery",
];

const stageDocuments: Readonly<
  Record<FoundationStage, FoundationDocumentName>
> = {
  product: "PRD.md",
  architecture: "SYSTEM_DESIGN.md",
  delivery: "PLAN.md",
};

const requiredHeadings: Readonly<Record<FoundationStage, RegExp>> = {
  product: /^#\s+.*product requirements/i,
  architecture: /^#\s+.*system design/i,
  delivery: /^#\s+.*implementation plan/i,
};

export async function createFoundationPlan(
  options: FoundationPlanOptions,
): Promise<Outcome<FoundationPublication>> {
  const requirements = options.requirements.trim();
  if (!requirements || requirements.length > 8_192)
    return failure(
      "INVALID_INPUT",
      "Foundation requirements must contain between 1 and 8,192 characters.",
    );

  const available = await options.publication.ensureAvailable();
  if (!available.ok) return available;

  const documents: FoundationDocument[] = [];
  for (const stage of stages) {
    const prompt = buildFoundationPrompt(stage, requirements, documents);
    const response = await options.draft(stage, prompt);
    if (!response.ok) return response;
    const parsed = parseFoundationDocument(stage, response.value);
    if (!parsed.ok) return parsed;
    documents.push({ name: stageDocuments[stage], content: parsed.value });
  }
  return options.publication.publish(documents);
}

export function parseFoundationDocument(
  stage: FoundationStage,
  response: string,
): Outcome<string> {
  const trimmed = response.trim();
  const match = /^<quorum_document>\s*([\s\S]*?)\s*<\/quorum_document>$/u.exec(
    trimmed,
  );
  const content = match?.[1]?.trim();
  if (!content || content.length > 24_000)
    return failure(
      "EVIDENCE_INVALID",
      `${stageDocuments[stage]} draft was missing its required document wrapper or exceeded 24,000 characters.`,
    );
  if (!requiredHeadings[stage].test(content))
    return failure(
      "EVIDENCE_INVALID",
      `${stageDocuments[stage]} draft did not contain the required top-level heading.`,
    );
  return { ok: true, value: `${content}\n` };
}
