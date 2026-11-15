import type { AnswerEvent } from "../answer/types.ts";
import type { SampleScenario } from "./scenarios.ts";

type PlaybackOptions = { signal?: AbortSignal; onEvent: (event: AnswerEvent) => void };

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** In-memory playback only. Timings are illustrative and never performance measurements. */
export async function playSampleAnswer(scenario: SampleScenario, { signal, onEvent }: PlaybackOptions): Promise<void> {
  await pause(350, signal);
  signal?.throwIfAborted();
  onEvent({ type: "start", requestId: `sample-${scenario.id}`, sources: structuredClone(scenario.sources) });
  await pause(900, signal);
  signal?.throwIfAborted();
  if ("error" in scenario.result) throw new Error(scenario.result.error);
  for (const claim of scenario.result.claims) {
    signal?.throwIfAborted();
    onEvent({ type: "claim", claim: structuredClone(claim) });
    await pause(200, signal);
  }
  await pause(400, signal);
  signal?.throwIfAborted();
  onEvent({ type: "done", kind: scenario.result.kind, ...(scenario.result.message ? { message: scenario.result.message } : {}) });
}
