import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AnswerSource } from "./types.ts";

export const ANSWER_CONTEXT_TTL_MS = 10 * 60 * 1000;
export const ANSWER_SESSION_COOKIE = "joysearch_session";
const MAX_TOKEN_LENGTH = 24_000;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AnswerContext = {
  version: 1;
  query: string;
  sources: AnswerSource[];
  sessionBinding: string;
  issuedAt: number;
  expiresAt: number;
};

export class AnswerContextError extends Error {
  readonly code: "invalid_context" | "expired_context";
  constructor(code: "invalid_context" | "expired_context", message: string) {
    super(message);
    this.name = "AnswerContextError";
    this.code = code;
  }
}

export function readAnswerSession(cookieHeader: string | null): string | undefined {
  const value = cookieHeader?.split(";").map(part => part.trim()).find(part => part.startsWith(`${ANSWER_SESSION_COOKIE}=`))?.slice(ANSWER_SESSION_COOKIE.length + 1);
  return value && SESSION_PATTERN.test(value) ? value : undefined;
}

export function newAnswerSession(): string { return randomBytes(32).toString("base64url"); }

function signingKey(secret: string): string {
  if (!/^[a-f0-9]{64,}$/i.test(secret)) throw new Error("Answer signing key is not configured.");
  return secret;
}

function validSource(source: unknown): source is AnswerSource {
  if (!source || typeof source !== "object") return false;
  const value = source as AnswerSource;
  if (!/^S[1-5]$/.test(value.id) || typeof value.title !== "string" || !value.title || value.title.length > 300 ||
      typeof value.excerpt !== "string" || !value.excerpt.trim() || value.excerpt.length > 4000 || typeof value.url !== "string" || value.url.length > 3000) return false;
  try {
    const url = new URL(value.url);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function validPayload(value: unknown): value is AnswerContext {
  if (!value || typeof value !== "object") return false;
  const data = value as AnswerContext;
  return data.version === 1 && typeof data.query === "string" && data.query.length > 0 && data.query.length <= 600 &&
    typeof data.sessionBinding === "string" && /^[a-f0-9]{64}$/.test(data.sessionBinding) && Number.isSafeInteger(data.issuedAt) &&
    Number.isSafeInteger(data.expiresAt) && data.expiresAt - data.issuedAt === ANSWER_CONTEXT_TTL_MS &&
    Array.isArray(data.sources) && data.sources.length > 0 && data.sources.length <= 5 && data.sources.every(validSource) &&
    new Set(data.sources.map(s => s.id)).size === data.sources.length && new Set(data.sources.map(s => s.url)).size === data.sources.length;
}

export function createAnswerContext(query: string, sources: AnswerSource[], sessionId: string, secret: string, now = Date.now()): string {
  if (!SESSION_PATTERN.test(sessionId)) throw new Error("Invalid answer session.");
  const sessionBinding = createHmac("sha256", signingKey(secret)).update(`session:${sessionId}`).digest("hex");
  const payload: AnswerContext = { version: 1, query, sources, sessionBinding, issuedAt: now, expiresAt: now + ANSWER_CONTEXT_TTL_MS };
  if (!validPayload(payload)) throw new Error("Cannot create answer context from invalid evidence.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", signingKey(secret)).update(body).digest("base64url");
  const token = `${body}.${signature}`;
  if (token.length > MAX_TOKEN_LENGTH) throw new Error("Answer evidence is too large.");
  return token;
}

export function verifyAnswerContext(token: unknown, sessionId: string | undefined, secret: string, now = Date.now()): AnswerContext {
  const invalid = () => new AnswerContextError("invalid_context", "This answer context is unavailable. Run the search again.");
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH || !sessionId || !SESSION_PATTERN.test(sessionId)) throw invalid();
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw invalid();
  const expected = createHmac("sha256", signingKey(secret)).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.toString("base64url") !== parts[1] || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  let data: unknown;
  try { data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { throw invalid(); }
  const binding = createHmac("sha256", signingKey(secret)).update(`session:${sessionId}`).digest("hex");
  if (!validPayload(data) || data.sessionBinding !== binding || data.issuedAt > now + 5_000) throw invalid();
  if (data.expiresAt <= now) throw new AnswerContextError("expired_context", "These sources have expired. Run the search again to generate an answer.");
  return data;
}
