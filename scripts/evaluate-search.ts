import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertReservationFits, buildEvaluationPlan, EVALUATION_BUDGET_MICROS,
  EVALUATION_DEADLINE_MS, ledgerState, SEARCH_COST_MICROS, summarizeEvaluation,
  appendLedger, readLedger, reserveSearch, withEvaluationLock,
  type EvaluationPhase, type EvaluationQuery,
  type Settlement,
} from "../lib/evaluation.ts";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNTING_DIRECTORY = join(PROJECT_ROOT, ".evaluation");
const CORPUS_FILE = join(PROJECT_ROOT, "docs/milestone-1/evaluation-queries.json");
const POLICY_VERSION = "exa-skill-auto-highlights-brave-web-v1";

export type Options = {
  run: boolean;
  phase: EvaluationPhase;
  seed: number;
  campaign: string;
  output: string;
  limit?: number;
  retainEvidence: boolean;
  permissionReference?: string;
  help: boolean;
};

export function parseOptions(args: string[]): Options {
  const options: Options = {
    run: false, phase: "development", seed: 20_261_114, campaign: "baseline",
    output: ACCOUNTING_DIRECTORY, retainEvidence: false, help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--retain-evidence") options.retainEvidence = true;
    else if (arg === "--help") options.help = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--phase" && ["development", "holdout", "all"].includes(value)) options.phase = value as EvaluationPhase;
      else if (arg === "--campaign" && /^[a-zA-Z0-9_-]{1,64}$/.test(value)) options.campaign = value;
      else if (arg === "--output") options.output = resolve(value);
      else if (arg === "--permission-reference") options.permissionReference = value;
      else if (arg === "--seed" && /^\d+$/.test(value) && Number(value) <= 0xffff_ffff) options.seed = Number(value);
      else if (arg === "--limit" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) options.limit = Number(value);
      else throw new Error(`Unknown option or invalid value: ${arg}.`);
    }
  }
  if (options.retainEvidence && !options.permissionReference) {
    throw new Error("Evidence retention requires --permission-reference identifying the applicable permission record.");
  }
  return options;
}

function validateCorpus(value: unknown): EvaluationQuery[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { queries?: unknown }).queries)) {
    throw new Error("Evaluation corpus is malformed.");
  }
  const queries = (value as { queries: EvaluationQuery[] }).queries;
  const ids = new Set<string>();
  for (const query of queries) {
    if (!query || typeof query.id !== "string" || !/^[A-Z]+\d+$/.test(query.id) ||
        ids.has(query.id) || typeof query.query !== "string" || !query.query.trim() ||
        !["development", "holdout"].includes(query.split) ||
        typeof query.country !== "string" || !/^[A-Z]{2}$/.test(query.country)) {
      throw new Error("Evaluation corpus contains an invalid or duplicate query.");
    }
    ids.add(query.id);
  }
  return queries;
}

function safeHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error &&
      Number.isInteger(error.status) && Number(error.status) >= 400 && Number(error.status) <= 599) {
    return Number(error.status);
  }
  return undefined;
}

