import { createServer } from "node:http";
import type { Socket } from "node:net";
import { z } from "zod";
import { evaluateAgyToolGate } from "../../src/infrastructure/adapters/agy/tool-gate.js";

const declarationSchema = z.object({
  name: z.string().max(128),
  parametersJsonSchema: z
    .object({
      properties: z.record(z.string(), z.unknown()).optional(),
      required: z.array(z.string()).optional(),
    })
    .optional(),
});

const requestSchema = z.object({
  contents: z.array(z.unknown()),
  generationConfig: z.record(z.string(), z.unknown()),
  systemInstruction: z.unknown(),
  tools: z
    .array(
      z.object({
        functionDeclarations: z.array(declarationSchema).optional(),
      }),
    )
    .optional(),
});

export interface AgyProviderObservation {
  path: string;
  body_keys: string[];
  tool_count: number;
  requested_tool: string | null;
  actual_round: number | null;
  sentinel_credential: boolean;
}

export interface AgyFakeProvider {
  port: number;
  observations: AgyProviderObservation[];
  hookObservation(): AgyHookObservation | null;
  rejectedRequests(): number;
  close(): Promise<void>;
}

export interface AgyHookObservation {
  tool_name: string | null;
  argument_names: string[];
  decision: "allow" | "deny";
}

export async function startAgyFakeProvider(options: {
  sentinel: string;
  workspace: string;
}): Promise<AgyFakeProvider> {
  const observations: AgyProviderObservation[] = [];
  const sockets = new Set<Socket>();
  let rejected = 0;
  let actualRound = 0;
  let hookObservation: AgyHookObservation | null = null;
  const server = createServer((request, response) => {
    void readJson(request, 1_048_576)
      .then((raw) => {
        if (request.url === "/hook") {
          const decision = evaluateAgyToolGate(raw);
          const parsed = z
            .object({
              toolCall: z.object({
                name: z.string(),
                args: z.record(z.string(), z.unknown()),
              }),
            })
            .safeParse(raw);
          hookObservation = {
            tool_name: parsed.success ? parsed.data.toolCall.name : null,
            argument_names: parsed.success
              ? Object.keys(parsed.data.toolCall.args).sort()
              : [],
            decision: decision.decision,
          };
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(decision));
          return;
        }
        const parsed = requestSchema.safeParse(raw);
        const path = request.url ?? "";
        const credential = request.headers["x-goog-api-key"];
        const sentinelCredential = credential === options.sentinel;
        if (
          request.method !== "POST" ||
          !validRoute(path) ||
          !parsed.success ||
          !sentinelCredential ||
          observations.length >= 4
        ) {
          rejected++;
          response.writeHead(400).end();
          return;
        }
        const declarations = parsed.data.tools?.flatMap(
          (tool) => tool.functionDeclarations ?? [],
        );
        const runCommand = declarations?.find(
          (item) => item.name === "run_command",
        );
        const isActual = (declarations?.length ?? 0) > 0;
        if (isActual) actualRound++;
        const requestedTool =
          isActual && actualRound === 1 ? runCommand : undefined;
        observations.push({
          path,
          body_keys: Object.keys(parsed.data).sort(),
          tool_count: declarations?.length ?? 0,
          requested_tool: requestedTool?.name ?? null,
          actual_round: isActual ? actualRound : null,
          sentinel_credential: sentinelCredential,
        });
        sendEvent(
          response,
          requestedTool
            ? toolEvent(options.workspace, requestedTool)
            : textEvent("QUORUM_OK"),
        );
      })
      .catch(() => {
        rejected++;
        if (!response.headersSent) response.writeHead(400).end();
        else response.destroy();
      });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture bind failed");
  return {
    port: address.port,
    observations,
    hookObservation: () => hookObservation,
    rejectedRequests: () => rejected,
    close: () =>
      new Promise<void>((resolve, reject) => {
        sockets.forEach((socket) => socket.destroy());
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function readJson(
  request: AsyncIterable<unknown>,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error("request too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function validRoute(path: string) {
  return /^\/v1beta\/models\/[a-z0-9._-]+:streamGenerateContent\?alt=sse$/u.test(
    path,
  );
}

function toolEvent(
  workspace: string,
  declaration: z.infer<typeof declarationSchema>,
) {
  const schema = declaration.parametersJsonSchema;
  const properties = schema?.properties ?? {};
  const required = schema?.required ?? [];
  const args: Record<string, unknown> = {};
  for (const name of required) {
    const raw = properties[name];
    const type: unknown =
      typeof raw === "object" && raw ? Reflect.get(raw, "type") : null;
    args[name] = fixtureArgument(name, type, workspace);
  }
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ functionCall: { name: declaration.name, args } }],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: usage(10, 3),
  };
}

function fixtureArgument(
  name: string,
  type: unknown,
  workspace: string,
): unknown {
  if (name === "CommandLine") return "touch QUORUM_TOOL_LEAK";
  if (name === "Cwd") return workspace;
  if (name === "toolSummary") return "Leak attempt";
  if (name === "toolAction") return "Attempting leak";
  if (type === "integer" || type === "number") return 1_000;
  if (type === "boolean") return false;
  if (type === "array") return [];
  if (type === "object") return {};
  return "fixture";
}

function textEvent(text: string) {
  return {
    candidates: [
      {
        content: { role: "model", parts: [{ text }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: usage(10, 2),
  };
}

function usage(input: number, output: number) {
  return {
    promptTokenCount: input,
    candidatesTokenCount: output,
    cachedContentTokenCount: 0,
    thoughtsTokenCount: 0,
    totalTokenCount: input + output,
  };
}

function sendEvent(
  response: import("node:http").ServerResponse,
  value: unknown,
) {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.end(`data: ${JSON.stringify(value)}\n\n`);
}
