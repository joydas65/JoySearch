# Intent and context revision: measured results

Prepared 14 November 2026. **The final revision passes all predeclared gates on twelve fresh owned cases:** 12/12 completed tasks, 17/17 required facets, and 17/17 fully supported claim blocks. This is a measured local portfolio result, not a general web-accuracy claim.

This revision addresses three observed failures in the [initial result](results.md): answering an ambiguous question without clarifying it, returning a factual-answer kind for a navigation request, and omitting material context such as a replaced value or a quota's scope. The application remains a personal portfolio project with one Next.js app and bounded, optional generation.

## Engineering change

The first model call returns a small validated intent object: whether the entity and requested measure are resolved, whether the user wants a destination, whether evidence establishes the requested fact, a brief clarification question when needed, and selected destination IDs. The server applies routing precedence. An unresolved entity or measure produces a clarification question; a destination request selects known source IDs; unavailable evidence produces a server-written gap message referring to the query. These paths skip answer writing. A factual answer uses a second call constrained to the selected kind and the same packed passages. The writer receives the original query/evidence JSON with no generated checklist. Its instructions preserve explicitly supplied units, scope, conditions and revisions, while distinguishing document update dates from policy effective dates.

The selected pairing uses GPT-5 mini with minimal reasoning for intent and GPT-4.1 mini at temperature 0 for factual writing. The workflow allows at most two calls, 8,000 aggregate input tokens and 900 output tokens, under one 15-second deadline. A $0.01 reservation covers the configured $0.00416 token-cost ceiling. Each stage's usage and provider ID are recorded when known, including a completed router whose output fails parsing or whose writer later fails. Unknown usage never refunds the reservation. The browser's inspected passages are repacked before the start event so a still-valid receipt from an older prompt cannot show more evidence than the current generator receives.

## Preserved development history

All previous outputs and failures are retained. The original twelve cases and the first failed confirmation set are now exposed regression material. Historical `holdout` labels do not make them fresh again.

| Campaign | Completed / selected | Correct kinds | Complete tasks | Finding |
| --- | ---: | ---: | ---: | --- |
| v3 regression, GPT-4.1 mini | 2/12 | 2 | Not fully reviewed | Eight protocol failures, one HTTP 429, one unattempted; a separate one-call diagnostic is retained |
| v4 regression, GPT-4.1 mini | 12/12 | 12 | 10 | Old-value context and calculation still incomplete |
| v5 regression, GPT-4.1 mini | 7/12 | 7 | 7 | Five HTTP 500 failures; no automatic retry |
| v5 named recheck, same prompt | 12/12 | 10 | 10 | Navigation and ambiguity failed again |
| v6 regression, GPT-5 mini | 12/12 | 12 | 12 | Exposed cases passed task checks; some extra wording lacked full support |
| v6 fresh confirmation | 12/12 | 8 | 7 | Three ambiguity failures, one navigation error, one omitted account scope |
| v7 two-stage regression, 14-second spacing | 7/12 | 7 | 7 | Writer rate-limited on case eight; four cases unattempted |
| v7 two-stage paced regression | 11/12 | 11 | 11 | One structured-routing failure; 85% macro support, below the 90% gate |
| v8 narrowed router regression | 11/12 | 11 | 11 | All 25 delivered claim blocks supported; missing-data routing still failed |
| v9 server gap-message regression | 12/12 | 11 | 11 | Missing data completed but was incorrectly classified as an answer |
| v10 targeted routing regression | 4/4 | 4 | 4 | All four response kinds pass; 4/4 supported claim blocks |
| v10 exposed confirmation set | 12/12 | 12 | 11 | All routing cases pass; the quota still omits per-account scope |
| v11 targeted context regression | 6/6 | 6 | 6 | Scope is preserved, but added unsupported qualifiers reduce macro support to 80.56% |
| v12 GPT-4.1 mini combined regression | 9/9 | 9 | 9 | 15/15 supported claim blocks; selected for fresh confirmation |
| v13 GPT-4.1 mini fresh confirmation | 12/12 | 11 | 11 | All 18 claim blocks supported; one entity ambiguity is answered instead of clarified |
| v14 paired exposed regression | 12/12 | 12 | 12 | 17/17 facets; 16/16 fully supported claim blocks |
| v15 paired fresh confirmation | 12/12 | 12 | 12 | 17/17 facets; 17/17 fully supported claim blocks; all declared gates pass |

