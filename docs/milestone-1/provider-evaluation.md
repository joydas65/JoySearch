# Exa and Brave evaluation plan

Date: 11 November 2026. Status: protocol prepared; execution and provider decision pending.

The decision is which provider should support JoySearch's first release within its quality, latency, retention, and budget constraints. Evaluate Exa Auto and Brave Web Search in the application's intended configuration. Select one production integration, or record an inconclusive result. This pilot cannot establish a universal provider ranking or a production availability guarantee.

Related artifacts: [design brief](design-brief.md), [architecture](architecture-plan.md), and [60-query corpus](evaluation-queries.json).

## Verified capabilities

| Capability | Exa Auto | Brave Web Search |
| --- | --- | --- |
| Published base price | $7 per 1,000 calls, up to 10 results | $5 per 1,000 calls |
| Evidence returned with search | Requested text/highlights included; AI page summaries extra | Descriptions and optional additional snippets |
| Baseline request | Auto, 10 results, highlights | Web results, count 10, offset 0, extra snippets |
| Location | `userLocation` | `country`; separate language controls |
| Freshness controls | Publication-date filters and separate content-age policy | Relative or explicit date-window filter |
| Pagination | Not supported | Offset-based pagination |

Prices: [Exa](https://exa.ai/pricing), [Brave](https://brave.com/search/api/). Behavior: [Exa search reference](https://exa.ai/docs/reference/search), [Exa search guide](https://exa.ai/docs/search/quickstart), [Brave Web Search documentation](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started).

Exa's content-age setting is not equivalent to a publication-date filter. Do not use its deprecated crawl-date parameters. Brave also has a separate [LLM Context endpoint](https://api-dashboard.search.brave.com/documentation/services/llm-context). This protocol's baseline compares one-call shared-evidence configurations, not the whole Brave product offering. Measure full request wall-clock time rather than comparing provider-reported internal timers.

## Eligibility before execution

Record the applicable plan or agreement and permissions for each activity: public search UI, answer grounding, private evaluation, temporary evidence handling, saved research artifacts, and publication of results or excerpts. Also verify card/minimum-payment requirements, rate limits, and the all-in budget.

Brave's current terms restrict storage beyond transient operation and contain restrictions involving evaluation of AI models/services. Exa's self-serve terms include retention and competing-service restrictions. Plan-specific agreements may change what is permitted. These are unresolved applicability questions, not a conclusion that either use is categorically prohibited. [Brave terms, sections 3(b)(i) and 3(b)(xiii)](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service), [Exa terms, section 4.2](https://exa.ai/terms-of-service).

If an activity requires a plan or permission unavailable within budget, mark that configuration ineligible or pending. Do not treat its absence of evaluation results as poor search quality. Public reports can contain only material whose publication is permitted. Owned query prompts and synthetic fixtures remain usable independently of provider-response storage rights.

## Query set and controls

The JSON corpus contains six categories with ten queries each: navigation, factual, technical documentation, comparison, fresh/local, and ambiguity or insufficient evidence. Each category has two development and eight holdout queries. Twelve holdout queries, two per category, are flagged `answerSample` for generation review.

Evidence criteria describe how to judge usefulness; they are not factual answer keys. Some queries intentionally require navigation, clarification, or an admission that public evidence is insufficient. Judge current facts against sources available at execution time, not a guessed answer fixed during planning.

1. Use the 12 development queries to finalize parameter mappings, error handling, prompt, and token truncation. Freeze those choices before looking at holdout results.
2. Save the corpus hash and a run manifest with commit, execution date/time, host region, network conditions, provider/API settings, deadlines, rate cards, model ID/version, prompt hash, and randomization seed. Record approved data retention and publication rules.
3. Resolve `run_date` against that manifest and verify currency as of execution; do not require recent publication for an older official page that remains current. Following the user-selected Exa skill, preserve "recent" and "latest" in the query without imposing an invented date window. Only a query with an explicit required interval receives hard date filters, with differences in date interpretation and precision recorded. Keep exact query strings identical across providers. This pre-execution protocol revision supersedes the earlier proposed automatic 30-day filter.
4. Run the 48 holdout queries in three blocks within one day, pairing providers closely in time and alternating/randomizing order. Use at most one concurrent request per provider. Do not load-test a paid provider.
5. Disable application response caching in the experiment. Record repeated-query results as such; provider-side cache behavior is outside our control. Describe first-block and later-block latency separately without claiming a genuinely cold provider cache.
6. Use repetition 1 for manual quality review, selected in advance. Time all repetitions and inspect a fixed subset for result variability. Never replace a poor first response with a better later response for scoring.

The small, authored corpus is biased toward portfolio scenarios. Report category results and sample sizes. It is not representative of all web queries or real user traffic.

## Stage A search and evidence

Exa baseline: `type: "auto"`, `contents: { highlights: true }`, and `userLocation` from the query record, for example `"IN"`. Omit redundant `numResults`; the default is ten. Use its default retrieval policy without summaries, deep search, or forced live crawling. Default retrieval can still fetch missing content; it is not guaranteed to be cache-only.

Brave baseline: `count=10`, `offset=0`, `extra_snippets=true`, `text_decorations=false`, web results only, and country from the query record, for example `country=IN`; use `search_lang=en`. Use the documented safe-search setting and record capability differences; locale settings are not identical ranking guarantees.

Apply additional date restrictions only to queries explicitly requiring them. The verified Exa reference has no equivalent language field; retain English query wording and record that asymmetry rather than inventing a matching API parameter.

Measure request start to complete parsed response using a monotonic clock, with a common 3-second deadline. Include the cost and duration of returned evidence. Record HTTP status, timeout, invalid response, result count, payload size, and evidence size. Report latency percentiles for valid completed responses alongside failure and timeout rates over all attempts; a timeout is censored at the deadline, not a successful three-second response. No automatic retry in the comparison; retries would obscure failure rate and latency. Missing ranks count as irrelevant for answerable queries.

Blind provider labels and randomize left/right display. Preserve each provider's ranking. A reviewer may inspect destination pages during the permitted review period. Grade the top five results:

| Grade | Meaning |
| --- | --- |
| 0 | Irrelevant, unavailable, or fails an essential query constraint |
| 1 | Related but insufficient to satisfy the intent |
| 2 | Useful evidence addressing a substantial part of the intent |
| 3 | Directly satisfies the intent with an appropriate, authoritative, sufficiently current source |

For answerable factual, technical, comparison, and fresh/local queries, report precision at five: the number of grades 2 or 3 divided by five. Average per query and then equally across categories. Navigation is evaluated by intended destination in the top three.

For clarification queries, grade intent coverage as 0 for no plausible interpretation, 1 for one plausible interpretation, and 2 for several plausible interpretations or material identifying the missing context. For insufficient-evidence queries, flag each result that could be mistaken for evidence of the requested unavailable or imaginary fact, and record why. Relevant background is not proof of that fact. These Stage A edge-case measures are diagnostic rather than an aggregate pass gate; the corresponding Stage B behavior is gated. A legitimate lack of an answer must not be penalized as ordinary retrieval failure.

## Stage B grounded answers

Use the 12 preselected holdout queries and each provider's repetition-1 evidence, producing at most 24 generations. If retention permits, reuse the response; otherwise run generation during its transient processing window. If the retrieval failed, record a failed end-to-end task instead of silently substituting another repetition.

Use the same exact model version, system instructions, settings, and output cap. The total input ceiling is 4,000 tokens including instructions and query; output is at most 600 tokens. Give sources stable IDs and allocate evidence in rank order across up to five distinct URLs with the same truncation rule. Record source count and discarded tokens. Neither provider gets an undisclosed second retrieval or page fetch in this baseline.

The prompt must require supported claims and source IDs, distinguish missing evidence from a negative fact, and allow navigation, clarification, or insufficient-evidence responses. Rendering can resolve only IDs in the supplied source map. No model-generated URL is accepted as a citation.

Review every material factual claim for source support, and every answer for useful coverage of the query's `evidenceCriteria`. Record separately:

- **Citation validity:** cited IDs resolve to supplied sources.
- **Citation coverage:** material factual claims with an attached source divided by all material factual claims.
- **Citation support:** cited claims actually supported by their passages divided by all cited material claims.
- **Task completion:** answer addresses the required facets or performs the expected navigation/clarification/abstention behavior.
- **Freshness:** time-sensitive assertions are supported for the requested period.

For zero-claim navigation or clarification responses, citation percentages are not applicable, not automatically 100%. Classify claim support as full, partial, unsupported, or contradicted; only full support counts in the support numerator. Use the macro mean across applicable answers for the coverage/support gates, and also report pooled claim counts. Long answers must not dominate the comparison. A critical invented claim materially changes the conclusion or asserts unavailable facts as known. A second reviewer should independently grade a fixed six-answer subset when available. Otherwise disclose single-reviewer bias and repeat the grading blind after a delay.

Reusing earlier evidence produces a composed latency estimate: recorded Stage A time plus evidence-preparation time plus generation time to the first substantive content with a source, or to completion. Exclude experiment scheduling gaps and label the result as composed, not directly observed end-to-end latency. Where generation immediately follows transient retrieval, additionally record the continuous pipeline time. Keep stage timings separate and report all failures and denominators. Neither measurement includes browser rendering; milestone 4 measures actual end-user latency.

An optional diagnostic can test Brave Web plus LLM Context on four answerable answer-sample queries chosen before execution. Count the extra request, cost, elapsed time, and model generation. Show its actual source set separately from Web results. This arm can motivate a new configuration; it cannot silently replace baseline failures. A broader confirmation run requires its own frozen configuration and remaining budget.

## Quality gates and selection

These are project-specific pilot gates chosen before execution. They are not claims about either provider's current performance.

| Gate | Initial criterion |
| --- | --- |
| Eligibility | Required use and retention permissions documented within budget |
| Search usefulness | Macro precision at five at least 0.75 across the four answerable categories, with no such category below 0.60 |
| Navigation | Intended destination in top three for at least 7 of 8 holdout navigation queries |
| Retrieval reliability | At least 140 of 144 valid holdout responses before deadline, meeting the 97% threshold; report empty results separately |
| Retrieval latency | Valid-response p95 at most 2.5 seconds, assessed together with the reliability gate and all censored timeouts |
| Citation integrity | 100% valid source IDs; zero fabricated citations or critical invented claims |
| Grounded answer quality | Macro citation coverage and support at least 90% on applicable answers; both sampled ambiguous/insufficient queries take an appropriate action |
| Answer usefulness | At least 7 of 8 answerable sample tasks meet their evidence criteria; both navigation samples lead to an appropriate destination |
| Estimated answer responsiveness | All 8 answerable sample tasks fit 8 seconds to first useful cited content and 15 seconds to completion under the composed estimate; report failures explicitly |
| Cost | Entire experiment fits $5 and proposed deployment fits the recurring budget |

Apply eligibility and quality gates before cost. Prefer a materially more useful provider if it still fits latency and budget. For the answerable retrieval categories, a difference of five percentage points is the initial practical-relevance threshold. Inspect category regressions and answer failures before deciding.

Use paired query-level differences and, if reporting confidence intervals, resample queries within categories with all repetitions kept together. Repetitions are not independent users. With only 12 answer samples per provider, inspect cases and counts rather than claiming statistically established answer superiority.

If both pass and differences are small or uncertain, prefer lower complete-task cost and simpler operation, recording the choice as provisional. A wide interval does not prove equivalence. If neither passes, keep the decision pending and identify the failed constraint; a revised configuration must use a fresh confirmation set. Public comparative publication remains subject to the recorded permissions.

## Evaluation budget

Each provider receives `12 + 48 × 3 = 156` search calls. This includes development calls and all holdout repetitions.

| Item | Calculation | Gross allowance |
| --- | --- | ---: |
| Exa Auto search | 156 × $0.007 | $1.092 |
| Brave Web search | 156 × $0.005 | $0.780 |
| Baseline answer generations | At most 24, using the selected model's verified rates | $1.000 |
| Optional diagnostic | At most four extra context calls and generations, with rates checked first | $0.500 |
| Remaining contingency | Reserved for explicitly recorded additional work and billing uncertainty | $1.628 |
| **Total ceiling** | | **$5.000** |

Search subtotal is $1.872 before credits. The model allocation is a cap, not an estimate for an unspecified model. Before execution, calculate worst-case input, output, reasoning, and tool charges from the actual model rate card. Disable automatic tools and hidden retrieval. Reserve cost before every call and stop when the next call cannot fit. No rerun is free merely because it failed locally.

Track gross usage cost and actual cash separately. Credits may reduce cash cost; required top-ups or minimum commitments can exceed usage cost and must fit the spending constraint. Additional debugging calls are contingency usage and cannot be silently added to the 312-call baseline. Hosting and local engineering time are reported separately. Report cost per successful search and completed answer using all attributable charges, including charged failures, divided by the relevant successful-task count; a zero-success configuration has no finite cost per success.

## Result artifact and decision record

Keep the experiment manifest, per-request operational metrics, blinded human grades, claim assessments, and rate-card version. Retain provider payloads or outputs only under the recorded permissions. Link each aggregate to its denominator and condition. Publish no fabricated results or provider-content dumps.

| Decision field | Current value |
| --- | --- |
| Eligible plans and permissions | Pending |
| Execution date and configuration hashes | Pending |
| Search quality, category breakdown, and failures | Pending |
| Answer support, completion, and failure cases | Pending |
| Median/p95 latency and sample sizes | Pending |
| Gross usage cost and cash cost | Pending |
| Selected configuration and rationale | Pending |
| Tradeoffs, limitations, and reconsideration trigger | Pending |

Milestone 1 is complete when the protocol, corpus, architecture, and budgets are internally consistent and reviewable. Executing the experiment and making the provider decision are subsequent steps once the eligibility and configuration prerequisites are satisfied.
