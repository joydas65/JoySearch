import type { AnswerClaim, AnswerKind, AnswerSource } from "../answer/types.ts";

/** Original fictional examples, authored for this demo; never provider responses. */
export const SAMPLE_DOCUMENTS = [
  {
    id: "atlas-guide",
    title: "Atlas Queue getting-started guide",
    excerpt: "Atlas Queue is a fictional job scheduler. Its Starter plan allows up to five concurrent jobs per workspace. Job history is retained for seven days. To begin, create a workspace, add a queue, and submit a job.",
  },
  {
    id: "atlas-update",
    title: "Atlas Queue Starter plan update",
    excerpt: "In this fictional policy, the Starter plan's concurrent-job limit increased from three to five per workspace on 12 October 2026. The seven-day job-history retention period did not change. This note does not specify an uptime guarantee.",
  },
] as const;

export const SAMPLE_CHOICES = [
  { id: "answer", label: "Cited answer", query: "How many concurrent jobs does the fictional Atlas Queue Starter plan allow?" },
  { id: "clarify", label: "Clarification", query: "What is Atlas Queue's limit?" },
  { id: "navigation", label: "Navigation", query: "Open the fictional Atlas Queue getting-started guide." },
  { id: "insufficient", label: "Missing evidence", query: "Does fictional Atlas Queue offer an uptime guarantee?" },
  { id: "failure", label: "Answer unavailable", query: "How many concurrent jobs does the fictional Atlas Queue Starter plan allow?" },
  { id: "budget", label: "Allowance exhausted", query: "How many concurrent jobs does the fictional Atlas Queue Starter plan allow?" },
] as const;

export type SampleId = (typeof SAMPLE_CHOICES)[number]["id"];
export type SampleScenario = {
  id: SampleId;
  query: string;
  sources: AnswerSource[];
  result: { kind: AnswerKind; claims: AnswerClaim[]; message?: string } | { error: string };
};

export function isSampleId(value: string): value is SampleId {
  return SAMPLE_CHOICES.some((choice) => choice.id === value);
}

/** Resolve owned source links against this page's origin, including local/preview demos. */
export function createSampleScenario(id: SampleId, origin: string): SampleScenario {
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.origin !== origin) {
    throw new Error("Sample source links need a web origin.");
  }
  const choice = SAMPLE_CHOICES.find((entry) => entry.id === id);
  if (!choice) throw new Error("Choose an available sample.");
  const sources = SAMPLE_DOCUMENTS.map((document, index) => ({
    id: `S${index + 1}`,
    title: document.title,
    url: new URL(`/samples/sources#${document.id}`, base).href,
    excerpt: document.excerpt,
  }));
  let result: SampleScenario["result"];
  switch (id) {
    case "answer":
      result = { kind: "answer", claims: [
        { text: "The fictional Atlas Queue Starter plan allows up to five concurrent jobs per workspace.", sourceIds: ["S1"] },
        { text: "This replaced the three-job limit on 12 October 2026; job history remains available for seven days.", sourceIds: ["S2"] },
      ] };
      break;
    case "clarify":
      result = { kind: "clarify", claims: [], message: "Do you mean concurrent jobs or retained job history for Atlas Queue?" };
      break;
    case "navigation":
      result = { kind: "navigation", claims: [{ text: "Open the Atlas Queue getting-started guide.", sourceIds: ["S1"] }] };
      break;
    case "insufficient":
      result = { kind: "insufficient", claims: [], message: "These sample sources do not specify an uptime guarantee. Check the service agreement before relying on one." };
      break;
    case "failure":
      result = { error: "Simulated answer service failure. Your search results are still available." };
      break;
    case "budget":
      result = { error: "Simulated allowance exhaustion. Your search results are still available." };
      break;
  }
  return { id, query: choice.query, sources, result };
}