The failed v6 confirmation triggered the two-stage design. The v7 rate-limit failure triggered a separate named regression at 30-second logical-request intervals; the prompts, model, and generation implementation were unchanged. That paced run added unsupported account scope to five comparison blocks and asserted effective dates in two blocks where the evidence stated only an update date. These seven blocks receive partial support, not full support. Its missing-data case failed after a completed routing call; the recorded usage establishes that the call completed, not why the structured output failed. This motivated removing free-form context requirements and unused descriptive labels from the routing interface.

A separate one-call v8 diagnostic returned the correct evidence-gap flags but an incomplete/malformed 180-character message. The final revision therefore renders insufficient-evidence text on the server, using the user query to identify the gap. It also aligns the validator with JSON Schema character-count semantics; UTF-8 bytes had previously been used as the message-length measure. The earlier failed responses were not retained raw, so this mismatch is a verified code defect, not a proven explanation for each historical failure.

The v9 missing-data request then completed with the wrong kind: it treated evidence of an unavailable count as evidence for the requested count. The final router field is therefore named `hasAnswerEvidence` and distinguishes requested facts from statements that those facts are absent. The writer is unchanged. Four exposed cases were selected before the v10 targeted run—conflict, navigation, clarification, and missing data—with their queries and rubrics copied unchanged into [the targeted corpus](../../fixtures/answers/routing-regression-v10.json). That targeted check is not a new twelve-case rerun or fresh confirmation.

The v10 exposed confirmation run then passed all response kinds and support grades but still omitted the per-account denominator of a quota. The final writer rule attaches all explicitly stated denominators to limits, rates and allowances, using a generic worked example and forbidding invented scope. Six unchanged exposed cases were selected into [a context regression corpus](../../fixtures/answers/context-regression-v11.json) to check both preservation and overreach. This is a writer-only revision; the earlier routing result remains a separately reported result, not a full rerun claim.

The stronger v11 wording preserved the missing quota scope but also added unstated retention denominators and a date that the source did not establish as effective. It failed the support gate. A nine-case [combined exposed regression set](../../fixtures/answers/combined-regression-v12.json) was fixed before comparing the already-allowlisted GPT-4.1 mini candidate with the same prompts. That comparison changes both the selected model and its existing settings (temperature 0 instead of GPT-5 mini minimal reasoning); it cannot isolate an intrinsic model-quality effect.

The v13 fresh run failed entity clarification despite accurate supported claims; the second reviewer agreed. The next revision retains both prompts and assigns GPT-5 mini to intent classification and GPT-4.1 mini to writing. This preserves the two-call bound while separating the configurations that performed better at these stages. The previously fresh corpus is now exposed regression material; a new untouched [confirmation-v15 protocol](confirmation-v15-protocol.md) governs subsequent confirmation.

