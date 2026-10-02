import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { z } from "zod";

const toolSchema = z.object({
  type: z.string().max(128),
  name: z.string().max(128).optional(),
  tools: z
    .array(z.object({ type: z.string().max(128), name: z.string().max(128) }))
    .max(128)
    .optional(),
});
const requestSchema = z.object({
  model: z.literal("quorum-fixture-model"),
  stream: z.literal(true),
  tools: z.array(toolSchema).max(128),
  max_output_tokens: z.number().int().positive().optional(),
});

export function inspectFixtureRequest(value: unknown) {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    tools: parsed.data.tools.flatMap((tool) =>
      tool.tools
        ? tool.tools.map((entry) => `${tool.name ?? tool.type}.${entry.name}`)
        : [tool.name ?? tool.type],
    ),
    max_output_tokens: parsed.data.max_output_tokens ?? null,
    // No documented total input+output ceiling is established by this request.
    hard_total_ceiling_verified: false as const,
  };
}

export function fixtureResponseEvents() {
  const item = {
    id: "msg_quorum_fixture",
    type: "message",
    status: "completed",
    role: "assistant",
    content: [
      { type: "output_text", text: "QUORUM_FIXTURE_OK", annotations: [] },
    ],
  };
  const response = {
    id: "resp_quorum_fixture",
    object: "response",
    status: "completed",
    output: [item],
    usage: {
      input_tokens: 10,
      output_tokens: 3,
      total_tokens: 13,
      input_tokens_details: { cached_tokens: 2 },
      output_tokens_details: { reasoning_tokens: 1 },
    },
  };
  const events = [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    },
    {
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: "QUORUM_FIXTURE_OK",
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ];
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

// A fixture server, never a proxy: this module has no upstream HTTP client or credentials.
export async function startFakeProvider() {
  const observations: NonNullable<ReturnType<typeof inspectFixtureRequest>>[] =
    [];
  let rejectedRequests = 0;
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.destroy();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (
      request.method !== "POST" ||
      request.url !== "/v1/responses" ||
      observations.length >= 1
    ) {
      rejectedRequests++;
      response.writeHead(403).end();
      return;
    }
    const buffers: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk));
      bytes += buffer.length;
      if (bytes > 1_048_576) {
        rejectedRequests++;
        response.writeHead(413).end();
        return;
      }
      buffers.push(buffer);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(buffers).toString("utf8"));
    } catch {
      rejectedRequests++;
      response.writeHead(400).end();
      return;
    }
    const observation = inspectFixtureRequest(value);
    if (!observation || observations.length >= 1) {
      rejectedRequests++;
      response.writeHead(400).end();
      return;
    }
    observations.push(observation);
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "close",
    });
    response.end(fixtureResponseEvents());
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture bind failed");
  return {
    port: address.port,
    observations,
    rejectedRequests: () => rejectedRequests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        sockets.forEach((socket) => socket.destroy());
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
