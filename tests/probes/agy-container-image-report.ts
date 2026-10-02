import { z } from "zod";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const agyContainerImageReportSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  kind: z.literal("agy_container_image_probe"),
  image_id: digest,
  runner_path: z.string().regex(/^\/[A-Za-z0-9._/-]+$/u),
  expected_version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  observed_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/u)
    .nullable(),
  docker_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/u)
    .nullable(),
  image_present: z.boolean(),
  linux_image: z.boolean(),
  no_declared_volumes: z.boolean(),
  container_created: z.boolean(),
  container_configuration_verified: z.boolean(),
  executable_digest: digest.nullable(),
  version_command_passed: z.boolean(),
  cleanup_confirmed: z.boolean(),
  failure: z
    .enum([
      "DOCKER_UNAVAILABLE",
      "IMAGE_MISSING",
      "IMAGE_POLICY_FAILED",
      "CREATE_FAILED",
      "CONTAINER_POLICY_FAILED",
      "BINARY_COPY_FAILED",
      "VERSION_FAILED",
      "VERSION_MISMATCH",
      "CLEANUP_FAILED",
    ])
    .nullable(),
  final_container_conformance: z.literal(false),
  mandatory_capabilities: z.literal("PARTIAL"),
});

export type AgyContainerImageReport = z.infer<
  typeof agyContainerImageReportSchema
>;
