import { motionSchema, type Motion } from "../contracts/motion.js";
import { failure, type Outcome } from "../contracts/errors.js";
import { repositoryPath } from "../contracts/primitives.js";

export function pathWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function referencesValid(motion: Motion): boolean {
  const tasks = new Map(motion.tasks.map((task) => [task.task_id, task]));
  const criteria = new Map(
    motion.acceptance_criteria.map((criterion) => [
      criterion.criterion_id,
      criterion,
    ]),
  );
  if (
    tasks.size !== motion.tasks.length ||
    criteria.size !== motion.acceptance_criteria.length
  )
    return false;
  for (const task of motion.tasks) {
    if (
      new Set(task.dependencies).size !== task.dependencies.length ||
      new Set(task.criterion_ids).size !== task.criterion_ids.length
    )
      return false;
    if (task.dependencies.some((id) => id === task.task_id || !tasks.has(id)))
      return false;
    if (
      task.criterion_ids.some(
        (id) => criteria.get(id)?.owner_task_id !== task.task_id,
      )
    )
      return false;
  }
  return motion.acceptance_criteria.every((criterion) =>
    tasks
      .get(criterion.owner_task_id)
      ?.criterion_ids.includes(criterion.criterion_id),
  );
}

function orderedTasks(motion: Motion): Outcome<string[]> {
  const pending = new Map(motion.tasks.map((task) => [task.task_id, task]));
  const complete = new Set<string>();
  const ordered: string[] = [];
  while (pending.size > 0) {
    const next = [...pending.values()]
      .filter((task) => task.dependencies.every((id) => complete.has(id)))
      .map((task) => task.task_id)
      .sort()[0];
    if (next === undefined)
      return failure("INVALID_INPUT", "Task dependencies contain a cycle.");
    pending.delete(next);
    complete.add(next);
    ordered.push(next);
  }
  return { ok: true, value: ordered };
}

export function validateMotion(
  raw: unknown,
  scope: {
    sessionId: string;
    permittedPaths: string[];
    protectedPaths: string[];
  },
): Outcome<{ motion: Motion; taskOrder: string[] }> {
  const parsed = motionSchema.safeParse(raw);
  if (!parsed.success || parsed.data.session_id !== scope.sessionId)
    return failure(
      "INVALID_INPUT",
      "Malformed motion or foreign session identity.",
    );
  if (
    ![...scope.permittedPaths, ...scope.protectedPaths].every(
      (path) => repositoryPath.safeParse(path).success,
    )
  )
    return failure("INVALID_INPUT", "Invalid host path policy.");
  if (!referencesValid(parsed.data))
    return failure(
      "INVALID_INPUT",
      "Task or acceptance references are duplicated, unresolved, or lack a unique owner.",
    );
  const protectedPaths = [...scope.protectedPaths, ".git", ".quorum"];
  const paths = parsed.data.tasks.flatMap((task) => task.authorized_paths);
  const denied = paths.some(
    (path) =>
      !scope.permittedPaths.some((root) => pathWithin(path, root)) ||
      path
        .split("/")
        .some((part) => [".git", ".quorum"].includes(part.toLowerCase())) ||
      protectedPaths.some(
        (root) => pathWithin(path, root) || pathWithin(root, path),
      ),
  );
  if (denied)
    return failure(
      "SCOPE_DENIED",
      "Plan scope escapes permitted paths or overlaps protected paths.",
    );
  const order = orderedTasks(parsed.data);
  if (!order.ok) return order;
  return { ok: true, value: { motion: parsed.data, taskOrder: order.value } };
}
