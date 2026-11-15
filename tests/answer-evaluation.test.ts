import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { assertAnswerModelCatalog, assertReviewRunIdentity, assertReviewStageIdentity, checkAnswerStructure, parseAnswerOptions, summarizeSemanticReview, validateAnswerCorpus } from "../scripts/evaluate-answers.ts";
import type { AnswerFixture } from "../fixtures/answers/types.ts";

const fixture: AnswerFixture = {
  id: "ANS01", split: "development", category: "factual", query: "What is the limit?",
  sources: [{ id: "S1", title: "Owned fixture", url: "https://example.com/joysearch-fixtures/test", excerpt: "The limit is four." }],
  expected: { kind: "answer", facets: [{ id: "limit", description: "The limit is four.", sourceIds: ["S1"] }], forbiddenClaims: ["The limit is ten."], forbiddenOutputStrings: ["DO_NOT_PRINT_THIS"] },
};

test("answer evaluation defaults to dry run and rejects unsafe paid combinations", () => {
  assert.equal(parseAnswerOptions([]).run, false);
  assert.equal(parseAnswerOptions([]).phase, "development");
  assert.equal(parseAnswerOptions([]).corpus, "corpus");
  assert.equal(parseAnswerOptions(["--corpus", "confirmation-v3"]).corpus, "confirmation-v3");
  for (const value of ["../outside", "/tmp/data", "corpus.json", "https://example.com"]) {
    assert.throws(() => parseAnswerOptions(["--corpus", value]), /unsupported/);
  }
  assert.throws(() => parseAnswerOptions(["--run", "--review", "review.json"]), /cannot dispatch/);
  assert.throws(() => parseAnswerOptions(["--campaign", "../outside"]), /unsupported/);
  assert.throws(() => parseAnswerOptions(["--model", "unpriced/model"]), /unsupported/);
});

test("owned corpus has a fixed development/holdout split and no retrieval URLs", async () => {
  const corpus = validateAnswerCorpus(JSON.parse(await readFile(new URL("../fixtures/answers/corpus.json", import.meta.url), "utf8")));
  assert.equal(corpus.cases.length, 12);
  assert.equal(corpus.cases.filter((item) => item.split === "development").length, 4);
  assert.equal(corpus.cases.filter((item) => item.split === "holdout").length, 8);
  assert.ok(corpus.cases.some((item) => item.category === "source_prompt_injection"));
  assert.throws(() => validateAnswerCorpus({ ...corpus, cases: [fixture, fixture] }), /duplicate/);
  assert.throws(() => validateAnswerCorpus({ ...corpus, cases: [] }), /Invalid/);
  assert.throws(() => validateAnswerCorpus({ ...corpus, cases: [{ ...fixture, split: ["holdout"] }] }), /Invalid/);
  assert.throws(() => validateAnswerCorpus({ ...corpus, cases: [{ ...fixture, expected: { ...fixture.expected, kind: ["answer"] } }] }), /Invalid/);
  assert.throws(() => validateAnswerCorpus({ ...corpus, cases: [{ ...fixture, sources: [{ ...fixture.sources[0], url: "https://real-provider.test/result" }] }] }), /authored evidence/);
});

test("valid citation IDs never become automatic factual-support grades", () => {
  const answer = { kind: "answer" as const, claims: [{ text: "The limit is ten.", sourceIds: ["S1"] }], usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } };
  const check = checkAnswerStructure(fixture, answer, fixture.sources);
  assert.equal(check.citationValidity, 1);
  assert.equal(check.semanticSupport, "not_automatically_measured");
  assert.equal(check.taskCompletion, "requires_review");
  const bad = checkAnswerStructure(fixture, { ...answer, claims: [{ text: "DO_NOT_PRINT_THIS", sourceIds: ["S9"] }] }, fixture.sources);
  assert.equal(bad.citationValidity, 0);
  assert.equal(bad.allClaimsHaveKnownCitations, false);
  assert.equal(bad.forbiddenOutputStringFound, true);
});

