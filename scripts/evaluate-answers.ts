import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { EVALUATION_BUDGET_MICROS, ledgerState, percentile, readLedger, type MeteringProgress } from "../lib/evaluation.ts";
import type { AnswerCorpus, AnswerFixture } from "../fixtures/answers/types.ts";
import type { AnswerContentEvent, AnswerGeneration, AnswerSource } from "../lib/answer/types.ts";
import { ANSWER_MODEL_RATES, ANSWER_RESERVATION_MICROS, ANSWER_DEADLINE_MS, ANSWER_MAX_INPUT_TOKENS, ANSWER_MAX_OUTPUT_TOKENS, ANSWER_MAX_TOTAL_INPUT_TOKENS, ANSWER_MAX_TOTAL_OUTPUT_TOKENS, ANSWER_MAX_CALLS, INTENT_MAX_OUTPUT_TOKENS, DEFAULT_ANSWER_MODEL, DEFAULT_INTENT_MODEL, answerModelSettings } from "../lib/answer/model.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTORY = join(ROOT, ".evaluation");
const CORPUS_DIRECTORY = join(ROOT, "fixtures/answers");
const RESERVATION_MICROS = ANSWER_RESERVATION_MICROS;
const CAMPAIGN_CAP_MICROS = 300_000;
const CAMPAIGN_CASE_CAP = 12;
// Conservative pacing for this free-tier pilot; a 429 stops the campaign, never retries it.
const REQUEST_START_INTERVAL_MS = 30_000;
const DEADLINE_MS = ANSWER_DEADLINE_MS;
const MODELS = ANSWER_MODEL_RATES;

type ModelId = keyof typeof MODELS;
export type AnswerEvaluationOptions = {
  run: boolean;
  campaign: string;
  corpus: string;
  phase: "development" | "holdout" | "all";
  model: ModelId;
  review?: string;
  help: boolean;
};
export function parseAnswerOptions(args: string[]): AnswerEvaluationOptions {
  const options: AnswerEvaluationOptions = {
    run: false, campaign: "answers-v1", corpus: "corpus", phase: "development", model: DEFAULT_ANSWER_MODEL, help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--help") options.help = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--campaign" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) options.campaign = value;
      else if (arg === "--corpus" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) options.corpus = value;
      else if (arg === "--phase" && ["development", "holdout", "all"].includes(value)) options.phase = value as AnswerEvaluationOptions["phase"];
      else if (arg === "--model" && Object.hasOwn(MODELS, value)) options.model = value as ModelId;
      else if (arg === "--review") options.review = resolve(value);
      else throw new Error(`Unknown argument or unsupported value: ${arg}.`);
    }
  }
  if (options.run && options.review) throw new Error("Review mode cannot dispatch paid requests.");
  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validateAnswerCorpus(value: unknown): AnswerCorpus {
  if (!isRecord(value) || typeof value.version !== "string" || typeof value.ownership !== "string" || !Array.isArray(value.cases) || !value.cases.length) {
    throw new Error("Invalid owned-evidence corpus.");
  }
  const ids = new Set<string>();
  for (const item of value.cases) {
    if (!isRecord(item) || typeof item.id !== "string" || !/^ANS\d{2}$/.test(item.id) || ids.has(item.id) ||
        typeof item.split !== "string" || !["development", "holdout"].includes(item.split) || typeof item.query !== "string" || !item.query.trim() ||
        !Array.isArray(item.sources) || item.sources.length > 5 || !isRecord(item.expected) ||
        typeof item.expected.kind !== "string" || !["answer", "navigation", "clarify", "insufficient"].includes(item.expected.kind) ||
        !Array.isArray(item.expected.facets) || item.expected.facets.length < 1 || !Array.isArray(item.expected.forbiddenClaims)) {
      throw new Error("Invalid or duplicate answer fixture.");
    }
    ids.add(item.id);
    const sourceIds = new Set<string>();
    for (const source of item.sources) {
      if (!isRecord(source) || typeof source.id !== "string" || !/^S[1-5]$/.test(source.id) || sourceIds.has(source.id) ||
          typeof source.title !== "string" || !source.title || typeof source.excerpt !== "string" || !source.excerpt ||
          typeof source.url !== "string" || !source.url.startsWith("https://example.com/joysearch-fixtures/")) {
        throw new Error("Fixtures must contain bounded, authored evidence under the reserved example.com namespace.");
      }
      sourceIds.add(source.id);
    }
    const facetIds = new Set<string>();
    for (const facet of item.expected.facets) {
      if (!isRecord(facet) || typeof facet.id !== "string" || !facet.id || facetIds.has(facet.id) ||
          typeof facet.description !== "string" || !Array.isArray(facet.sourceIds) ||
          !facet.sourceIds.every((id) => typeof id === "string" && sourceIds.has(id))) throw new Error("Invalid evidence criteria.");
      facetIds.add(facet.id);
    }
    if (!item.expected.forbiddenClaims.every((claim) => typeof claim === "string") ||
        (item.expected.forbiddenOutputStrings !== undefined && (!Array.isArray(item.expected.forbiddenOutputStrings) ||
         !item.expected.forbiddenOutputStrings.every((marker) => typeof marker === "string" && marker)))) {
      throw new Error("Invalid forbidden-output criteria.");
    }
  }
  return value as unknown as AnswerCorpus;
}

