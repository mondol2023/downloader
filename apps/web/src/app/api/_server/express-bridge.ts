import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Runs a Node `(req, res)` handler (the Express app) for one Fetch `Request` and returns a streaming
 * `Response`. Headers resolve on the first `writeHead`/`write`/`end`; the body streams after that.
 */
export async function runNodeHandler(handler: Handler, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", { value: forwarded || "127.0.0.1" });

  const req = new IncomingMessage(socket);
  req.method = request.method;
  req.url = url.pathname + url.search;
  request.headers.forEach((value, key) => {
    req.headers[key] = value;
    req.rawHeaders.push(key, value);
  });
  if (request.method !== "GET" && request.method !== "HEAD") {
    req.push(Buffer.from(await request.arrayBuffer()));
  }
  req.push(null);

  const res = new ServerResponse(req);
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      req.emit("aborted");
      res.emit("close");
    },
  });

  let resolveResponse!: (r: Response) => void;
  const responded = new Promise<Response>((resolve) => (resolveResponse = resolve));
  let headSent = false;
  let ended = false;

  const sendHead = () => {
    if (headSent) return;
    headSent = true;
    const headers = new Headers();
    for (const [key, value] of Object.entries(res.getHeaders())) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, String(v)));
      else if (value !== undefined) headers.set(key, String(value));
    }
    const status = res.statusCode;
    const noBody = request.method === "HEAD" || status === 204 || status === 304 || status < 200;
    resolveResponse(new Response(noBody ? null : body, { status, headers }));
  };

  const toBytes = (chunk: unknown, encoding?: unknown): Uint8Array =>
    typeof chunk === "string"
      ? Buffer.from(chunk, typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8")
      : (chunk as Uint8Array);

  const callback = (a: unknown, b: unknown) => {
    const fn = typeof a === "function" ? a : b;
    if (typeof fn === "function") fn();
  };

  const closeStream = () => {
    if (ended) return;
    ended = true;
    try {
      controller.close();
    } catch {
      /* already cancelled by the client */
    }
    res.emit("finish");
    res.emit("close");
  };

  Object.defineProperty(res, "headersSent", { get: () => headSent });

  res.writeHead = function (status: number, a?: unknown, b?: unknown) {
    res.statusCode = status;
    const headers = (typeof a === "string" ? b : a) as Record<string, string | string[]> | undefined;
    if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    sendHead();
    return res;
  } as ServerResponse["writeHead"];

  res.flushHeaders = () => {
    res.writeHead(res.statusCode);
  };

  res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
    if (!headSent) res.writeHead(res.statusCode);
    if (!ended && chunk != null) controller.enqueue(toBytes(chunk, encoding));
    callback(encoding, cb);
    return true;
  } as ServerResponse["write"];

  res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (typeof chunk === "function") cb = chunk;
    else if (chunk != null) res.write(chunk as never, encoding as never);
    if (!headSent) res.writeHead(res.statusCode);
    closeStream();
    callback(encoding, cb);
    return res;
  } as ServerResponse["end"];

  handler(req, res);
  return responded;
}