test("semantic review rejects missing claims and preserves unsupported results", () => {
  const run = {
    caseId: fixture.id, split: fixture.split, category: fixture.category, query: fixture.query,
    callId: "test/ANS01", model: "test", startedAt: "2026-11-14T00:00:00Z", preparedSources: fixture.sources,
    prompt: "test", system: "test", inputTokenUpperBound: 100, discardedBytes: 0, promptHash: "test",
    expected: fixture.expected, elapsedMs: 200, firstCitedClaimMs: 100, events: [], status: "success" as const,
    answer: { kind: "answer" as const, claims: [{ text: "The limit is ten.", sourceIds: ["S1"] }], usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
  };
  const review = {
    reviewer: "Fixture reviewer", reviewedAt: "2026-11-14T00:00:00Z", method: "Read the supplied source passage.",
    records: [{ caseId: fixture.id, outcomeAppropriate: true, criticalInventedClaim: true,
      claimSupport: [{ claimIndex: 0, support: "contradicted", reason: "S1 says four, not ten." }],
      facets: [{ id: "limit", covered: false, reason: "The reported limit is wrong." }],
    }],
  };
  assert.throws(() => summarizeSemanticReview({ ...review, records: [{ ...review.records[0], claimSupport: [] }] }, [run]), /incomplete/);
  assert.throws(() => summarizeSemanticReview({ ...review, records: [] }, [run]), /Missing/);
  const summary = summarizeSemanticReview(review, [run]);
  assert.equal(summary.macroClaimSupport, 0);
  assert.equal(summary.completedTasks, 0);
  assert.equal(summary.criticalInventedClaims, 1);

  const optimisticReview = { ...review, records: [{ ...review.records[0], criticalInventedClaim: false,
    claimSupport: [{ claimIndex: 0, support: "full", reason: "The destination is supported." }],
    facets: [{ id: "limit", covered: true, reason: "Required content present." }],
  }] };
  const wrongKind = summarizeSemanticReview(optimisticReview, [{ ...run, expected: { ...run.expected, kind: "navigation" } }]);
  assert.equal(wrongKind.completedTasks, 0, "reviewer approval cannot override the declared response kind");
});

test("review identity rejects another campaign, altered rubric, or substituted evidence", () => {
  const options = { campaign: "test", model: "openai/gpt-4.1-mini" as const };
  const prompt = JSON.stringify({ query: fixture.query, sources: fixture.sources.map(({ id, title, excerpt }) => ({ id, title, excerpt })) });
  const run = { caseId: fixture.id, split: fixture.split, model: options.model,
    callId: `answers/test/${options.model}/${fixture.id}`, query: fixture.query,
    expected: fixture.expected, preparedSources: fixture.sources,
    system: "system", prompt, promptHash: createHash("sha256").update("system\n" + prompt).digest("hex"),
  };
  assert.doesNotThrow(() => assertReviewRunIdentity(run, fixture, options));
  assert.throws(() => assertReviewRunIdentity({ ...run, callId: "answers/other" }, fixture, options), /identity/);
  assert.throws(() => assertReviewRunIdentity({ ...run, expected: { ...fixture.expected, kind: "clarify" } }, fixture, options), /identity/);
  assert.throws(() => assertReviewRunIdentity({ ...run, preparedSources: [{ ...fixture.sources[0], excerpt: "A different fact." }] }, fixture, options), /identity/);
  assert.throws(() => assertReviewRunIdentity({ ...run, preparedSources: [{ ...fixture.sources[0], title: "Changed scope" }] }, fixture, options), /identity/);
  assert.throws(() => assertReviewRunIdentity({ ...run, preparedSources: [fixture.sources[0], fixture.sources[0]] }, fixture, options), /identity/);
  assert.throws(() => assertReviewRunIdentity({ ...run, prompt: "changed" }, fixture, options), /Recorded prompt/);
});

test("two-stage reviews bind routing, writer requirements and frozen prompts while retaining old campaigns", () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const prompt = JSON.stringify({ query: fixture.query, sources: fixture.sources.map(({ id, title, excerpt }) => ({ id, title, excerpt })) });
  const requirements = ["limit with scope"];
  const router = { system: "frozen router", prompt };
  const writer = { system: "frozen writer", prompt: JSON.stringify({ ...JSON.parse(prompt), requirements }) };
  const configuration = { version: "owned-answer-evaluation-v3", intentPromptHash: sha(router.system), promptHash: sha(writer.system) };
  const run = { status: "success", system: writer.system, prompt,
    answer: { kind: "answer", callCount: 2, intent: { requirements }, stagePrompts: { intent: router, answer: writer } },
  };
  assert.doesNotThrow(() => assertReviewStageIdentity(run, configuration));
  for (const answer of [
    { ...run.answer, stagePrompts: undefined },
    { ...run.answer, stagePrompts: { intent: router } },
    { ...run.answer, callCount: 1 },
    { ...run.answer, intent: { requirements: ["substituted requirement"] } },
    { ...run.answer, stagePrompts: { intent: { ...router, prompt: "substituted evidence" }, answer: writer } },
    { ...run.answer, stagePrompts: { intent: { ...router, system: "different router" }, answer: writer } },
    { ...run.answer, stagePrompts: { intent: router, answer: { ...writer, prompt } } },
    { ...run.answer, stagePrompts: { intent: router, answer: { ...writer, system: "different writer" } } },
  ]) assert.throws(() => assertReviewStageIdentity({ ...run, answer }, configuration), /Recorded/);

  const early = { ...run, answer: { kind: "clarify", callCount: 1, intent: { requirements: [] }, stagePrompts: { intent: router } } };
  assert.doesNotThrow(() => assertReviewStageIdentity(early, configuration));
  assert.throws(() => assertReviewStageIdentity({ ...early, answer: { ...early.answer, stagePrompts: run.answer.stagePrompts } }, configuration), /early route/);
  assert.doesNotThrow(() => assertReviewStageIdentity({ status: "failure" }, configuration));
  assert.doesNotThrow(() => assertReviewStageIdentity({ status: "success" }, { version: "owned-answer-evaluation-v2" }));
});

