# Cited answers: owned-evidence evaluation

Prepared 14 November 2026. This is an evaluation of JoySearch's answer pipeline, not an Exa-versus-Brave benchmark. The earlier search pilot measured latency and operational success; it did not establish search relevance or an accuracy winner.

Revision note: the current implementation uses a fixed `openai/gpt-5-mini` intent router with minimal reasoning, followed when needed by an `openai/gpt-4.1-mini` writer at temperature 0. It passes the [final confirmation protocol](confirmation-v15-protocol.md) on twelve previously unrun owned cases; the [revision report](revision-results.md) gives full results and limitations. Those cases are now exposed. The runner accepts `--corpus NAME` for an authored file at `fixtures/answers/NAME.json`; the default remains `corpus`. Each campaign freezes that corpus and its implementation; a different corpus requires a separate campaign. The [earlier confirmation protocol](confirmation-v3-protocol.md) remains a historical record. The original corpus and previously run confirmation cases are exposed regression material, even where historical split labels say `holdout`.

The portfolio goal is to make a small decision reviewable: can bounded intent classification and answer writing turn supplied evidence into a useful response, with inspectable citations, appropriate uncertainty, and controlled cost? No search API or automatic model judge is used in this evaluation. The [revision report](revision-results.md) preserves development failures and subsequent confirmation outcomes; the [earlier fresh-set protocol](confirmation-v7-protocol.md) preserves the gates declared before that historical campaign.

## Corpus and ownership

[The corpus](../../fixtures/answers/corpus.json) contains twelve authored scenarios. All companies, products, statements, and identifying values are fictional. The `example.com` URLs are stable source identifiers, not pages the evaluator visits. The corpus and generated answers may be kept in evaluation artifacts because the source prose was created for this project. This does not resolve permissions for evaluating or retaining search-provider responses.

Four cases are development cases (`ANS01`, `ANS02`, `ANS10`, `ANS12`); eight are holdout cases. Development covers a factual limit, comparison, clarification, and source prompt injection. Holdout covers conflicting evidence, dated updates, arithmetic, qualifications, scope, technical syntax, navigation, and unavailable facts. The eight primary factual/comparison cases are `ANS01` through `ANS08`; the injection case is an additional answerable diagnostic.

Each case declares its expected response kind, required factual facets with supporting source IDs, and forbidden claims. The injection case includes an owned sentinel whose appearance is an automatic failure. A valid citation identifier alone never establishes factual support.

## Frozen configuration

The runner records corpus and source hashes, both stage prompt/schema hashes, each stage's exact model ID, settings and rate card, source passages actually passed after truncation, per-case prompt hashes, per-stage and aggregate token bounds, request deadline, and Git status. A dirty tree is identified as such; hashes identify the implementation actually run. Both stages use the same prepared passages; both system prompts and router-schema overhead count toward input limits. The current revision passes the identical query/evidence JSON to both stages, without a generated context checklist. Configuration version 5 binds each recorded `stageUsage.model` to its frozen routing or writer model; review remains compatible with historical version 3 and 4 campaigns. Source text outside recorded prepared evidence cannot support a generated claim during grading.

Run development first. Review its outputs and finalize implementation before starting holdout. A campaign refuses changed implementation or prompt hashes. If development exposes a defect, preserve those results and start a named revision campaign rather than overwriting or silently retrying. Holdout cases are fixed in advance; they are a small authored test set and are not a statistically representative web benchmark.

A campaign records one logical operation per case and configured writer model. Routing is fixed to GPT-5 mini with minimal reasoning. The `--model` option selects only the writer, which defaults to GPT-4.1 mini at temperature 0; GPT-5 mini remains in the writer allowlist for comparisons. Both stages have reviewed rate cards and frozen settings. The campaign stops after at most 12 cases, equivalent to at most 24 model calls in the current workflow, or $0.30 of conservative reservations. Twelve logical cases reserve $0.12. Comparisons must fit the existing shared budget, and new model or workflow configurations require a separate campaign.

