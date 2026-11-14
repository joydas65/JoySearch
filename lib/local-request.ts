export class RequestPolicyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.name = "RequestPolicyError"; this.status = status; }
}

/** This pilot's file ledger is local-only; serverless deployment needs shared atomic quotas. */
export function assertLocalRequest(request: Request, environment = process.env): URL {
  if (environment.NODE_ENV === "production" || environment.VERCEL) throw new RequestPolicyError("Live requests are not enabled on this deployment.", 503);
  const url = new URL(request.url);
  const allowed = ["localhost", "127.0.0.1", "[::1]"];
  if (!allowed.includes(url.hostname)) throw new RequestPolicyError("Live requests are available only in the local evaluation.", 403);
  let external: URL;
  try { external = new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`); }
  catch { throw new RequestPolicyError("This request is not allowed.", 403); }
  const origin = request.headers.get("origin");
  if (!allowed.includes(external.hostname) || external.username || external.password || (origin && origin !== external.origin)) {
    throw new RequestPolicyError("This request is not allowed.", 403);
  }
  return external;
}

export async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) throw new RequestPolicyError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestPolicyError("Send a valid JSON request.", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maximumBytes) { await reader.cancel(); throw new RequestPolicyError("Request is too large.", 413); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new RequestPolicyError("Send a valid JSON request.", 400); }
  } finally { reader.releaseLock(); }
}