test("v4 reviews bind both stages to the same evidence without accepting a generated checklist", () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const prompt = JSON.stringify({ query: fixture.query, sources: fixture.sources.map(({ id, title, excerpt }) => ({ id, title, excerpt })) });
  const router = { system: "frozen router v4", prompt };
  const writer = { system: "frozen writer v4", prompt };
  const configuration = { version: "owned-answer-evaluation-v4", intentPromptHash: sha(router.system), promptHash: sha(writer.system) };
  const intent = { entityResolved: true, measureResolved: true, wantsDestination: false, hasEvidence: true, message: "", destinationIds: [] };
  const run = { status: "success", system: writer.system, prompt,
    answer: { kind: "answer", callCount: 2, intent, stagePrompts: { intent: router, answer: writer } },
  };
  assert.doesNotThrow(() => assertReviewStageIdentity(run, configuration));
  for (const answer of [
    { ...run.answer, stagePrompts: undefined },
    { ...run.answer, stagePrompts: { intent: router } },
    { ...run.answer, callCount: 1 },
    { ...run.answer, stagePrompts: { intent: { ...router, prompt: "substituted evidence" }, answer: writer } },
    { ...run.answer, stagePrompts: { intent: { ...router, system: "different router" }, answer: writer } },
    { ...run.answer, stagePrompts: { intent: router, answer: { ...writer, prompt: JSON.stringify({ ...JSON.parse(prompt), requirements: ["invented scope"] }) } } },
    { ...run.answer, stagePrompts: { intent: router, answer: { ...writer, system: "different writer" } } },
    ...["requirements", "resolvedEntity", "resolvedMeasure"].map(key => ({ ...run.answer, intent: { ...intent, [key]: [] } })),
  ]) assert.throws(() => assertReviewStageIdentity({ ...run, answer }, configuration), /Recorded/);

  const early = { ...run, answer: { kind: "clarify", callCount: 1, intent: { ...intent, entityResolved: false, message: "Which product?" }, stagePrompts: { intent: router } } };
  assert.doesNotThrow(() => assertReviewStageIdentity(early, configuration));
  assert.throws(() => assertReviewStageIdentity({ ...early, answer: { ...early.answer, stagePrompts: run.answer.stagePrompts } }, configuration), /early route/);
  assert.doesNotThrow(() => assertReviewStageIdentity({ status: "failure" }, configuration));
  assert.throws(() => assertReviewStageIdentity(run, { ...configuration, version: "owned-answer-evaluation-v3" }), /legacy requirements/);
});