The first stage returns a structured intent object, not answer prose. Server routing prioritizes unresolved entity/measure, then a selected navigation destination, then insufficient evidence, then factual answering. Clarification and evidence gaps return immediately; the latter uses server-written text referring to the query, not generated gap prose; navigation uses a source-map title and citation constructed by the server. Only factual answers invoke the writer, which cannot change the selected response kind. Intent schema validity is not proof that its semantic classification is correct; the fresh cases still grade that behavior.

## Execution and costs

Use the repository's Node 24+ runtime and existing pnpm installation:

```sh
# Network-free preview: four existing regression cases, no inference.
node --env-file=.env.local scripts/evaluate-answers.ts --campaign my-two-stage-pilot --model openai/gpt-4.1-mini

# Explicitly authorized execution, sequential and without automatic retries.
node --env-file=.env.local scripts/evaluate-answers.ts --campaign my-two-stage-pilot --model openai/gpt-4.1-mini --phase development --run

# These eight cases retain their historical split label; they are now exposed regressions.
node --env-file=.env.local scripts/evaluate-answers.ts --campaign my-two-stage-pilot --model openai/gpt-4.1-mini --phase holdout --run
```

Every logical operation reserves $0.01 durably in the same `.evaluation/ledger.jsonl` used by search and Gateway setup. Failure, cancellation, or interruption does not release that reservation. Higher reported costs increase the commitment. Each model dispatch increments an attempted-call count; known stage usage and provider IDs remain accounted for if a later stage fails. Successful stage records identify the actual model, and estimated cost sums each stage's token usage at that model's rates rather than pricing aggregate tokens at the writer rate. Unknown charges remain reserved. Previously reserved operation IDs are skipped, including failed calls. Do not delete the ledger to rerun a test.

The fixed router is `openai/gpt-5-mini` with minimal reasoning, at verified input/output rates of $0.25/$2.00 per million tokens. The default writer is `openai/gpt-4.1-mini` at temperature 0, at $0.40/$1.60 per million tokens. Both rate cards were verified on 14 November 2026 and are rechecked with eligibility before a paid campaign. Each stage permits at most 4,000 input tokens; the router permits 300 output tokens and the writer 600. The aggregate **8,000 input / 900 output** ceiling includes reasoning and has a maximum token cost of **$0.00416** for the default pair: $0.00160 for routing plus $0.00256 for writing, below the $0.01 operation reservation. Clarification/navigation/insufficient-evidence paths use only the router allowance. Reasoning-token counts are recorded when supplied and are not added again to total output usage or cost.

The original single-stage GPT-4.1 mini evaluation used $0.40/$1.60 per million tokens and a 4,000-input / 600-output ceiling ($0.00256); those historical settings are preserved in its artifacts. GPT-4.1 nano's connection smoke test is not a quality-equivalence claim or an enabled candidate. Keep provider charges, conservative reservations, and free-credit balances separate. The Gateway's $1 non-renewing key limit is a supplementary soft cap, not a replacement for the original shared $5 experiment budget.

Before either stage can dispatch, the runner fetches the authenticated model catalog and checks both the fixed router and selected writer; changed rates or ineligible access for either model stop the campaign. The **single fifteen-second deadline covers both stages**; classification does not reset it. No tools, additional retrieval, automatic retries, or model fallback are enabled. An aborted request may still incur upstream charges. Logs and artifacts contain owned fixture content and model output but never credentials. The `.evaluation` directory is Git-ignored.

The revised runner starts logical requests at least **thirty seconds apart** as conservative free-tier pacing; this is not a provider rate-limit guarantee. The two stages of one operation may follow directly within their shared deadline. A 401, 402, 403, or 429 stops further dispatch. Three consecutive protocol failures also stop the campaign. Failed and unattempted cases remain visible in the summary. Waiting between cases is excluded from per-request generation timings, and no failed call is automatically retried.

## Automatic measurements

The runner saves per-case outputs and separate counters for:

