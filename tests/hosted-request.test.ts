import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHostedRequest, getOrCreateHostedSession, hostedSessionBudgetKey,
  HOSTED_SESSION_COOKIE, HOSTED_SESSION_TTL_MS, readHostedSession,
} from "../lib/hosted-request.ts";
import { RequestPolicyError } from "../lib/local-request.ts";

const origin = "https://joysearch.example.com";
const environment = {
  NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production", JOYSEARCH_LIVE_ENABLED: "true", JOYSEARCH_ORIGIN: origin,
} as NodeJS.ProcessEnv;
const secret = "a".repeat(64);
const now = 1_800_000_000_000;
const request = (headers: Record<string, string> = {}, url = `${origin}/api/search`) => new Request(url, {
  method: "POST", headers: { host: "joysearch.example.com", origin, "sec-fetch-site": "same-origin", ...headers },
});
const hasStatus = (status: number) => (error: unknown) => error instanceof RequestPolicyError && error.status === status;

test("hosted requests require the explicit enabled production deployment and canonical configuration", () => {
  assert.equal(assertHostedRequest(request(), environment).origin, origin);
  for (const update of [
    { VERCEL: undefined }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" },
    { JOYSEARCH_LIVE_ENABLED: undefined }, { JOYSEARCH_LIVE_ENABLED: "false" },
    { JOYSEARCH_ORIGIN: undefined }, { JOYSEARCH_ORIGIN: "http://joysearch.example.com" },
    { JOYSEARCH_ORIGIN: `${origin}/` }, { JOYSEARCH_ORIGIN: `${origin}/api` },
    { JOYSEARCH_ORIGIN: `${origin}?x=1` }, { JOYSEARCH_ORIGIN: `${origin}#fragment` },
    { JOYSEARCH_ORIGIN: "https://user:password@joysearch.example.com" },
  ]) {
    assert.throws(() => assertHostedRequest(request(), { ...environment, ...update }), hasStatus(503));
  }
});

test("origin, Host, request URL, and Fetch Metadata must agree; forwarded headers cannot bypass them", () => {
  const invalidHeaders: Record<string, string>[] = [
    { origin: "https://evil.example" }, { origin: "null" }, { origin: "" },
    { host: "evil.example" }, { host: "joysearch.example.com:443" }, { host: "" },
    { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "none" },
  ];
  for (const headers of invalidHeaders) assert.throws(() => assertHostedRequest(request(headers), environment), hasStatus(403));
  assert.throws(() => assertHostedRequest(request({ "x-forwarded-host": "joysearch.example.com", "x-forwarded-proto": "https" }, "https://evil.example/api/search"), environment), hasStatus(403));
  assert.throws(() => assertHostedRequest(request({}, "http://joysearch.example.com/api/search"), environment), hasStatus(403));
  assert.throws(() => assertHostedRequest(new Request(`${origin}/api/search`, { headers: { host: "joysearch.example.com" } }), environment), hasStatus(403));
  assert.throws(() => assertHostedRequest(new Request(`${origin}/api/search`, { headers: { origin } }), environment), hasStatus(403));
  // Non-browser clients may omit Fetch Metadata, but never Origin or Host.
  assert.equal(assertHostedRequest(new Request(`${origin}/api/search`, { headers: { host: "joysearch.example.com", origin } }), environment).origin, origin);
});

test("hosted sessions are signed, secure, and expire absolutely rather than on each search", () => {
  const created = getOrCreateHostedSession(null, secret, now);
  assert.match(created.id, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(created.setCookie);
  assert.match(created.setCookie, /; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=86400$/);
  const cookie = created.setCookie.split(";")[0];
  assert.equal(readHostedSession(`other=1; ${cookie}; last=2`, secret, now + 1), created.id);
  assert.deepEqual(getOrCreateHostedSession(cookie, secret, now + HOSTED_SESSION_TTL_MS - 1), { id: created.id });
  assert.equal(readHostedSession(cookie, secret, now - 1), undefined);
  assert.equal(readHostedSession(cookie, secret, now + HOSTED_SESSION_TTL_MS), undefined);
  assert.notEqual(getOrCreateHostedSession(cookie, secret, now + HOSTED_SESSION_TTL_MS).id, created.id);
});

test("edited, unsigned, duplicate, or differently signed session cookies never validate", () => {
  const created = getOrCreateHostedSession(null, secret, now);
  const cookie = created.setCookie!.split(";")[0];
  const value = cookie.slice(HOSTED_SESSION_COOKIE.length + 1);
  const parts = value.split(".");
  for (const altered of [
    `${HOSTED_SESSION_COOKIE}=${created.id}`,
    `${HOSTED_SESSION_COOKIE}=${[parts[0], "b".repeat(43), parts[2], parts[3]].join(".")}`,
    `${HOSTED_SESSION_COOKIE}=${[parts[0], parts[1], String(now + 1), parts[3]].join(".")}`,
    `${HOSTED_SESSION_COOKIE}=${value}.extra`,
    `${cookie}; ${cookie}`,
    `${HOSTED_SESSION_COOKIE}=${"x".repeat(200)}`,
  ]) {
    assert.equal(readHostedSession(altered, secret, now + 2), undefined);
    const replacement = getOrCreateHostedSession(altered, secret, now + 2);
    assert.notEqual(replacement.id, created.id);
    assert.ok(replacement.setCookie);
  }
  assert.equal(readHostedSession(cookie, "b".repeat(64), now + 2), undefined);
  assert.equal(readHostedSession(null, secret, now), undefined);
  assert.throws(() => getOrCreateHostedSession(null, "bad-key", now), hasStatus(503));
  assert.throws(() => readHostedSession(cookie, "bad-key", now), hasStatus(503));
});

test("budget identifiers are stable purpose-bound digests with no raw session identifiers", () => {
  const first = getOrCreateHostedSession(null, secret, now).id;
  const second = getOrCreateHostedSession(null, secret, now).id;
  const digest = hostedSessionBudgetKey(first, secret);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(hostedSessionBudgetKey(first, secret), digest);
  assert.equal(digest.includes(first), false);
  assert.notEqual(hostedSessionBudgetKey(second, secret), digest);
  assert.notEqual(hostedSessionBudgetKey(first, "b".repeat(64)), digest);
  assert.throws(() => hostedSessionBudgetKey("not-a-session", secret), hasStatus(403));
});
