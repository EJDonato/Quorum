const DIRECT_ANSWER_PREAMBLE = [
  "This is a lightweight, read-only Quorum conversation.",
  "Answer from the user's prompt and general knowledge when possible.",
  "Do not inspect the repository or use tools unless the user explicitly asks about repository files, source code, Git state, or project-specific behavior.",
  "If repository inspection is necessary, keep it narrowly scoped and read-only.",
].join(" ");

export function buildDirectAnswerPrompt(userPrompt: string): string {
  return `${DIRECT_ANSWER_PREAMBLE}\n\nUser request:\n${userPrompt}`;
}
