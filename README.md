# JoySearch

A responsive web-search application built with **Next.js App Router**, **React**, **TypeScript**, and **Tailwind CSS**. JoySearch searches Exa and can stream an optional answer with inspectable citations through Vercel AI Gateway.

This personal portfolio project demonstrates engineering judgment through explicit tradeoffs, failure handling, reproducible measurements, and controlled API spend. Its scope is one Next.js application with a small shared budget database. Research orchestration remains deferred.

## Current capabilities

- Search up to ten web results with titles, source URLs, and excerpts.
- Use Exa Auto with highlights, following the installed [build-with-exa skill](.agents/skills/build-with-exa/SKILL.md).
- Keep both providers' API keys on the server and outside Git.
- Preserve keyboard interaction, mobile layout, cancellation, and stale-response protection.
- Evaluate both providers with deterministic query ordering, deadlines, resumable accounting, and a shared $5 ceiling.
- Keep raw search content transient by default; persist only operational evaluation metrics.
- Stream an explicitly requested answer from at most five search excerpts, with source inspection and clickable citations.
- Classify intent before writing: unresolved entity or measure prompts clarification; navigation uses the selected server-known source; insufficient evidence returns a gap message. Only factual answers invoke the second model stage.
- Bind evidence to a browser session with an expiring signed receipt; model output cannot invent citation destinations.
- Preserve search results when generation fails, times out, is cancelled, or has insufficient evidence.
- Evaluate answer support and task completion on owned fictional documents, separately from citation-ID validity.
- Reserve hosted API costs atomically in Neon Postgres before dispatch, with a permanent global allowance, signed-session limits, replay rejection, and an operator kill switch.

