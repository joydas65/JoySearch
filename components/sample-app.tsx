"use client";

import { useState } from "react";
import { CitedAnswer } from "./cited-answer";
import { SearchResults } from "./search-results";
import { playSampleAnswer } from "@/lib/sample/playback";
import { createSampleScenario, isSampleId, SAMPLE_CHOICES, type SampleId, type SampleScenario } from "@/lib/sample/scenarios";

export function SampleApp() {
  const [choice, setChoice] = useState<SampleId>("answer");
  const [loaded, setLoaded] = useState<{ scenario: SampleScenario; revision: number }>();

  return (
    <>
      <form className="my-6 flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault();
        const scenario = createSampleScenario(choice, window.location.origin);
        setLoaded((previous) => ({ scenario, revision: (previous?.revision ?? 0) + 1 }));
      }}>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor="sample-choice" className="text-sm font-medium text-gray-900">Choose a sample</label>
          <select id="sample-choice" value={choice} className="min-h-11 max-w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-joy-blue"
            onChange={(event) => {
              if (!isSampleId(event.target.value)) return;
              setChoice(event.target.value);
              // Unmount the old answer immediately; its cleanup aborts pending playback.
              setLoaded(undefined);
            }}>
            {SAMPLE_CHOICES.map((sample) => <option key={sample.id} value={sample.id}>{sample.label}</option>)}
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded-full border border-joy-blue px-5 py-2 text-sm font-medium text-joy-blue hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-joy-blue">Load sample</button>
      </form>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-search-muted">
        {loaded ? `Sample loaded: ${SAMPLE_CHOICES.find((sample) => sample.id === loaded.scenario.id)?.label}.` : "Choose an example, then load its authored search results."}
      </p>
      {loaded ? (
        <section aria-labelledby="sample-query-heading" className="mt-5 min-w-0">
          <h2 id="sample-query-heading" className="text-sm font-medium text-search-muted">Sample query</h2>
          <p className="mt-1 break-words text-lg text-gray-900">{loaded.scenario.query}</p>
          <CitedAnswer key={`${loaded.scenario.id}-${loaded.revision}`} samplePlayback={(options) => playSampleAnswer(loaded.scenario, options)} />
          <section aria-labelledby="sample-results-heading">
            <h2 id="sample-results-heading" className="text-base font-medium text-gray-900">Sample search results</h2>
            <p className="mt-1 text-sm text-search-muted">Owned fictional documents, included with JoySearch.</p>
            <SearchResults results={loaded.scenario.sources} />
          </section>
        </section>
      ) : null}
    </>
  );
}