async function saveJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log(`Usage: node --env-file=.env.local scripts/evaluate-search.ts [options]
Default is a no-network dry run. --run explicitly enables paid requests.
  --phase development|holdout|all   Default: development
  --limit N                        Limit selected queries before repetitions
  --campaign NAME                  Frozen configuration / resumable call IDs; default baseline
  --seed N                         Fixed unsigned seed; default 20261114
  --output DIRECTORY               Artifact directory; accounting stays in project .evaluation
  --retain-evidence --permission-reference RECORD
                                   Save normalized results only with documented permission
Rerunning skips all reserved call IDs, including interrupted or failed calls.
Do not delete the shared ledger to retry. New campaigns use the same $5 allowance.`);
    return;
  }
  const corpusText = await readFile(CORPUS_FILE, "utf8");
  const queries = validateCorpus(JSON.parse(corpusText));
  const corpusHash = createHash("sha256").update(corpusText).digest("hex");
  const plan = buildEvaluationPlan(queries, options);
  const ledgerFile = join(ACCOUNTING_DIRECTORY, "ledger.jsonl");
  const entries = await readLedger(ledgerFile);
  const state = ledgerState(entries);
  const pending = plan.filter((call) => !state.reservations.has(call.callId));
  const plannedMicros = pending.reduce((sum, call) => sum + call.reservedMicros, 0);
  const sourceFiles = ["lib/search/providers.ts", "lib/search/types.ts", "lib/evaluation.ts", "scripts/evaluate-search.ts"];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
    file, createHash("sha256").update(await readFile(join(PROJECT_ROOT, file))).digest("hex"),
  ])));
  const configuration = {
    corpusHash, sourceHashes, policyVersion: POLICY_VERSION, seed: options.seed,
    deadlineMs: EVALUATION_DEADLINE_MS, ratesMicros: SEARCH_COST_MICROS,
    countryPolicy: "corpus country", recencyPolicy: "query wording; no implicit hard date filters",
    evidencePolicy: options.retainEvidence ? "retained with referenced permission" : "transient; metrics only",
    permissionReference: options.permissionReference ?? null,
  };
  const preflight = {
    dryRun: !options.run, campaign: options.campaign, corpusHash,
    plannedCalls: plan.length, alreadyReservedCalls: plan.length - pending.length,
    additionalCalls: pending.length, additionalSearchReservationUsd: plannedMicros / 1_000_000,
    committedBeforeRunUsd: state.committedMicros / 1_000_000,
    remainingAfterPlanUsd: (EVALUATION_BUDGET_MICROS - state.committedMicros - plannedMicros) / 1_000_000,
    retainsEvidence: options.retainEvidence,
  };
  console.log(JSON.stringify(preflight, null, 2));
  if (state.committedMicros + plannedMicros > EVALUATION_BUDGET_MICROS) {
    throw new Error("The selected plan does not fit the remaining shared $5 evaluation budget.");
  }
  if (!options.run) return;
  if (!pending.length) {
    console.log(JSON.stringify(summarizeEvaluation(entries, options.campaign), null, 2));
    return;
  }
  const keys = { exa: process.env.EXA_API_KEY, brave: process.env.BRAVE_SEARCH_API_KEY };
  for (const provider of new Set(pending.map((call) => call.provider))) {
    if (!keys[provider]?.trim()) throw new Error(`Missing ${provider === "exa" ? "EXA_API_KEY" : "BRAVE_SEARCH_API_KEY"}.`);
  }
  // Late import keeps dry runs and accounting tests independent of live integration code.
  const { searchWeb } = await import("../lib/search/providers.ts");
  await withEvaluationLock(ACCOUNTING_DIRECTORY, async () => {
    const currentEntries = await readLedger(ledgerFile);
    const currentState = ledgerState(currentEntries);
    const remaining = plan.filter((call) => !currentState.reservations.has(call.callId));
    const requiredMicros = remaining.reduce((sum, call) => sum + call.reservedMicros, 0);
    if (requiredMicros) assertReservationFits(currentEntries, requiredMicros);
    const campaignDirectory = join(ACCOUNTING_DIRECTORY, "campaigns", options.campaign);
    await mkdir(campaignDirectory, { recursive: true, mode: 0o700 });
    const configurationFile = join(campaignDirectory, "configuration.json");
    try {
      const previous = JSON.parse(await readFile(configurationFile, "utf8"));
      if (JSON.stringify(previous) !== JSON.stringify(configuration)) {
        throw new Error("Frozen campaign configuration differs. Use an explicit new --campaign, sharing the same budget.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") await saveJson(configurationFile, configuration);
      else throw error;
    }
    const invocationId = randomUUID();
    const artifactDirectory = join(options.output, options.campaign, invocationId);
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    let commit: string | null = null;
    let workingTreeDirty: boolean | null = null;
    try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { /* The corpus and configuration hashes still identify this invocation. */ }
    try { workingTreeDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()); }
    catch { /* Source hashes remain authoritative when Git status is unavailable. */ }
    await saveJson(join(artifactDirectory, "manifest.json"), {
      invocationId, campaign: options.campaign, startedAt: new Date().toISOString(),
      commit, workingTreeDirty, configuration, phase: options.phase, limit: options.limit ?? null,
      plannedCallIds: remaining.map((call) => call.callId),
      runtime: process.version, platform: process.platform,
      executionRegion: process.env.EVALUATION_REGION ?? "not recorded",
      dataHandling: "No raw errors, keys, or provider payloads are logged. Evidence retention is opt-in.",
    });
    let stopRequested = false;
    let activeController: AbortController | undefined;
    const stop = () => { stopRequested = true; activeController?.abort(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      for (const call of remaining) {
        if (stopRequested) break;
        if (!await reserveSearch(ledgerFile, currentEntries, call, invocationId)) continue;
        activeController = new AbortController();
        let deadlineReached = false;
        const started = performance.now();
        const timer = setTimeout(() => { deadlineReached = true; activeController?.abort(); }, EVALUATION_DEADLINE_MS);
        const settlement: Settlement = {
          kind: "settle", callId: call.callId, invocationId, at: new Date().toISOString(),
          amountMicros: call.reservedMicros, status: "provider_error", elapsedMs: 0, resultCount: 0,
        };
        try {
          const response = await searchWeb(call.query.query, {
            provider: call.provider, apiKey: keys[call.provider]!, country: call.query.country,
            signal: activeController.signal,
          });
          settlement.elapsedMs = performance.now() - started;
          settlement.status = stopRequested ? "cancelled" : deadlineReached || settlement.elapsedMs > EVALUATION_DEADLINE_MS ? "timeout" : "success";
          settlement.resultCount = response.results.length;
          settlement.normalizedPayloadBytes = Buffer.byteLength(JSON.stringify(response.results));
          settlement.evidenceCharacters = response.results.reduce((sum, result) => sum + result.excerpt.length, 0);
          if (response.requestId && /^[a-zA-Z0-9_:-]{1,160}$/.test(response.requestId)) {
            settlement.providerRequestId = response.requestId;
          }
          if (response.reportedCostUsd !== undefined && Number.isFinite(response.reportedCostUsd) && response.reportedCostUsd >= 0) {
            settlement.reportedCostMicros = Math.ceil(response.reportedCostUsd * 1_000_000);
            settlement.amountMicros = Math.max(settlement.amountMicros, settlement.reportedCostMicros);
          }
          if (options.retainEvidence && settlement.status === "success") {
            const filename = createHash("sha256").update(call.callId).digest("hex");
            await saveJson(join(artifactDirectory, `evidence-${filename}.json`), {
              callId: call.callId, queryId: call.query.id, provider: call.provider,
              results: response.results, permissionReference: options.permissionReference,
            });
          }
        } catch (error) {
          settlement.elapsedMs = performance.now() - started;
          settlement.status = stopRequested ? "cancelled" : deadlineReached ? "timeout" : "provider_error";
          settlement.httpStatus = safeHttpStatus(error);
        } finally {
          clearTimeout(timer);
          activeController = undefined;
        }
        settlement.at = new Date().toISOString();
        await appendLedger(ledgerFile, settlement);
        currentEntries.push(settlement);
        console.log(`${call.query.id} ${call.provider} repetition=${call.repetition} ${settlement.status} ${Math.round(settlement.elapsedMs)}ms`);
        if (settlement.httpStatus && [401, 402, 403, 429].includes(settlement.httpStatus)) {
          console.log(`Stopped after ${call.provider} returned HTTP ${settlement.httpStatus}; resolve access, balance, or rate limits before further calls.`);
          break;
        }
        if (ledgerState(currentEntries).committedMicros >= EVALUATION_BUDGET_MICROS) break;
      }
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      const summary = summarizeEvaluation(currentEntries, options.campaign);
      await saveJson(join(artifactDirectory, "summary.json"), summary);
      console.log(JSON.stringify(summary, null, 2));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    // All errors generated by this runner are controlled. Never print a provider body or stack.
    console.error(error instanceof Error ? error.message : "Evaluation failed.");
    process.exitCode = 1;
  });
}
