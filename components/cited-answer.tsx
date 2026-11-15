"use client";

import { useEffect, useRef, useState } from "react";
import { streamCitedAnswer } from "@/lib/answer/client";
import type { AnswerClaim, AnswerKind, AnswerSource } from "@/lib/answer/types";

type AnswerState =
  | { status: "idle" | "cancelled" }
  | { status: "error"; message: string }
  | { status: "loading" }
  | { status: "streaming"; sources: AnswerSource[]; claims: AnswerClaim[] }
  | { status: "complete"; sources: AnswerSource[]; claims: AnswerClaim[]; kind: AnswerKind; message?: string };

const buttonClass = "min-h-11 rounded-full border border-joy-blue px-4 py-2 text-sm font-medium text-joy-blue hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-joy-blue";

type CitedAnswerProps =
  | { contextToken: string; samplePlayback?: never }
  | { contextToken?: never; samplePlayback: (options: Parameters<typeof streamCitedAnswer>[1]) => Promise<void> };

export function CitedAnswer({ contextToken, samplePlayback }: CitedAnswerProps) {
  const [answer, setAnswer] = useState<AnswerState>({ status: "idle" });
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  async function generate() {
    if (requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    setAnswer({ status: "loading" });
    const timeout = window.setTimeout(() => request.abort(new DOMException("Answer timed out", "TimeoutError")), 20_000);
    try {
      const options: Parameters<typeof streamCitedAnswer>[1] = {
        signal: request.signal,
        onEvent(event) {
          if (requestRef.current !== request) return;
          if (event.type === "start") setAnswer({ status: "streaming", sources: event.sources, claims: [] });
          if (event.type === "claim") setAnswer((previous) => previous.status === "streaming"
            ? { ...previous, claims: [...previous.claims, event.claim] } : previous);
          if (event.type === "done") setAnswer((previous) => previous.status === "streaming"
            ? { ...previous, status: "complete", kind: event.kind, message: event.message } : previous);
        },
      };
      if (samplePlayback) await samplePlayback(options);
      else await streamCitedAnswer(contextToken, options);
    } catch (error) {
      if (requestRef.current === request) {
        setAnswer({
          status: "error",
          message: request.signal.reason?.name === "TimeoutError"
            ? "The answer took too long. Your search results are still available."
            : error instanceof Error ? error.message : "The answer is unavailable. Your search results are still available.",
        });
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === request) requestRef.current = null;
    }
  }

  function stop() {
    const request = requestRef.current;
    requestRef.current = null;
    request?.abort();
    setAnswer({ status: "cancelled" });
  }

  const generating = answer.status === "loading" || answer.status === "streaming";
  const display = answer.status === "streaming" || answer.status === "complete" ? answer : undefined;
  const sourceMap = new Map(display?.sources.map((source, index) => [source.id, { ...source, number: index + 1 }]) ?? []);
  let status = "";
  if (generating) status = display?.claims.length ? "Writing a cited answer…" : "Reading the search sources…";
  if (answer.status === "cancelled") status = "Answer stopped. Your search results are still available.";
  if (answer.status === "complete") status = answer.kind === "clarify"
    ? "More detail is needed."
    : answer.kind === "insufficient" ? "The sources do not contain enough evidence." : "Answer complete.";

  return (
    <section aria-labelledby="answer-heading" className="my-4 w-full min-w-0 rounded-2xl border border-blue-100 bg-blue-50/30 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="answer-heading" className="text-base font-medium text-gray-900">{samplePlayback ? "Sample answer" : "Cited answer"}</h2>
        {generating ? (
          <button type="button" onClick={stop} className={buttonClass}>Stop answer</button>
        ) : answer.status !== "complete" ? (
          <button type="button" onClick={generate} className={buttonClass}>
            {samplePlayback ? (answer.status === "idle" ? "Play sample answer" : "Replay sample answer") : (answer.status === "idle" ? "Generate cited answer" : "Try answer again")}
          </button>
        ) : null}
      </div>
      {answer.status === "idle" ? <p className="mt-2 text-sm text-search-muted">{samplePlayback ? "Play an authored example using the sample sources below." : "An optional answer based on these search sources."}</p> : null}
      <p role="status" aria-live="polite" aria-atomic="true" className="mt-2 text-sm text-search-muted">{status}</p>
      {answer.status === "error" ? <p role="alert" className="mt-2 text-sm text-joy-red">{answer.message}</p> : null}
      {display?.claims.length ? (
        <ul aria-label="Answer statements" className="mt-3 space-y-3 text-sm leading-6 text-gray-900 md:text-base">
          {display.claims.map((claim, index) => (
            <li key={index}>
              <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{claim.text}</span>{" "}
              {claim.sourceIds.map((id) => {
                const source = sourceMap.get(id);
                return source ? (
                  <a key={id} href={source.url} target="_blank" rel="noopener noreferrer"
                    aria-label={`Source ${source.number}: ${source.title}`}
                    className="mx-0.5 inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-blue-200 bg-white px-1 text-sm font-medium text-result-link hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-joy-blue">
                    [{source.number}]
                  </a>
                ) : null;
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {answer.status === "complete" && answer.message ? <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-900 md:text-base">{answer.message}</p> : null}
      {display?.sources.length && (display.claims.length || answer.status === "complete") ? (
        <details className="mt-4 border-t border-blue-100 pt-3 text-sm">
          <summary className="min-h-8 cursor-pointer font-medium text-joy-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-joy-blue">Inspect the supplied sources ({display.sources.length})</summary>
          <ol className="mt-3 space-y-4">
            {display.sources.map((source, index) => (
              <li key={source.id} className="break-words [overflow-wrap:anywhere]">
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="font-medium text-result-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-joy-blue">[{index + 1}] {source.title}</a>
                <p className="mt-1 text-xs text-search-muted">{new URL(source.url).hostname}</p>
                <p className="mt-1 whitespace-pre-wrap leading-6 text-gray-700">{source.excerpt || "No excerpt was supplied."}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {display ? <p className="mt-3 text-xs text-search-muted">{samplePlayback ? "Authored sample answer with fictional sources. No AI request was made." : "AI-generated. Citations identify sources; check them for accuracy."}</p> : null}
    </section>
  );
}
