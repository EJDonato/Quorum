import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateMotion } from "../../src/domain/plans.js";

const scope = {
  sessionId: "session",
  permittedPaths: ["src", "tests"],
  protectedPaths: ["tests/protected"],
};
function motion() {
  return {
    schema_version: "1.0.0",
    session_id: "session",
    risk: "standard",
    fuzz_required: false,
    tasks: [
      {
        task_id: "b",
        dependencies: ["a"],
        authorized_paths: ["src/b.ts"],
        criterion_ids: ["cb"],
      },
      {
        task_id: "a",
        dependencies: [],
        authorized_paths: ["src/a.ts"],
        criterion_ids: ["ca"],
      },
    ],
    acceptance_criteria: [
      { criterion_id: "ca", description: "A works", owner_task_id: "a" },
      { criterion_id: "cb", description: "B works", owner_task_id: "b" },
    ],
  };
}
await test("task ordering is deterministic and dependency respecting", () => {
  const value = motion();
  for (const tasks of [value.tasks, [...value.tasks].reverse()]) {
    const result = validateMotion({ ...value, tasks }, scope);
    assert.ok(result.ok);
    assert.deepEqual(result.value.taskOrder, ["a", "b"]);
  }
});
await test("cycles, unresolved dependencies, duplicates, and foreign criterion owners fail", () => {
  const variations = [
    (value: ReturnType<typeof motion>) => {
      value.tasks[1]?.dependencies.push("b");
    },
    (value: ReturnType<typeof motion>) => {
      value.tasks[0]?.dependencies.push("missing");
    },
    (value: ReturnType<typeof motion>) => {
      const first = value.tasks[0];
      assert.ok(first);
      value.tasks.push(first);
    },
    (value: ReturnType<typeof motion>) => {
      value.tasks[0]?.criterion_ids.push("ca");
    },
    (value: ReturnType<typeof motion>) => {
      value.acceptance_criteria.push({
        criterion_id: "orphan",
        description: "Unowned",
        owner_task_id: "a",
      });
    },
  ];
  for (const mutate of variations) {
    const value = motion();
    mutate(value);
    assert.equal(validateMotion(value, scope).ok, false);
  }
});
await test("literal path policy rejects sibling prefixes, traversal, metadata and protected ancestors", () => {
  for (const path of [
    "src-other/file",
    "src/../file",
    "src/.Git/config",
    "tests",
    "tests/protected/file",
    "/src/file",
  ]) {
    const value = motion();
    const task = value.tasks[0];
    assert.ok(task);
    task.authorized_paths = [path];
    assert.equal(validateMotion(value, scope).ok, false, path);
  }
  assert.equal(
    validateMotion({ ...motion(), session_id: "foreign" }, scope).ok,
    false,
  );
});
