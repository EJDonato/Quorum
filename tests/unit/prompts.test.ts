import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_PROMPT_TEMPLATES,
  getDefaultPrompt,
  type PromptTemplateName,
} from "../../src/prompts/defaults.js";
import {
  buildSystemPrompt,
  computePersonaDigest,
  loadRolePrompt,
  loadTemplate,
  resolveTemplateKey,
  type RolePhaseInput,
} from "../../src/prompts/loader.js";

const allTemplates: PromptTemplateName[] = [
  "preamble",
  "planner",
  "architect",
  "security",
  "qa-author",
  "developer",
  "qa-review",
  "refactor",
];

await test("canonical templates exist and are non-empty strings", () => {
  for (const name of allTemplates) {
    const prompt = getDefaultPrompt(name);
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 20);
    assert.equal(prompt, CANONICAL_PROMPT_TEMPLATES[name]);
  }
});

await test("resolveTemplateKey maps all role and phase combinations correctly", () => {
  assert.equal(
    resolveTemplateKey({ role: "planner", phase: "planning" }),
    "planner",
  );
  assert.equal(
    resolveTemplateKey({ role: "architect", phase: "architecture" }),
    "architect",
  );
  assert.equal(
    resolveTemplateKey({ role: "security", phase: "design" }),
    "security",
  );
  assert.equal(
    resolveTemplateKey({ role: "security", phase: "final" }),
    "security",
  );
  assert.equal(
    resolveTemplateKey({ role: "developer", phase: "implementation" }),
    "developer",
  );
  assert.equal(
    resolveTemplateKey({ role: "refactor", phase: "implementation" }),
    "refactor",
  );
  assert.equal(
    resolveTemplateKey({ role: "qa", phase: "test_authoring" }),
    "qa-author",
  );
  assert.equal(resolveTemplateKey({ role: "qa", phase: "final" }), "qa-review");

  assert.throws(
    () =>
      resolveTemplateKey({
        role: "unknown" as unknown as RolePhaseInput["role"],
        phase: "planning",
      }),
    /Unknown role\/phase combination/,
  );
});

await test("loadRolePrompt and loadTemplate fall back to defaults or read custom", async () => {
  const defaultPlanner = await loadRolePrompt({
    role: "planner",
    phase: "planning",
  });
  assert.equal(defaultPlanner, CANONICAL_PROMPT_TEMPLATES.planner);

  const customReadFile = (path: string): Promise<string> => {
    if (path.endsWith("planner.md")) {
      return Promise.resolve("Custom Planner Content");
    }
    return Promise.reject(new Error("File not found"));
  };

  const customPlanner = await loadRolePrompt(
    { role: "planner", phase: "planning" },
    { customDir: "/custom/dir", readFileFn: customReadFile },
  );
  assert.equal(customPlanner, "Custom Planner Content");

  const fallbackDeveloper = await loadRolePrompt(
    { role: "developer", phase: "implementation" },
    { customDir: "/custom/dir", readFileFn: customReadFile },
  );
  assert.equal(fallbackDeveloper, CANONICAL_PROMPT_TEMPLATES.developer);

  const fallbackPreamble = await loadTemplate("preamble", {
    customDir: "/custom/dir",
    readFileFn: customReadFile,
  });
  assert.equal(fallbackPreamble, CANONICAL_PROMPT_TEMPLATES.preamble);
});

await test("buildSystemPrompt formats preamble, role instructions, and structured context", async () => {
  const prompt = await buildSystemPrompt(
    { role: "developer", phase: "implementation" },
    {
      taskId: "task-001",
      responseSchemaRef: "schema:impl-v1",
      grants: {
        tools: ["repo.read", "draft.apply_patch"],
        readPaths: ["src", "tests"],
        writePaths: ["src"],
      },
      instructions: "Implement feature X without breaking tests.",
    },
  );

  assert.ok(prompt.includes(CANONICAL_PROMPT_TEMPLATES.preamble));
  assert.ok(prompt.includes(CANONICAL_PROMPT_TEMPLATES.developer));
  assert.ok(prompt.includes("Assigned Task: task-001"));
  assert.ok(prompt.includes("Response Schema: schema:impl-v1"));
  assert.ok(prompt.includes("Granted Tools: repo.read, draft.apply_patch"));
  assert.ok(prompt.includes("Readable Paths: src, tests"));
  assert.ok(prompt.includes("Writable Paths: src"));
  assert.ok(
    prompt.includes(
      "Instructions:\nImplement feature X without breaking tests.",
    ),
  );
});

await test("computePersonaDigest generates deterministic hash", () => {
  const digest1 = computePersonaDigest();
  const digest2 = computePersonaDigest();
  assert.equal(digest1.ok, true);
  assert.equal(digest2.ok, true);
  if (digest1.ok && digest2.ok) {
    assert.ok(digest1.value.startsWith("sha256:"));
    assert.equal(digest1.value, digest2.value);
  }

  const modified = {
    ...CANONICAL_PROMPT_TEMPLATES,
    developer: "Custom instructions",
  };
  const digestMod = computePersonaDigest(modified);
  assert.equal(digestMod.ok, true);
  if (digest1.ok && digestMod.ok) {
    assert.notEqual(digest1.value, digestMod.value);
  }
});
