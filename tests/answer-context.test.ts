import assert from "node:assert/strict";
import { test } from "node:test";
import { ANSWER_CONTEXT_TTL_MS, createAnswerContext, newAnswerSession, readAnswerSession, verifyAnswerContext } from "../lib/answer/context.ts";
import { assertLocalRequest, readBoundedJson } from "../lib/local-request.ts";

const secret = "a".repeat(64);
const session = newAnswerSession();
const now = 1_000_000;
const source = { id: "S1", title: "Owned fixture", url: "https://example.com/source", excerpt: "The library closes at 18:00." };

test("answer context binds the query and exact source map to an expiring browser session", () => {
  const token = createAnswerContext("When does it close?", [source], session, secret, now);
  const decoded = verifyAnswerContext(token, session, secret, now + 1);
  assert.equal(Buffer.from(token.split(".")[0], "base64url").toString().includes(session), false);
  assert.deepEqual(decoded.sources, [source]);
  assert.equal(decoded.query, "When does it close?");
  assert.throws(() => verifyAnswerContext(token, newAnswerSession(), secret, now), /unavailable/);
  assert.throws(() => verifyAnswerContext(token, undefined, secret, now), /unavailable/);
  assert.throws(() => verifyAnswerContext(token, session, secret, now + ANSWER_CONTEXT_TTL_MS), /expired/);
  assert.throws(() => verifyAnswerContext(token, session, "b".repeat(64), now), /unavailable/);
});

test("editing signed evidence or forging citation URLs is rejected before any model work", () => {
  const token = createAnswerContext("hours", [source], session, secret, now);
  const [body, signature] = token.split(".");
  const data = JSON.parse(Buffer.from(body, "base64url").toString());
  data.sources[0].excerpt = "The library is always open.";
  const modified = Buffer.from(JSON.stringify(data)).toString("base64url");
  assert.throws(() => verifyAnswerContext(`${modified}.${signature}`, session, secret, now), /unavailable/);
  assert.throws(() => createAnswerContext("hours", [{ ...source, url: "javascript:alert(1)" }], session, secret, now), /invalid evidence/);
  assert.throws(() => createAnswerContext("hours", [{ ...source, url: "https://user:password@example.com" }], session, secret, now), /invalid evidence/);
  assert.throws(() => createAnswerContext("hours", [source, source], session, secret, now), /invalid evidence/);
  assert.equal(readAnswerSession(`other=1; joysearch_session=${session}; last=2`), session);
  assert.equal(readAnswerSession("joysearch_session=../../invalid"), undefined);
});

test("alternate base64 signature padding cannot create another replay identity", () => {
  const token = createAnswerContext("hours", [source], session, secret, now);
  const [body, signature] = token.split(".");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(signature.at(-1)!);
  for (let padding = 1; padding <= 3; padding += 1) {
    const alternate = signature.slice(0, -1) + alphabet[last + padding];
    assert.deepEqual(Buffer.from(alternate, "base64url"), Buffer.from(signature, "base64url"));
    assert.throws(() => verifyAnswerContext(`${body}.${alternate}`, session, secret, now), /unavailable/);
  }
});

test("local paid routes reject hosted and cross-origin traffic but support Next internal host rewriting", () => {
  const environment = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
  assert.equal(assertLocalRequest(new Request("http://localhost:3035/api/search", { headers: { host: "127.0.0.1:3035", origin: "http://127.0.0.1:3035" } }), environment).hostname, "127.0.0.1");
  assert.throws(() => assertLocalRequest(new Request("http://localhost/api/search"), { NODE_ENV: "production" } as NodeJS.ProcessEnv), /not enabled/);
  assert.throws(() => assertLocalRequest(new Request("http://localhost/api/search", { headers: { origin: "https://evil.example" } }), environment), /not allowed/);
  assert.throws(() => assertLocalRequest(new Request("http://localhost/api/search", { headers: { host: "evil.example" } }), environment), /not allowed/);
});

test("streamed request size is bounded even without Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("{" + "x".repeat(100))); },
    cancel() { cancelled = true; },
  });
  const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
  await assert.rejects(readBoundedJson(request, 20), /too large/);
  assert.equal(cancelled, true);
  const valid = new Request("http://localhost", { method: "POST", body: '{"query":"library"}' });
  assert.deepEqual(await readBoundedJson(valid, 100), { query: "library" });
});
