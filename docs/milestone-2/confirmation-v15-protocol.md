# Fresh confirmation for mixed-model routing and answers

Prepared 14 November 2026 before this corpus is run. Earlier confirmation corpora and their failures remain preserved as exposed regression material. This protocol preregisters a new supplied-evidence test; it does not replace the earlier outcomes.

## Unrun corpus and separation

The [confirmation-v15 corpus](../../fixtures/answers/confirmation-v15.json) contains twelve newly authored fictional cases, IDs `ANS61` through `ANS72`, all marked `holdout`, with seventeen predeclared facets.

| Category | Cases | Expected kinds |
| --- | ---: | --- |
| Ambiguity: entity, address type, capacity measure | 3 | 3 clarify |
| Navigation: link request, reference request, resource-seeking noun phrase | 3 | 3 navigation |
| Material context: entity/time unit, plan qualification, dated revision | 3 | 3 answer |
| Controls: explicit comparison, explicit product selection, unresolved same-product conflict | 3 | 3 answer |

The corpus hash at predeclaration is `2411d7047c56d0493ede44548de08c61d68ba8325adb2a6e891f9edec2237db1`. Combined source-passage text is at most 351 UTF-8 bytes per case, below the 500-byte authoring bound. All facts, products, and policies are fictional. The `example.com/joysearch-fixtures/` URLs are source identifiers, not pages to fetch.

The requested context facets follow explicit query requirements, including entity scope, time units, qualification, and replacement dates. The controls require answers rather than unnecessary clarification. Source packing remains part of the tested pipeline: review only the exact prepared passages actually available to the model.

A separate assistant corpus author shares only hashes, counts, and paths with implementation contributors until freeze. Case names, values, queries, and passages are withheld. This is limited separation within the same project and assistant family, not independent human evaluation. The author knows earlier failure themes and is also a reviewer; disclose that bias and any unintended pre-run exposure.

## Frozen workflow and budget

The candidate uses **GPT-5 mini with minimal reasoning for routing** and **GPT-4.1 mini at temperature 0 for the answer writer**. Freeze both model IDs/settings, both prompts, implementation hashes, rates, and this corpus hash before any fresh dispatch. The new campaign name must be recorded with its outputs.

A logical request permits at most two model calls and shares a single 15-second deadline. Aggregate bounds remain 8,000 input tokens and 900 output tokens, with 300 output tokens allocated to routing and 600 to the answer stage. Routing-only outcomes may use one call. No retrieval, repair call, automatic retry, or paid model judge is added.

The configured worst-case token ceiling is **$0.00416 per logical request**: routing at most $0.00160 and writing at most $0.00256 under the pre-run rate card. The runner must verify current eligibility and rates before inference. One durable **$0.01 reservation** covers each logical request, so this twelve-case pass reserves **$0.12** in the original shared $5 experiment ledger. All earlier work continues reducing that same allowance. Failed, cancelled, or uncertain work retains its reservation; credits do not create additional spending authorization.

Run each fresh case once and preserve every artifact. If a fixture defect is found, document it and its scoring impact without silently removing the case. Do not change required facets after seeing an answer. Any later generation change makes these cases regression material; another fresh-confirmation claim then requires another unrun corpus.

## Acceptance and review

| Criterion | Gate |
| --- | --- |
| Completion | All 12 logical requests complete normally; failures remain in the denominator |
| Kind selection | All 12 match the predeclared kind, including controls |
| Task coverage | Every required facet is met in every case |
| Citation integrity | Every displayed ID resolves to supplied evidence; destinations come from the server map |
| Semantic support | At least 90% macro full support on applicable claim blocks; zero critical invented claims |
| Responsiveness | First validated cited claim within 8 seconds of logical-request start for answer/navigation outcomes; all completed logical requests within 15 seconds |
| Cost | All stage calls fit the logical bounds, campaign controls, and original shared budget |

Correct kinds are one measurement, not a complete quality pass. Review every claim, clarification message, and expected facet before declaring the semantic gates met. Use `full`, `partial`, `unsupported`, or `contradicted`, with a reason tied to the cited packed passages. A multi-assertion block receives `full` only if every material assertion is supported. Clarification has no claim-support percentage; require a useful question before supplying numbers or procedures. Navigation must both identify the intended source and use the correct kind. Material scope and units must be explicit when the predeclared facet requires them.

Record the reviewer, method, date, relationship to the project, and any disputed judgments. A second review should cover each category and every disputed or failed judgment. Preserve differing judgments and adjudication reasons. Assistant review must not be described as independent human review.

Report kind accuracy, complete-task counts, full-support grades, failures, timing, and cost separately. Include stage and aggregate usage, logical-request latency, source/prompt hashes, conservative commitments, and provider-reported charges. A passing result applies only to these small authored cases; it establishes neither general web accuracy nor production availability, source truth, or broad adversarial robustness.
