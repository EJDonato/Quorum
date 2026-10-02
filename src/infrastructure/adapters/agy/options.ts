import type { ModelGatewayOptions } from "../../../application/model-gateway.js";
import type { AgyUpstreamOptions } from "./upstream.js";

interface AgyProxyBaseOptions {
  gateway: ModelGatewayOptions<unknown>;
  allowedModels: readonly string[];
  sentinelCredential: string;
  outputTokensLimit: number;
  maxRequestBodyBytes?: number;
}

interface AgyFixtureOptions {
  kind: "fixture";
  fixtureResponse(payload: Readonly<Record<string, unknown>>): unknown;
}

export type AgyStreamingProxyOptions = AgyProxyBaseOptions &
  (AgyFixtureOptions | AgyUpstreamOptions);

export function validAgyProxyIdentity(
  options: AgyStreamingProxyOptions,
): boolean {
  return (
    options.allowedModels.length >= 1 &&
    options.allowedModels.length <= 4 &&
    new Set(options.allowedModels).size === options.allowedModels.length &&
    options.allowedModels.every((model) =>
      /^[a-zA-Z0-9._-]{1,128}$/u.test(model),
    ) &&
    options.sentinelCredential.length >= 1 &&
    options.sentinelCredential.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(options.sentinelCredential) &&
    Number.isSafeInteger(options.outputTokensLimit) &&
    options.outputTokensLimit >= 1
  );
}