test("mixed-model catalog validation checks router and writer prices and eligibility", () => {
  const router = { id: "openai/gpt-5-mini", pricing: { input: "0.00000025", output: "0.000002" }, model_eligibility: { status: "eligible" } };
  const writer = { id: "openai/gpt-4.1-mini", pricing: { input: "0.0000004", output: "0.0000016" }, model_eligibility: { status: "eligible" } };
  assert.doesNotThrow(() => assertAnswerModelCatalog({ data: [router, writer] }, "openai/gpt-4.1-mini"));
  assert.doesNotThrow(() => assertAnswerModelCatalog({ data: [router] }, "openai/gpt-5-mini"));
  for (const data of [
    [writer], [router],
    [{ ...router, pricing: { ...router.pricing, output: "0.000003" } }, writer],
    [router, { ...writer, pricing: { ...writer.pricing, input: "0.0000005" } }],
    [{ ...router, model_eligibility: { status: "ineligible" } }, writer],
    [router, { ...writer, model_eligibility: { status: "ineligible" } }],
  ]) assert.throws(() => assertAnswerModelCatalog({ data }, "openai/gpt-4.1-mini"), /rates or eligibility changed/);
  assert.throws(() => assertAnswerModelCatalog({}, "openai/gpt-4.1-mini"), /Invalid model catalog/);
});

test("v5 reviews bind the ordered billed model for each stage while retaining early routes", () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const prompt = JSON.stringify({ query: fixture.query, sources: fixture.sources.map(({ id, title, excerpt }) => ({ id, title, excerpt })) });
  const router = { system: "frozen mixed router", prompt };
  const writer = { system: "frozen mixed writer", prompt };
  const configuration = { version: "owned-answer-evaluation-v5", intentPromptHash: sha(router.system), promptHash: sha(writer.system), intentModel: "openai/gpt-5-mini", model: "openai/gpt-4.1-mini" };
  const intent = { entityResolved: true, measureResolved: true, wantsDestination: false, hasAnswerEvidence: true, message: "", destinationIds: [] };
  const stageUsage = [{ stage: "intent", model: configuration.intentModel }, { stage: "answer", model: configuration.model }];
  const run = { status: "success", system: writer.system, prompt,
    answer: { kind: "answer", callCount: 2, intent, stagePrompts: { intent: router, answer: writer }, stageUsage },
  };
  assert.doesNotThrow(() => assertReviewStageIdentity(run, configuration));
  for (const stages of [
    undefined, [], stageUsage.slice(0, 1), [...stageUsage].reverse(),
    [{ stage: "intent" }, stageUsage[1]],
    [{ ...stageUsage[0], model: configuration.model }, stageUsage[1]],
    [stageUsage[0], { ...stageUsage[1], model: configuration.intentModel }],
  ]) assert.throws(() => assertReviewStageIdentity({ ...run, answer: { ...run.answer, stageUsage: stages } }, configuration), /Recorded stage model/);
  assert.throws(() => assertReviewStageIdentity(run, { ...configuration, intentModel: undefined }), /Recorded stage model/);
  const early = { ...run, answer: { kind: "clarify", callCount: 1, intent: { ...intent, entityResolved: false, message: "Which product?" }, stagePrompts: { intent: router }, stageUsage: stageUsage.slice(0, 1) } };
  assert.doesNotThrow(() => assertReviewStageIdentity(early, configuration));
  assert.throws(() => assertReviewStageIdentity({ ...early, answer: { ...early.answer, stageUsage } }, configuration), /Recorded stage model/);
  assert.doesNotThrow(() => assertReviewStageIdentity({ status: "failure" }, configuration));
});
