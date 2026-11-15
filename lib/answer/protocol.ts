import type { AnswerClaim, AnswerContentEvent, AnswerKind, AnswerSource } from "./types.ts";

export class AnswerProtocolError extends Error {
  readonly code = "invalid_answer";
  constructor() {
    super("The generated answer could not be validated. Your search results are still available.");
    this.name = "AnswerProtocolError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1600 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

/** Checks citation references and transport structure; it does not establish factual support. */
export class AnswerProtocol {
  private readonly sourceIds: Set<string>;
  private buffer = "";
  private bytes = 0;
  private complete = false;
  private decision?: AnswerKind;
  private readonly expectedKind?: AnswerKind;
  private terminal?: Extract<AnswerContentEvent, { type: "done" }>;
  readonly claims: AnswerClaim[] = [];

  constructor(sources: readonly AnswerSource[], expectedKind?: AnswerKind) {
    this.sourceIds = new Set(sources.map((source) => source.id));
    this.expectedKind = expectedKind;
  }

  push(chunk: string): Extract<AnswerContentEvent, { type: "claim" }>[] {
    if (this.complete) throw new AnswerProtocolError();
    this.bytes += new TextEncoder().encode(chunk).length;
    if (this.bytes > 16_384) throw new AnswerProtocolError();
    this.buffer += chunk;
    const events: Extract<AnswerContentEvent, { type: "claim" }>[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        const claim = this.line(line);
        if (claim) events.push(claim);
      }
    }
    if (this.buffer.length > 8_192) throw new AnswerProtocolError();
    return events;
  }

  private line(line: string): Extract<AnswerContentEvent, { type: "claim" }> | undefined {
    if (this.terminal) throw new AnswerProtocolError();
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw new AnswerProtocolError(); }
    if (!record(parsed)) throw new AnswerProtocolError();
    if (!this.decision) {
      if (parsed.type !== "decision" || !exactKeys(parsed, ["type", "kind"]) ||
          typeof parsed.kind !== "string" || !["answer", "navigation", "clarify", "insufficient"].includes(parsed.kind) ||
          (this.expectedKind !== undefined && parsed.kind !== this.expectedKind)) {
        throw new AnswerProtocolError();
      }
      // A categorical control record, not reasoning or a browser-visible event.
      this.decision = parsed.kind as AnswerKind;
      return;
    }
    if (parsed.type === "claim") {
      if ((this.decision !== "answer" && this.decision !== "navigation") ||
          !exactKeys(parsed, ["type", "text", "sourceIds"]) || !validText(parsed.text) ||
          !Array.isArray(parsed.sourceIds) || parsed.sourceIds.length === 0 || parsed.sourceIds.length > 5 ||
          parsed.sourceIds.some((id) => typeof id !== "string" || !this.sourceIds.has(id)) ||
          new Set(parsed.sourceIds).size !== parsed.sourceIds.length || this.claims.length >= 8) {
        throw new AnswerProtocolError();
      }
      const claim = { text: parsed.text.trim(), sourceIds: parsed.sourceIds as string[] };
      this.claims.push(claim);
      return { type: "claim", claim };
    }
    if (parsed.type !== "done" || !exactKeys(parsed, ["type", "kind", "message"]) || parsed.kind !== this.decision) {
      throw new AnswerProtocolError();
    }
    const kind = parsed.kind as AnswerKind;
    if (kind === "answer" || kind === "navigation") {
      if (!this.claims.length || parsed.message !== undefined) throw new AnswerProtocolError();
      this.terminal = { type: "done", kind };
    } else {
      if (this.claims.length || !validText(parsed.message)) throw new AnswerProtocolError();
      this.terminal = { type: "done", kind, message: parsed.message.trim() };
    }
  }

  /** Call only after the model stream has finished normally, never on an output-limit stop. */
  finish(): Extract<AnswerContentEvent, { type: "done" }> {
    if (this.complete) throw new AnswerProtocolError();
    // A final JSON object may omit its trailing newline, but a partial object is rejected.
    if (this.buffer.trim()) this.line(this.buffer.trim());
    this.buffer = "";
    if (!this.terminal) throw new AnswerProtocolError();
    this.complete = true;
    return { ...this.terminal };
  }
}
