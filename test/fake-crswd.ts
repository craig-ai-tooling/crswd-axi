// A crswd that checks signatures the way the real one does.
//
// The point of verifying rather than accepting: a test against a server that
// takes any signature proves the client SENDS something, not that it sends
// something crswd would accept. This one recomputes the canonical string from
// the request it actually received, so a client that signs the decoded path,
// or leaves the method out, fails here for the same reason it would fail in
// production.

import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

export interface Reply {
  status: number;
  body: unknown;
}

export interface Received {
  method: string;
  url: string;
  timestamp: string;
  signature: string;
  bearer?: string;
  body: string;
  signatureValid: boolean;
}

export interface FakeCrswd {
  url: string;
  secret: string;
  received: Received[];
  /** Replies are taken in order; the last one repeats once the queue empties. */
  queue: Reply[];
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export async function startFakeCrswd(secret = "test-secret"): Promise<FakeCrswd> {
  const received: Received[] = [];
  const queue: Reply[] = [];

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readBody(req);
    const timestamp = String(req.headers["x-crsw-timestamp"] ?? "");
    const signature = String(req.headers["x-crsw-signature"] ?? "");
    const path = (req.url ?? "").split("?")[0] ?? "";
    const expected =
      "sha256=" +
      createHmac("sha256", secret)
        .update(`${req.method}\n${path}\n${timestamp}.${body}`)
        .digest("hex");

    const auth = req.headers["authorization"];
    received.push({
      method: req.method ?? "",
      url: req.url ?? "",
      timestamp,
      signature,
      bearer: typeof auth === "string" ? auth.replace(/^Bearer /, "") : undefined,
      body,
      signatureValid: signature === expected,
    });

    const reply = queue.length > 1 ? queue.shift()! : (queue[0] ?? { status: 200, body: {} });
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  };

  const server: Server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    secret,
    received,
    queue,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