export function checkAnswerStructure(fixture: AnswerFixture, answer: AnswerGeneration, sources: AnswerSource[]) {
  const known = new Set(sources.map((source) => source.id));
  const citations = answer.claims.flatMap((claim) => claim.sourceIds);
  const validCitations = citations.filter((id) => known.has(id));
  const renderedText = [...answer.claims.map((claim) => claim.text), answer.message ?? ""].join("\n");
  return {
    kindMatchesExpected: answer.kind === fixture.expected.kind,
    claims: answer.claims.length,
    citations: citations.length,
    validCitations: validCitations.length,
    citationValidity: citations.length ? validCitations.length / citations.length : null,
    allClaimsHaveKnownCitations: answer.claims.every((claim) => claim.sourceIds.length > 0 && claim.sourceIds.every((id) => known.has(id))),
    forbiddenOutputStringFound: (fixture.expected.forbiddenOutputStrings ?? []).some((marker) => renderedText.includes(marker)),
    semanticSupport: "not_automatically_measured" as const,
    taskCompletion: "requires_review" as const,
  };
}

type RunRecord = {
  caseId: string;
  split: AnswerFixture["split"];
  query: string;
  category: string;
  callId: string;
  model: string;
  startedAt: string;
  preparedSources: AnswerSource[];
  prompt: string;
  system: string;
  inputTokenUpperBound: number;
  discardedBytes: number;
  promptHash: string;
  expected: AnswerFixture["expected"];
  elapsedMs: number;
  firstCitedClaimMs: number | null;
  routingElapsedMs?: number;
  events: AnswerContentEvent[];
  status: "success" | "failure";
  metering?: MeteringProgress;
  answer?: AnswerGeneration;
  structure?: ReturnType<typeof checkAnswerStructure>;
  failure?: { name: string; message: string; httpStatus?: number };
};

type ReviewRecord = {
  caseId: string;
  outcomeAppropriate: boolean;
  criticalInventedClaim: boolean;
  claimSupport: { claimIndex: number; support: "full" | "partial" | "unsupported" | "contradicted"; reason: string }[];
  facets: { id: string; covered: boolean; reason: string }[];
};
export type SemanticReview = { reviewer: string; reviewedAt: string; method: string; records: ReviewRecord[] };