Pacing is excluded from request latency. This is an empirical test setting, not a promised provider limit: [Vercel documents variable per-model limits and HTTP 429 behavior](https://vercel.com/docs/ai-gateway/rate-limits). No credits were purchased to bypass the limit.

## Confirmation and limits

The [final confirmation protocol](confirmation-v15-protocol.md) predates its run and fixes twelve new fictional cases, seventeen facets, quality gates, latency limits, and cost bounds. A separate assistant contributor authored it; implementation contributors did not inspect its contents before freezing the workflow. The corpus hash is `2411d7047c56d0493ede44548de08c61d68ba8325adb2a6e891f9edec2237db1`. The v14 regression and v15 confirmation used identical implementation hashes, prompts, model IDs, and settings. Runtime files matched the v15 frozen hashes when this evaluation was completed. Subsequent [deployment controls](../deployment.md) change the request/accounting boundary; this historical evaluation bundle is preserved unchanged and is not a fresh deployment-quality claim.

| Final fresh confirmation, `cited-v15-confirmation` | Result |
| --- | ---: |
| Normally completed requests / selected cases | 12/12 |
| Correct response kinds / fully completed tasks | 12/12 each |
| Ambiguity / navigation / material-context / control cases completed | 3/3 each |
| Required facets covered | 17/17 |
| Citation references resolving to supplied evidence | 19/19 |
| Fully supported rendered claim blocks | 17/17 |
| Macro full support on applicable cases | 100% |
| Critical invented claims observed | 0 |
| Routing p95 | 2.24 s |
| First validated cited claim p95, answer/navigation outcomes | 2.99 s |
| Logical-request completion p95 | 3.50 s |
| Model calls / input tokens / output tokens | 18 / 8,770 / 1,226 |
| Evidence bytes discarded by packing | 0 |

All requests completed within the 15-second bound, and every applicable first cited claim arrived within 8 seconds. Latency measures the supplied-evidence generation pipeline; it excludes search and deliberate spacing between evaluation requests. Twelve observations do not establish a production latency percentile or SLA.

Both assistant reviewers read every final case against the exact prepared passages and unchanged rubric. They agree on all task, facet, and claim-support judgments. The primary reviewer authored the corpus; the second contributed to implementation and reviewed without reading the primary judgments. This separation does not establish external or human independence, and both share project and assistant-family bias. Two correct clarification outcomes (`ANS62`, `ANS63`) label attribute ambiguity as an unresolved entity internally. Their useful questions satisfy the declared outcome gates, but the result does not demonstrate perfect internal field classification.

The [published evidence bundle](revision-measured-results.json) retains every development campaign, failed/partial outcome, exact owned passages and prompts, configuration hashes, primary judgments, and second reviews. The original single-stage [failed baseline](results.md) is also preserved. These fixtures measure the supplied-evidence pipeline. They do not establish search relevance, source truth, real-web accuracy, production availability, broad adversarial robustness, or a winner between Exa and Brave.

## Budget and verification

| Accounting, reconciled 14 November 2026 at 10:17 UTC | USD |
| --- | ---: |
| Authorized allowance remaining at this revision's start | 2.918 |
| Conservative commitments for this revision | 1.840 |
| Total committed against the original $5 experiment | 3.922 |
| **Remaining original allowance** | **1.078** |
| Known provider-reported generation charges for this revision | 0.07913605 |
| Observed Gateway credit decrease over the revision window | 0.08194605 |

There were 184 logical operations and 258 model dispatch attempts in this revision, including diagnostics, failures, and named rechecks. All 243 known generation IDs were reconciled with Gateway records. Fifteen failed or protocol-aborted attempts lack generation IDs, so the known-charge figure is not complete per-request attribution; the credit decrease is a separate window observation. Reservations remain committed even when actual charges are lower or calls fail. No credits were purchased, and free credits did not increase the authorized budget. This work used owned evidence, with no search API calls or paid model judge.

The final paired implementation passes 71/71 automated tests, lint, TypeScript checking, and a production Webpack build. Route integration tests exercise the real POST handler with mocked Gateway responses, including rejected receipts before paid work, exact repacked evidence in both stage prompts, and durable settlement before the completion event. These checks make no paid requests.

At the time of this frozen evaluation, hosted paid routes were disabled because the file ledger was designed for a single-machine pilot. The subsequent [deployment runbook](../deployment.md) tracks shared spending controls and release status separately; the measurements and accounting snapshot above remain historical.
