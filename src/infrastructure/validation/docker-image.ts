import { failure } from "../../contracts/errors.js";
import type { DockerCommand } from "./docker.js";
import { imageInspectionSchema } from "./docker-profile.js";
export async function inspectImage(docker: DockerCommand, image: string) {
  const os = await docker(["info", "--format", "{{.OSType}}"]);
  if (!os.ok || os.value.exitCode !== 0 || os.value.stdout.trim() !== "linux")
    return failure(
      "CAPABILITY_MISSING",
      "A local Linux Docker daemon is required.",
    );
  const result = await docker([
    "image",
    "inspect",
    "--format",
    "{{json .}}",
    image,
  ]);
  if (!result.ok || result.value.exitCode !== 0)
    return failure(
      "CAPABILITY_MISSING",
      "Pinned validation image is unavailable; no image was pulled.",
    );
  let raw: unknown;
  try {
    raw = JSON.parse(result.value.stdout);
  } catch {
    raw = null;
  }
  const parsed = imageInspectionSchema.safeParse(raw);
  if (
    !parsed.success ||
    !parsed.data.RepoDigests.includes(image) ||
    Object.keys(parsed.data.Config.Volumes ?? {}).length
  )
    return failure(
      "CAPABILITY_MISSING",
      "Image identity or implicit writable volumes are unsupported.",
    );
  const environment: Record<string, string> = {};
  for (const item of parsed.data.Config.Env ?? []) {
    const key = item.split("=")[0];
    if (!key || !/^[A-Z_][A-Z0-9_]*$/.test(key))
      return failure(
        "CAPABILITY_MISSING",
        "Image environment cannot be safely cleared.",
      );
    environment[key] = "";
  }
  return {
    ok: true as const,
    value: {
      imageId: parsed.data.Id,
      environment: {
        ...environment,
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: "/tmp",
        TMPDIR: "/tmp",
      },
    },
  };
}