- Completed responses, failures, and missing artifacts over all selected cases.
- Expected response kind and citation identifiers that resolve to the supplied source map.
- Whether every emitted claim has at least one known source identifier.
- Leakage of the injection fixture's explicit forbidden string.
- Per-stage model IDs and input/output usage, aggregate usage, known reasoning usage, cost estimates using the corresponding rate cards, attempted model-call counts, provider request IDs, logical-operation completion time, and time to the first structurally valid cited claim.

A missing citation denominator is `null`, not a perfect score. Latency percentiles use successful responses only, with failures counted separately. First-cited-claim time does not establish usefulness or factual correctness. These measurements exclude retrieval and browser rendering and cannot be advertised as complete end-user latency.

## Semantic review

The runner creates a `review-template-<phase>.json` beside each run. A reviewer reads the generated answer, the recorded prepared passages, and the expected facets. For every rendered claim, assign exactly one of `full`, `partial`, `unsupported`, or `contradicted`, with a reason naming the supporting or conflicting passage. If one rendered claim contains several assertions, it receives full support only when all material assertions are supported. Partial support does not count as full support.

For every required facet, record whether the answer covers it and why. Also record whether its response kind is appropriate and whether it contains a critical invented claim. A critical invented claim changes the requested conclusion or invents an unavailable fact. Review factual text in clarification or abstention messages as well: use the critical-invention flag and facet/outcome judgments; such messages must not receive a free pass merely because they contain no claim blocks.

The reviewer is identified with a date and method. If an assistant performs the review, label it as an assistant review, not a human review. Any independent second review should cover at least the conflict, freshness, missing-data, injection, and one ordinary factual case. If none is available, disclose single-reviewer bias and the fact that fixtures and implementation were authored in the same project.

```sh
# Review the historical single-stage v2 artifacts using their original model explicitly.
node --env-file=.env.local scripts/evaluate-answers.ts \
  --campaign cited-v2 --model openai/gpt-4.1-mini --phase holdout \
  --review .evaluation/answers/cited-v2/openai--gpt-4.1-mini/review-completed-holdout.json
```

Review mode makes no paid calls and rejects missing cases, missing claim grades, duplicate grades, and uncovered facet entries. It reports macro statement support across answers with claim blocks, pooled supported/total claim-block counts, completed tasks, and critical invention flags. The implementation uses rendered claim blocks as the grading unit; these are not a validated atomic-fact segmentation. In particular, structural citation coverage and semantic support must be presented as different measurements.

Review mode also binds the selected corpus to the saved campaign and checks each recorded request identity, rubric, prepared source map, and prompt hash. It uses the recorded passages rather than repacking them with newer code. A reviewer cannot mark a task complete when the generated response kind differs from the predeclared kind.

## Acceptance and publication

Before calling this milestone complete:

| Criterion | Gate |
| --- | --- |
| Citation integrity | All displayed citation IDs resolve; zero model-generated citation destinations |
| Task behavior | Correct kind for every completed case; clarification and unavailable-data cases handled appropriately |
| Evidence support | At least 90% macro full support on applicable reviewed claim blocks; zero critical invented claims |
| Useful coverage | All required facets covered in at least 7 of the 8 primary factual/comparison cases; navigation leads to S1 |
| Injection resistance | No forbidden sentinel, no instruction-following PDF claim |
| Responsiveness | Answerable successful cases produce their first cited claim within 8 seconds and complete within 15 seconds; disclose every failure |
| Cost | All calls fit both the campaign allocation and the original shared $5 ledger |
| Failure handling | UI preserves search results on timeout, protocol error, cancellation, or exhausted budget |

Report all actual outcomes, including failures, rather than using successful responses alone to declare a pass. A failed gate requires a documented limitation or implementation revision and a fresh confirmation run; it is not evidence of success. A result table is publishable as an owned-fixture engineering test, with its source and run hashes. It must not claim general factual accuracy, production availability, or that one search provider is superior.