export function summarizeSemanticReview(value: unknown, runs: RunRecord[]) {
  if (!isRecord(value) || typeof value.reviewer !== "string" || !value.reviewer.trim() ||
      typeof value.reviewedAt !== "string" || !Number.isFinite(Date.parse(value.reviewedAt)) ||
      typeof value.method !== "string" || !value.method.trim() || !Array.isArray(value.records)) throw new Error("A named, dated review with an explicit method is required.");
  const review = value as unknown as SemanticReview;
  const records = new Map<string, ReviewRecord>();
  for (const entry of review.records) {
    if (!entry || records.has(entry.caseId) || !runs.some((run) => run.caseId === entry.caseId) ||
        typeof entry.outcomeAppropriate !== "boolean" || typeof entry.criticalInventedClaim !== "boolean" ||
        !Array.isArray(entry.claimSupport) || !Array.isArray(entry.facets)) throw new Error("Incomplete or duplicate semantic review.");
    records.set(entry.caseId, entry);
  }
  const scores: { caseId: string; support: number | null; taskComplete: boolean; criticalInventedClaim: boolean }[] = [];
  let pooledSupported = 0;
  let pooledClaims = 0;
  for (const run of runs) {
    const entry = records.get(run.caseId);
    if (!entry) throw new Error(`Missing semantic review for ${run.caseId}.`);
    const claims = run.answer?.claims ?? [];
    const indexes = new Set<number>();
    for (const claim of entry.claimSupport) {
      if (!Number.isInteger(claim.claimIndex) || claim.claimIndex < 0 || claim.claimIndex >= claims.length || indexes.has(claim.claimIndex) ||
          !["full", "partial", "unsupported", "contradicted"].includes(claim.support) || typeof claim.reason !== "string" || !claim.reason.trim()) {
        throw new Error("Every rendered claim needs one evidence-backed support grade.");
      }
      indexes.add(claim.claimIndex);
    }
    if (indexes.size !== claims.length) throw new Error("Semantic support review is incomplete.");
    const expectedFacets = new Set(run.expected.facets.map((facet) => facet.id));
    const facetIds = new Set<string>();
    for (const facet of entry.facets) {
      if (!expectedFacets.has(facet.id) || facetIds.has(facet.id) || typeof facet.covered !== "boolean" || typeof facet.reason !== "string" || !facet.reason.trim()) {
        throw new Error("Every expected facet needs one justified coverage grade.");
      }
      facetIds.add(facet.id);
    }
    if (facetIds.size !== expectedFacets.size) throw new Error("Task coverage review is incomplete.");
    const supported = entry.claimSupport.filter((claim) => claim.support === "full").length;
    pooledSupported += supported;
    pooledClaims += claims.length;
    scores.push({
      caseId: run.caseId,
      support: claims.length ? supported / claims.length : null,
      taskComplete: run.status === "success" && run.answer?.kind === run.expected.kind && entry.outcomeAppropriate && entry.facets.every((facet) => facet.covered) && !entry.criticalInventedClaim,
      criticalInventedClaim: entry.criticalInventedClaim,
    });
  }
  const applicable = scores.filter((score) => score.support !== null);
  return {
    status: "reviewed", reviewer: review.reviewer, reviewedAt: review.reviewedAt, method: review.method,
    reviewedCases: scores.length,
    macroClaimSupport: applicable.length ? applicable.reduce((sum, score) => sum + score.support!, 0) / applicable.length : null,
    pooledSupportedClaims: pooledSupported, pooledClaims,
    completedTasks: scores.filter((score) => score.taskComplete).length,
    criticalInventedClaims: scores.filter((score) => score.criticalInventedClaim).length,
    cases: scores,
    limitation: "A valid source ID establishes a link, not factual support. These are authored fixtures and reviewer judgments, not a real-web accuracy benchmark.",
  };
}

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Reviews use recorded passages, but cannot silently substitute another run or rubric. */
export function assertReviewRunIdentity(value: unknown, fixture: AnswerFixture, options: Pick<AnswerEvaluationOptions, "campaign" | "model">): asserts value is RunRecord {
  if (!isRecord(value) || value.caseId !== fixture.id || value.split !== fixture.split || value.model !== options.model ||
      value.callId !== `answers/${options.campaign}/${options.model}/${fixture.id}` ||
      value.query !== fixture.query.trim().replace(/\s+/g, " ") || JSON.stringify(value.expected) !== JSON.stringify(fixture.expected) ||
      !Array.isArray(value.preparedSources) || value.preparedSources.length > 5 ||
      new Set(value.preparedSources.map(source => isRecord(source) ? source.id : undefined)).size !== value.preparedSources.length ||
      !value.preparedSources.every(source => isRecord(source) &&
        fixture.sources.some(original => original.id === source.id && original.url === source.url &&
          typeof source.title === "string" && original.title.trim().startsWith(source.title) &&
          typeof source.excerpt === "string" && original.excerpt.trim().startsWith(source.excerpt)))) {
    throw new Error("Recorded answer identity or evidence does not match the selected corpus and campaign.");
  }
  if (typeof value.system !== "string" || typeof value.prompt !== "string" || value.promptHash !== hash(value.system + "\n" + value.prompt) ||
      value.prompt !== JSON.stringify({ query: value.query, sources: value.preparedSources.map(source => {
        const { id, title, excerpt } = source as AnswerSource;
        return { id, title, excerpt };
      }) })) {
    throw new Error("Recorded prompt does not match its prepared evidence and hash.");
  }
}

