import type { ModelGatewayOptions } from "../../../application/model-gateway.js";
import type { AgyUpstreamOptions } from "./upstream.js";

interface AgyProxyBaseOptions {
  gateway: ModelGatewayOptions<unknown>;
  model: string;
  outputTokensLimit: number;
  maxRequestBodyBytes?: number;
}

interface AgyFixtureOptions {
  kind: "fixture";
  fixtureResponse(payload: Readonly<Record<string, unknown>>): unknown;
}

export type AgyStreamingProxyOptions = AgyProxyBaseOptions &
  (AgyFixtureOptions | AgyUpstreamOptions);
