import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { RequestPolicyError } from "./local-request.ts";

export const HOSTED_SESSION_COOKIE = "joysearch_hosted_session";
export const HOSTED_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Only the explicitly enabled production origin can start hosted paid work. */
export function assertHostedRequest(request: Request, environment = process.env): URL {
  if (!environment.VERCEL || environment.VERCEL_ENV !== "production" || environment.JOYSEARCH_LIVE_ENABLED !== "true") {
    throw new RequestPolicyError("Live requests are not enabled on this deployment.", 503);
  }
  let configured: URL;
  try {
    configured = new URL(environment.JOYSEARCH_ORIGIN ?? "");
    // Require a canonical origin, not a URL whose path/credentials are silently dropped.
    if (configured.protocol !== "https:" || configured.origin !== environment.JOYSEARCH_ORIGIN) throw new Error();
  } catch {
    throw new RequestPolicyError("The hosted request policy is not configured.", 503);
  }
  const actual = new URL(request.url);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (actual.origin !== configured.origin || actual.username || actual.password ||
      request.headers.get("host") !== configured.host ||
      request.headers.get("origin") !== configured.origin ||
      (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new RequestPolicyError("This request is not allowed.", 403);
  }
  // Forwarded headers are deliberately not an authority for the public origin.
  return configured;
}

function signingKey(secret: string): string {
  if (!/^[a-f0-9]{64,}$/i.test(secret)) throw new RequestPolicyError("Hosted sessions are not configured.", 503);
  return secret;
}

function signature(body: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret)).update(`hosted-session:${body}`).digest();
}

/** Verification only: missing, duplicate, edited, future, and expired cookies are rejected. */
export function readHostedSession(cookieHeader: string | null, secret: string, now = Date.now()): string | undefined {
  signingKey(secret);
  if (!Number.isSafeInteger(now) || now < 0 || !cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map(part => part.trim())
    .filter(part => part.startsWith(`${HOSTED_SESSION_COOKIE}=`));
  if (cookies.length !== 1) return undefined;
  const value = cookies[0].slice(HOSTED_SESSION_COOKIE.length + 1);
  if (value.length > 128) return undefined;
  const [version, id, issued, mac, extra] = value.split(".");
  if (version !== "v1" || !SESSION_ID_PATTERN.test(id ?? "") ||
      !/^(0|[1-9][0-9]{0,15})$/.test(issued ?? "") ||
      !/^[A-Za-z0-9_-]{43}$/.test(mac ?? "") || extra !== undefined) return undefined;
  const issuedAt = Number(issued);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt >= HOSTED_SESSION_TTL_MS) return undefined;
  const actual = Buffer.from(mac, "base64url");
  // Canonical encoding matters because the signed token also identifies a session.
  if (actual.toString("base64url") !== mac) return undefined;
  const expected = signature(`${version}.${id}.${issued}`, secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : undefined;
}

/** New sessions are issued only by search; valid sessions never get a sliding expiry. */
export function getOrCreateHostedSession(cookieHeader: string | null, secret: string, now = Date.now()): { id: string; setCookie?: string } {
  const existing = readHostedSession(cookieHeader, secret, now);
  if (existing) return { id: existing };
  if (!Number.isSafeInteger(now) || now < 0) throw new RequestPolicyError("Hosted sessions are unavailable.", 503);
  const id = randomBytes(32).toString("base64url");
  const body = `v1.${id}.${now}`;
  const token = `${body}.${signature(body, secret).toString("base64url")}`;
  return {
    id,
    setCookie: `${HOSTED_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${HOSTED_SESSION_TTL_MS / 1000}`,
  };
}

/** Persist a purpose-bound digest rather than the browser's session ID or address. */
export function hostedSessionBudgetKey(id: string, secret: string): string {
  if (!SESSION_ID_PATTERN.test(id)) throw new RequestPolicyError("This session is unavailable.", 403);
  return createHmac("sha256", signingKey(secret)).update(`hosted-budget-session:v1:${id}`).digest("hex");
}