/** Bind both recorded stage inputs without recomputing prompts using a newer implementation. */
export function assertReviewStageIdentity(value: unknown, configuration: Record<string, unknown>): void {
  // Earlier campaigns made one call and did not record routing inputs.
  const legacyChecklist = configuration.version === "owned-answer-evaluation-v3";
  const mixedModels = configuration.version === "owned-answer-evaluation-v5";
  if (!legacyChecklist && configuration.version !== "owned-answer-evaluation-v4" && !mixedModels) return;
  if (!isRecord(value) || typeof value.status !== "string" || !["success", "failure"].includes(value.status)) {
    throw new Error("Recorded stage data is invalid.");
  }
  // A failed request may never have produced a parsed intent or writer prompt.
  if (value.status === "failure") return;
  const answer = value.answer;
  if (!isRecord(answer) || typeof answer.kind !== "string" ||
      !["answer", "navigation", "clarify", "insufficient"].includes(answer.kind) ||
      !isRecord(answer.intent) ||
      !isRecord(answer.stagePrompts) || !isRecord(answer.stagePrompts.intent)) {
    throw new Error("Recorded stage data is missing or invalid.");
  }
  if (mixedModels) {
    const expectedStages = answer.kind === "answer"
      ? [{ stage: "intent", model: configuration.intentModel }, { stage: "answer", model: configuration.model }]
      : [{ stage: "intent", model: configuration.intentModel }];
    const recordedStages = answer.stageUsage;
    if (!Array.isArray(recordedStages) || recordedStages.length !== expectedStages.length ||
        !expectedStages.every((expected, index) => {
          const recorded = recordedStages[index];
          return typeof expected.model === "string" && expected.model.length > 0 && isRecord(recorded) &&
            recorded.stage === expected.stage && recorded.model === expected.model;
        })) throw new Error("Recorded stage model does not match the frozen campaign.");
  }
  const intent = answer.intent;
  if (legacyChecklist) {
    if (!Array.isArray(intent.requirements) || !intent.requirements.every(item => typeof item === "string")) {
      throw new Error("Recorded legacy requirements are missing or invalid.");
    }
  } else if (["requirements", "resolvedEntity", "resolvedMeasure"].some(key => Object.hasOwn(intent, key))) {
    throw new Error("Recorded routing data contains fields removed from this campaign version.");
  }
  const router = answer.stagePrompts.intent;
  if (typeof router.system !== "string" || hash(router.system) !== configuration.intentPromptHash ||
      typeof value.prompt !== "string" || router.prompt !== value.prompt) {
    throw new Error("Recorded routing prompt does not match the frozen evidence and configuration.");
  }
  if (answer.kind !== "answer") {
    if (answer.callCount !== 1 || answer.stagePrompts.answer !== undefined) {
      throw new Error("Recorded early route unexpectedly contains a writer stage.");
    }
    return;
  }
  const writer = answer.stagePrompts.answer;
  const writerPrompt = legacyChecklist
    ? JSON.stringify({ ...JSON.parse(value.prompt), requirements: intent.requirements })
    : value.prompt;
  if (answer.callCount !== 2 || !isRecord(writer) || typeof writer.system !== "string" ||
      hash(writer.system) !== configuration.promptHash || writer.system !== value.system ||
      writer.prompt !== writerPrompt) {
    throw new Error("Recorded writer prompt does not match the frozen stage input.");
  }
}
/** Verify every potentially billed model before either stage can dispatch. */
export function assertAnswerModelCatalog(catalog: unknown, writerModel: ModelId): void {
  if (!isRecord(catalog) || !Array.isArray(catalog.data)) throw new Error("Invalid model catalog.");
  for (const id of new Set<ModelId>([DEFAULT_INTENT_MODEL, writerModel])) {
    const selected = catalog.data.find((model) => isRecord(model) && model.id === id);
    const rates = MODELS[id];
    if (!isRecord(selected) || !isRecord(selected.pricing) ||
        Number(selected.pricing.input) !== rates.input || Number(selected.pricing.output) !== rates.output ||
        !isRecord(selected.model_eligibility) || selected.model_eligibility.status !== "eligible") {
      throw new Error("Model rates or eligibility changed; no inference request made.");
    }
  }
}
async function saveJson(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}
async function readOptional(file: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
function campaignCommitted(entries: Awaited<ReturnType<typeof readLedger>>, campaign: string) {
  const state = ledgerState(entries);
  const reservations = [...state.reservations.values()].filter((entry) => entry.callId.startsWith(`answers/${campaign}/`));
  return { calls: reservations.length, micros: reservations.reduce((sum, reservation) => sum + Math.max(reservation.amountMicros, state.settlements.get(reservation.callId)?.amountMicros ?? 0), 0) };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseAnswerOptions(args);
  if (options.help) {
    console.log(`Usage: node --env-file=.env.local scripts/evaluate-answers.ts [options]
Default is a network-free development-plan preview.
  --run                       Explicitly dispatch bounded paid generations
  --phase development|holdout|all  Default: development; one attempt per case/model
  --campaign NAME             Frozen prompt/configuration and replay-safe IDs
  --corpus NAME               fixtures/answers/NAME.json; default: corpus
  --model MODEL               Writer model; default ${DEFAULT_ANSWER_MODEL}; router fixed to ${DEFAULT_INTENT_MODEL}
  --review FILE               Score a completed review without paid calls
Own evidence only. No search calls, no model judge, no hidden retries.
Maximum $0.30 and 12 cases (at most 24 model calls) per campaign; all share the original $5 ledger.
Cases start at least 30 seconds apart. Stop on authentication, credit, rate-limit,
or three consecutive protocol failures; do not automatically retry.
Previously reserved IDs are never silently retried, including failed/interrupted calls.`);
    return;
  }
  const corpusFile = await realpath(join(CORPUS_DIRECTORY, `${options.corpus}.json`));
  if (dirname(corpusFile) !== await realpath(CORPUS_DIRECTORY)) throw new Error("Corpus must remain inside fixtures/answers.");
  const corpusText = await readFile(corpusFile, "utf8");
  const corpus = validateAnswerCorpus(JSON.parse(corpusText));
  const selected = corpus.cases.filter((item) => options.phase === "all" || item.split === options.phase);
  if (!selected.length) throw new Error("The selected corpus has no cases for this phase.");
  const prefix = `answers/${options.campaign}/${options.model}`;
  const output = join(DIRECTORY, "answers", options.campaign, options.model.replaceAll("/", "--"));
  const ledgerFile = join(DIRECTORY, "ledger.jsonl");
  const entries = await readLedger(ledgerFile);
  const state = ledgerState(entries);
  const pending = selected.filter((item) => !state.reservations.has(`${prefix}/${item.id}`));
  const campaign = campaignCommitted(entries, options.campaign);
  const addedMicros = pending.length * RESERVATION_MICROS;
  if (options.review) {
    const configuration = await readOptional(join(output, "configuration.json"));
    if (!isRecord(configuration) || configuration.corpusHash !== hash(corpusText) || configuration.model !== options.model ||
        (configuration.corpusName !== undefined && configuration.corpusName !== options.corpus)) {
      throw new Error("Review corpus or model does not match the recorded campaign.");
    }
    const runs: RunRecord[] = [];
    for (const item of selected) {
      const record = await readOptional(join(output, `${item.id}.json`));
      if (!record) throw new Error(`Missing generation artifact for ${item.id}; cannot grade an unseen answer.`);
      assertReviewRunIdentity(record, item, options);
      if (hash(record.system) !== configuration.promptHash) throw new Error("Recorded system prompt does not match the frozen campaign.");
      assertReviewStageIdentity(record, configuration);
      runs.push(record);
    }
    const summary = summarizeSemanticReview(JSON.parse(await readFile(options.review, "utf8")), runs);
    await mkdir(output, { recursive: true });
    await saveJson(join(output, `semantic-review-${options.phase}.json`), summary);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(JSON.stringify({
    dryRun: !options.run, corpusName: options.corpus, corpusHash: hash(corpusText), campaign: options.campaign, model: options.model, intentModel: DEFAULT_INTENT_MODEL,
    phase: options.phase, selectedCases: selected.length, pendingCalls: pending.length,
    additionalReservationUsd: addedMicros / 1e6, conservativeCommittedUsd: state.committedMicros / 1e6,
    remainingAfterPlanUsd: (EVALUATION_BUDGET_MICROS - state.committedMicros - addedMicros) / 1e6,
    campaignCapUsd: CAMPAIGN_CAP_MICROS / 1e6, semanticSupport: "requires_complete_review",
    requestStartIntervalMs: REQUEST_START_INTERVAL_MS,
    maximumAdditionalModelCalls: pending.length * ANSWER_MAX_CALLS,
  }, null, 2));
  if (campaign.calls + pending.length > CAMPAIGN_CASE_CAP || campaign.micros + addedMicros > CAMPAIGN_CAP_MICROS ||
      state.committedMicros + addedMicros > EVALUATION_BUDGET_MICROS) throw new Error("Answer plan exceeds the campaign or shared evaluation budget.");
  if (!options.run) return;
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) throw new Error("Missing AI_GATEWAY_API_KEY.");
  // This read is free; paid work stops if the current rate or team eligibility differs.
  const catalogResponse = await fetch("https://ai-gateway.vercel.sh/v1/models?include_availability", {
    headers: { Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!catalogResponse.ok) throw new Error("Cannot verify model rates and eligibility.");
  const catalog: unknown = await catalogResponse.json();
  assertAnswerModelCatalog(catalog, options.model);
  const rateVerifiedAt = new Date().toISOString();
  const { prepareEvidence, ANSWER_SYSTEM_PROMPT, generateCitedAnswer } = await import("../lib/answer/generate.ts");
  const { INTENT_SYSTEM_PROMPT, INTENT_SCHEMA } = await import("../lib/answer/route-intent.ts");
  const { withMeteredEvaluation } = await import("../lib/evaluation.ts");
  const prepared = selected.map((fixture) => ({ fixture, evidence: prepareEvidence(fixture.query, fixture.sources) }));
  const files = ["lib/answer/generate.ts", "lib/answer/route-intent.ts", "lib/answer/protocol.ts", "lib/answer/types.ts", "lib/answer/model.ts", "lib/evaluation.ts", "scripts/evaluate-answers.ts"];
  const sourceHashes = Object.fromEntries(await Promise.all(files.map(async (file) => [file, hash(await readFile(join(ROOT, file)))])));
  const configuration = {
    version: "owned-answer-evaluation-v5", corpusName: options.corpus, corpusHash: hash(corpusText), promptHash: hash(ANSWER_SYSTEM_PROMPT), sourceHashes,
    intentPromptHash: hash(INTENT_SYSTEM_PROMPT), intentSchemaHash: hash(JSON.stringify(INTENT_SCHEMA)),
    model: options.model, rates: MODELS[options.model], reservationMicros: RESERVATION_MICROS,
    modelSettings: answerModelSettings(options.model),
    intentModel: DEFAULT_INTENT_MODEL, intentModelRates: MODELS[DEFAULT_INTENT_MODEL], intentModelSettings: answerModelSettings(DEFAULT_INTENT_MODEL),
    maximumEstimatedCostUsd: ANSWER_MAX_INPUT_TOKENS * (MODELS[DEFAULT_INTENT_MODEL].input + MODELS[options.model].input) +
      INTENT_MAX_OUTPUT_TOKENS * MODELS[DEFAULT_INTENT_MODEL].output + ANSWER_MAX_OUTPUT_TOKENS * MODELS[options.model].output,
    inputTokenUpperBound: ANSWER_MAX_INPUT_TOKENS, maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS, deadlineMs: DEADLINE_MS, retryCount: 0,
    intentMaxOutputTokens: INTENT_MAX_OUTPUT_TOKENS, maximumModelCalls: ANSWER_MAX_CALLS,
    aggregateInputTokenUpperBound: ANSWER_MAX_TOTAL_INPUT_TOKENS, aggregateOutputTokenUpperBound: ANSWER_MAX_TOTAL_OUTPUT_TOKENS,
    requestStartIntervalMs: REQUEST_START_INTERVAL_MS,
    evidencePolicy: "owned synthetic documents; no retrieval or model judge; responses retained for manual support review",
  };
  await mkdir(output, { recursive: true, mode: 0o700 });
  const configurationFile = join(output, "configuration.json");
  const previous = await readOptional(configurationFile);
  if (previous && JSON.stringify(previous) !== JSON.stringify(configuration)) throw new Error("Frozen answer configuration changed. Use a new campaign; historical results remain unchanged.");
  if (!previous) await saveJson(configurationFile, configuration);
  let commit = "unknown";
  let dirty = true;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    dirty = !!execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch { /* Source hashes remain authoritative without Git. */ }
  await saveJson(join(output, `manifest-${options.phase}.json`), {
    startedAt: new Date().toISOString(), phase: options.phase, commit, dirtyWorkingTree: dirty, rateVerifiedAt,
    configuration, selectedCaseIds: selected.map((item) => item.id), localTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    networkRegion: "unverified local host", repeatedQueryCacheState: "uncontrolled", paidCallsAreSequential: true,
  });
  let lastDispatch = -Infinity;
  let consecutiveProtocolFailures = 0;
  for (const { fixture, evidence } of prepared) {
    const callId = `${prefix}/${fixture.id}`;
    const current = await readLedger(ledgerFile);
    if (ledgerState(current).reservations.has(callId)) continue;
    const currentCampaign = campaignCommitted(current, options.campaign);
    if (currentCampaign.calls >= CAMPAIGN_CASE_CAP || currentCampaign.micros + RESERVATION_MICROS > CAMPAIGN_CAP_MICROS) throw new Error("Answer campaign allowance exhausted.");
    await delay(Math.max(0, REQUEST_START_INTERVAL_MS - (performance.now() - lastDispatch)));
    const record: RunRecord = {
      caseId: fixture.id, split: fixture.split, query: evidence.query, category: fixture.category, callId, model: options.model,
      startedAt: new Date().toISOString(), preparedSources: evidence.sources, system: evidence.system, prompt: evidence.prompt,
      inputTokenUpperBound: evidence.inputTokenUpperBound, discardedBytes: evidence.discardedBytes,
      promptHash: hash(evidence.system + "\n" + evidence.prompt), expected: fixture.expected,
      elapsedMs: 0, firstCitedClaimMs: null, events: [], status: "failure",
    };
    const started = performance.now();
    lastDispatch = started;
    try {
      const answer = await withMeteredEvaluation({ directory: DIRECTORY, callId, provider: "ai-gateway", reservedMicros: RESERVATION_MICROS }, report => generateCitedAnswer({
        query: evidence.query, sources: evidence.sources, model: options.model, apiKey: process.env.AI_GATEWAY_API_KEY,
        signal: AbortSignal.timeout(DEADLINE_MS),
        onMetering(progress) {
          if (progress.callCount === 1 && progress.usageComplete && record.routingElapsedMs === undefined) {
            record.routingElapsedMs = performance.now() - started;
          }
          record.metering = structuredClone(progress);
          report(progress);
        },
        onEvent(event) {
          if (event.type === "claim" && record.firstCitedClaimMs === null) record.firstCitedClaimMs = performance.now() - started;
          record.events.push(event);
        },
      }));
      record.answer = answer;
      record.structure = checkAnswerStructure(fixture, answer, evidence.sources);
      record.status = "success";
    } catch (error) {
      const candidate = error as { name?: string; status?: number; statusCode?: number };
      const status = candidate.statusCode ?? candidate.status;
      record.failure = { name: candidate.name ?? "Error", message: "Generation failed; the reservation is retained and the call is not retried.", httpStatus: Number.isInteger(status) ? status : undefined };
    } finally {
      record.elapsedMs = performance.now() - started;
      await saveJson(join(output, `${fixture.id}.json`), record);
      console.log(JSON.stringify({ caseId: fixture.id, status: record.status, kind: record.answer?.kind, firstCitedClaimMs: record.firstCitedClaimMs, elapsedMs: record.elapsedMs }));
    }
    if (record.failure?.httpStatus && [401, 402, 403, 429].includes(record.failure.httpStatus)) break;
    consecutiveProtocolFailures = record.failure?.name === "AnswerProtocolError" ? consecutiveProtocolFailures + 1 : 0;
    if (consecutiveProtocolFailures >= 3) break;
  }
  const runs = (await Promise.all(selected.map(async (item) => readOptional(join(output, `${item.id}.json`))))).filter((item): item is RunRecord => !!item);
  const successes = runs.filter((run) => run.status === "success");
  const structures = successes.flatMap((run) => run.structure ? [run.structure] : []);
  const totalCitations = structures.reduce((sum, item) => sum + item.citations, 0);
  const validCitations = structures.reduce((sum, item) => sum + item.validCitations, 0);
  const finalState = ledgerState(await readLedger(ledgerFile));
  const summary = {
    selectedCases: selected.length, recordedCases: runs.length, validResponses: successes.length,
    knownModelCallAttempts: runs.reduce((sum, run) => sum + (run.metering?.callCount ?? 0), 0),
    failures: runs.filter((run) => run.status === "failure").length, missingArtifacts: selected.length - runs.length,
    matchingExpectedKinds: structures.filter((item) => item.kindMatchesExpected).length,
    validCitations, totalCitations, citationValidity: totalCitations ? validCitations / totalCitations : null,
    forbiddenOutputLeaks: structures.filter((item) => item.forbiddenOutputStringFound).length,
    successfulResponseMedianMs: percentile(successes.map((run) => run.elapsedMs), 0.5),
    successfulResponseP95Ms: percentile(successes.map((run) => run.elapsedMs), 0.95),
    firstCitedClaimP95Ms: percentile(successes.flatMap((run) => run.firstCitedClaimMs === null ? [] : [run.firstCitedClaimMs]), 0.95),
    routingP95Ms: percentile(runs.flatMap(run => typeof run.routingElapsedMs === "number" &&
      Number.isFinite(run.routingElapsedMs) && run.routingElapsedMs >= 0 ? [run.routingElapsedMs] : []), 0.95),
    conservativeCommittedUsd: finalState.committedMicros / 1e6, remainingSharedBudgetUsd: (EVALUATION_BUDGET_MICROS - finalState.committedMicros) / 1e6,
    semanticReview: { status: "not_performed", citationSupport: null, taskCompletion: null, criticalInventedClaims: null },
    limitations: ["Authored supplied-evidence cases do not measure search relevance or real-web accuracy.", "Valid IDs are not proof of supported claims.", "Small single-host timings exclude retrieval and browser rendering; no availability SLA is inferred.", "Failures and interrupted reservations cannot be silently rerun."],
  };
  await saveJson(join(output, `summary-${options.phase}.json`), summary);
  const reviewTemplate = {
    reviewer: "", reviewedAt: "", method: "", records: runs.map((run) => ({
      caseId: run.caseId, outcomeAppropriate: null, criticalInventedClaim: null,
      claimSupport: (run.answer?.claims ?? []).map((claim, claimIndex) => ({ claimIndex, claim: claim.text, sourceIds: claim.sourceIds, support: null, reason: "" })),
      facets: run.expected.facets.map((facet) => ({ id: facet.id, description: facet.description, covered: null, reason: "" })),
    })),
  };
  const templateFile = join(output, `review-template-${options.phase}.json`);
  if (!await readOptional(templateFile)) await saveJson(templateFile, reviewTemplate);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Answer evaluation stopped. Check credentials, frozen configuration, and budget; no automatic retry."); process.exitCode = 1; });
}