The [public demo](https://joysearch.vercel.app) passed its production search-and-answer smoke check on 15 November 2026 (IST). [Pull request #2](https://github.com/joydas65/JoySearch/pull/2) publishes the reviewed source and remains open for review. Production paid requests require the exact configured origin, explicit enablement, and an initialized, enabled budget database. Preview deployments keep paid routes disabled. See the [deployment runbook](docs/deployment.md) for the verified deployment, source provenance, and operational controls.

The original experiment had **$1.078** remaining before release verification. A fixed **$1.000** allocation is reserved for the hosted demo, leaving **$0.078** for local work; the two paths cannot each spend the same allowance. The successful release smoke reserved **$0.017**, leaving **$0.983 hosted + $0.078 local = $1.061** at verification time. This is conservative remaining authorization, not a provider invoice balance. Hosted searches reserve **$0.007** for Exa, and answers reserve **$0.01**. Failed, cancelled, uncertain, and cheaper requests keep their full reservations. Redeployment, session expiry, and lower provider charges do not reset or replenish the global allowance.

## Run locally

Use **Node.js 24 or newer** and **pnpm 11.25.0**.

```sh
pnpm install --frozen-lockfile
# On a new checkout only; preserve an existing .env.local.
cp .env.example .env.local
pnpm dev --hostname 127.0.0.1
```

Fill `EXA_API_KEY` and `BRAVE_SEARCH_API_KEY` in `.env.local` locally. Never use `NEXT_PUBLIC_` for credentials. `SEARCH_PROVIDER` defaults to `exa`; set it to `brave` to inspect that provider with the same UI. Restart the development server after changing credentials or provider selection.

For cited answers, also configure `AI_GATEWAY_API_KEY` and a random `ANSWER_CONTEXT_SECRET` (at least 32 bytes encoded as hex). Preserve existing values; no secrets belong in source control or client variables. Search still works when answer credentials are absent. The intent router is fixed to `openai/gpt-5-mini` with minimal reasoning; the factual writer defaults to `openai/gpt-4.1-mini` at temperature 0. Their dated rate cards and settings live in `lib/answer/model.ts`. This pairing passes the declared gates on twelve fresh owned cases; see the [measured revision report](docs/milestone-2/revision-results.md) for evidence and limits. Changing the model or workflow requires a fresh budget and quality evaluation.

After searching, choose **Generate cited answer**. Claims appear only after their citation IDs pass validation. Expand **Inspect the supplied sources** to read the exact excerpts provided to the model. Citations identify evidence; the application does not claim that it automatically proves factual support. Clarification and insufficient-evidence messages are valid outcomes, distinct from provider errors. Search again if the ten-minute evidence receipt expires.

Open [JoySearch locally](http://127.0.0.1:3000). Each local live UI request is charged against the same `.evaluation/ledger.jsonl` allowance as the CLI, including the hosted allocation already reserved there. An active evaluation holds the ledger lock, so UI requests return a temporary-unavailable state rather than race the spending limit. Do not delete this ledger or copy its credentials into a fresh checkout to restart the allowance.

Some restricted environments block Turbopack's CSS worker port. In that environment, use `pnpm dev --webpack --hostname 127.0.0.1` and `pnpm build --webpack`.

## Run the provider evaluation

```sh
# Dry run: no network or charges. Show the complete 312-call plan.
pnpm evaluate:search --campaign my-pilot --phase all

# Live development set: 12 queries per provider.
pnpm evaluate:search --run --campaign my-pilot --phase development

# After freezing the configuration: 48 holdout queries, three repetitions.
pnpm evaluate:search --run --campaign my-pilot --phase holdout
```

The base search plan reserves **$1.872** before credits: 156 Exa calls at $0.007 and 156 Brave calls at $0.005. The ledger includes earlier calibration and UI calls; a new campaign does not reset its $5 cap. Calls reserve cost before dispatch, failed/uncertain calls retain the reservation, and reruns skip previously reserved IDs. The runner stops on authentication, balance, or rate-limit errors. Do not delete the ledger to retry. If a process crashes and leaves a lock, establish that no evaluator or UI request is running before removing only that stale lock.

The runner saves manifests, code/corpus hashes, timing summaries, and accounting under Git-ignored `.evaluation/`. It does not grade relevance or answer quality. Evidence storage is disabled unless `--retain-evidence` and a documented `--permission-reference` are supplied. Confirm applicable data permissions before that use; merely supplying a string is not permission. The Exa-versus-Brave generated-answer comparison remains separate from the owned-evidence evaluation below, with its eligibility checks unresolved.

See [the evaluation protocol](docs/milestone-1/provider-evaluation.md) for definitions, thresholds, and limitations. Do not present conditional successful-response latency as overall end-to-end latency, or operational timing as an accuracy result.

## Evaluate cited answers

The CLI's `--model` selects the writer; the router remains fixed to GPT-5 mini with minimal reasoning.

```sh
# Dry run: preview four existing regression cases without network calls.
pnpm evaluate:answers --campaign my-two-stage-pilot --model openai/gpt-4.1-mini
# Live regression cases; historical split names remain, but all are now exposed.
pnpm evaluate:answers --campaign my-two-stage-pilot --model openai/gpt-4.1-mini --phase development --run
pnpm evaluate:answers --campaign my-two-stage-pilot --model openai/gpt-4.1-mini --phase holdout --run
```

The twelve-case corpus uses fictional documents authored for this project. It covers factual support, comparisons, conflicting evidence, dates, navigation, clarification, missing facts, and prompt injection. It makes no search calls and uses no paid model judge. Use a separate, unexposed authored corpus for fresh confirmation after freezing a revision; a historical `holdout` label does not make a previously inspected case fresh again.

Each logical answer request reserves **$0.01** under the original $5 ledger. Structured intent classification uses at most 4,000 input and 300 output tokens; factual answer writing can use a further 4,000 input and 600 output tokens. The aggregate ceiling is **8,000 input / 900 output tokens**, including reasoning, within **one shared 15-second deadline**. Clarification, navigation, and insufficient evidence use one model call; factual answers use at most two. The verified mixed-model rate cards give a maximum token cost of **$0.00416** per two-stage operation: $0.00160 for GPT-5 mini routing plus $0.00256 for GPT-4.1 mini writing, below the reservation. No tools, retries, extra searches, or model fallback are enabled.

The evaluator starts logical requests at least **30 seconds apart**, allows at most **12 cases / 24 model calls** per campaign, and also enforces its $0.30 campaign cap and the shared $5 ledger. These are local controls, not a provider rate-limit guarantee. Interrupted calls retain reservations; completed first-stage usage remains recorded if the second stage fails. Before dispatch, the evaluator verifies both models' catalog eligibility and rate cards. Campaigns freeze both model IDs, settings, rates, stage prompts, schema, corpus, and implementation hashes. Usage and estimated cost are accounted for per stage using its actual model; review binds each recorded stage model to the frozen configuration. Earlier failed runs are preserved.

Automatic checks measure transport and citation structure. Complete, attributed reviews grade each claim against the exact prepared passages and assess required task facets. See [the answer evaluation protocol](docs/milestone-2/answer-evaluation.md) for the gates, reproducibility commands, and limits of the small sample.

The [initial 14 November measured results](docs/milestone-2/results.md) preserve a failed quality gate for the earlier single-stage implementation: 30/30 valid citation references and 27/27 assistant-reviewed supported claim blocks, but only 9/12 fully completed tasks. The [initial evidence bundle](docs/milestone-2/measured-results.json) makes those historical judgments inspectable.

The [answer-quality revision](docs/milestone-2/revision-results.md) passes all declared gates on twelve previously unrun owned cases: **12/12 tasks, 17/17 facets, 17/17 supported claim blocks, and 19/19 valid citation references**. Observed completion p95 was **3.50 seconds**, and first-citation p95 was **2.99 seconds**. Two assistant reviewers agree; this small authored set is not a general web-accuracy benchmark. The [revision evidence bundle](docs/milestone-2/revision-measured-results.json) includes the failures leading to that result. Its frozen implementation and $1.078 remaining-budget snapshot predate the hosted controls; they are historical evidence, not a fresh evaluation of deployment behavior.

## Checks and build

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Routine tests use synthetic responses and temporary ledgers; they do not call paid services. Coverage includes request construction, evidence preservation, unsafe URLs, malformed data, cancellation, budget limits, concurrency locks, uncertain charges, and replay protection. Hosted route tests exercise the actual handlers and SDK parsing with mocked Neon, Exa, and Gateway responses, including duplicate dispatch prevention and failure before paid work when budget state is unavailable.

Release validation passed **100 network-free tests**, lint, TypeScript checks, and a production Webpack build. **Eleven isolated real-Postgres scenarios** verified concurrent reservations, cap boundaries, replay handling, settlement, migration preservation, and runtime permissions. One production browser smoke returned ten Exa results and completed a two-claim cited answer; both durable reservations settled successfully. A single smoke check verifies integration, not general search quality or a production latency percentile.

The app needs a Next.js server for `POST /api/search` and `POST /api/answer`; it no longer exports an `out/` directory. `next start` previews the UI, but live hosted requests require Vercel's production environment and the configured production origin. A successful build is not evidence of a deployed live service.

## Hosted demo controls

Neon’s Free plan provides a shared ledger; the Vercel runtime role can execute only the reservation, settlement, and status functions, with no direct budget-table writes. Admin credentials are kept out of production. Reservation locks the same budget row across instances, checks the global and session allowances, and rejects duplicate operations before contacting a paid provider. Settlement stores bounded operational metadata, not query text, source passages, or answers.

Each signed browser session has an absolute **24-hour** lifetime and a **$0.05** allowance, with searches at least **5 seconds** apart and answers at least **10 seconds** apart. Search operation IDs are scoped to the session; answer IDs derive from the authenticated evidence receipt. No automatic retry, refund, counter expiry, or budget reset is enabled. A database outage or ambiguous reservation response blocks dispatch. The SQL kill switch pauses new paid work across existing deployments.

Anonymous visitors can obtain new sessions and use up the global demo allowance. Session controls reduce repeated use; the permanent global reservation cap bounds authorized dispatch under the verified request shapes and prices. It does not guarantee provider price stability. A reported search charge above its reservation records the larger amount and pauses new work. See the [runbook](docs/deployment.md) for price checks, enablement, shutdown, and rollback.

## Design and portfolio plan

- [Design brief](docs/milestone-1/design-brief.md): experience, portfolio evidence, scope, budget, and milestones.
- [Architecture plan](docs/milestone-1/architecture-plan.md): boundaries, research state, persistence, cost controls, and failure handling.
- [Exa versus Brave evaluation](docs/milestone-1/provider-evaluation.md): protocol, quality gates, and pending final provider decision.
- [Evaluation corpus](docs/milestone-1/evaluation-queries.json): 60 original queries, including 12 development and 48 holdout queries.
- [Deployment runbook](docs/deployment.md): budget allocation, credential boundaries, release checks, and shutdown.

## Project structure

```text
app/api/search/route.ts     Server-side search with local or hosted budget accounting
app/api/answer/route.ts     Session-bound, budgeted cited-answer stream
components/search-app.tsx  Search form, accessible states, and cancellation
components/search-results.tsx  Generic source links and excerpts
lib/search/client.ts       Validated browser-to-server client
lib/search/providers.ts    Exa and Brave HTTP adapters and normalization
lib/search/types.ts        Provider-neutral result contracts
lib/answer/                Evidence packing, signatures, structured intent routing, generation, stream validation
lib/local-request.ts       Local-origin policy and bounded request-body parsing
lib/evaluation.ts          Durable local ledger, scheduling, and summaries
lib/hosted-request.ts      Production-origin policy and signed anonymous sessions
lib/hosted-budget.ts       Fail-closed Neon reservation and settlement boundary
scripts/sql/hosted-budget.sql  Atomic hosted accounting and restricted runtime grants
scripts/evaluate-search.ts Evaluation CLI and reproducibility manifests
scripts/evaluate-answers.ts Owned-evidence generation and support-review CLI
fixtures/answers/          Authored evaluation corpus and expected behavior
tests/                    Network-free regression tests
docs/milestone-1/          Design and evaluation artifacts
docs/milestone-2/          Cited-answer protocol and measured results
.agents/skills/build-with-exa/  Canonical installed Exa integration guidance
```

## History and credits

The original HTML, JavaScript, and Sass application was recovered from the public JoySearch deployment on 10 November 2026. Its source remains in [the original recovery commit](https://github.com/joydas65/JoySearch/tree/3d96b4dc138922092be997a5bab6d0fca4a9e014). The subsequent Next.js migration used Wikipedia; the current integration replaces that browser-only API path with server-side web search.

- Project by [Joy Das](https://github.com/joydas65).
- Web results are attributed to Exa or Brave and link to their original publishers.
- Roboto is bundled locally through Fontsource; the original JoySearch wordmark and responsive styling are retained.
