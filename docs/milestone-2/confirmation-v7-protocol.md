# Fresh confirmation after routing revision

Prepared 14 November 2026 before any request using this corpus. The earlier `confirmation-v3` corpus has been exposed through its failed run and is now regression material. Its results and rubric remain unchanged. This document preregisters a separate confirmation set for the revised bounded routing-and-answer workflow.

## Corpus

The [new corpus](../../fixtures/answers/confirmation-v7.json) contains twelve authored fictional cases, IDs `ANS41` through `ANS52`, all marked `holdout`.

| Category | Cases | Expected response kinds |
| --- | ---: | --- |
| Genuine ambiguity: entity, object type, unspecified measure | 3 | 3 clarify |
| Navigation expressed through different destination-request phrases | 3 | 3 navigation |
| Material context: per-entity/time unit, multiple limits, dated revision | 3 | 3 answer |
| Controls: explicit comparison, explicit disambiguation, same-entity conflict | 3 | 3 answer |

There are seventeen required facets. The queries explicitly request the relevant scope, units, or revision context; the rubric does not add an unrelated requirement after the response. The negative controls test whether a routing fix creates unnecessary clarification for already clear queries. All source URLs are identifiers under `example.com/joysearch-fixtures/` and must not be fetched.

Corpus SHA-256 at predeclaration: `9979af95ae3ebf550007ff271f541921faaedd7dd2d4467489c48a54a2065b18`. Combined source-passage text is at most 383 UTF-8 bytes per case, below the 600-byte authoring limit. Review must still use only the exact evidence retained after packing; a complete fixture is not permission to grade against text omitted from model input.

The corpus author is a separate assistant contributor from the implementation agent. Before implementation freeze, only paths, hashes, and counts are shared, not names, values, queries, or passages. This limits direct case exposure but is not independent human evaluation: the corpus author saw earlier failures, belongs to the same assistant family, and contributes to the same project. Record any deviation from that separation.

## Freeze and run

Use already exposed corpora to develop and test the revision. Before dispatching this fresh set, record the implementation, prompts, model settings, rate card, and corpus hashes. Run each of the twelve new cases once in a new campaign. Preserve unsuccessful and uncertain attempts without automatic retries or relabeling.

Do not alter required facets after seeing an output. If a fixture or rubric is found defective, document the defect and its scoring impact; do not silently discard it. Once outputs are visible, this corpus is exposed. A subsequent implementation revision may use it for regression checks, but another fresh-confirmation claim would need a new unrun set.

## Revised work bounds

Each logical request may use **at most two model calls**: routing first, then a cited answer only when required. The aggregate allowance is **8,000 input tokens and 900 output tokens**, with output caps of 300 for routing and 600 for the answer. Both stages share one **15-second deadline**. No search call, repair loop, automatic retry, or paid model judge is added.

The logical request retains one **$0.01 reservation**. The initial candidate was GPT-5 mini with a $0.0038 token-cost ceiling. **Pre-run amendment, 14 November 2026:** after exposed regressions, select GPT-4.1 mini at temperature 0 for the fresh run. Its verified $0.40/$1.60 per-million input/output rates give a **$0.00464** ceiling under the same 8,000/900 token bounds, still below the reservation. This changes the candidate configuration, not any case, facet, quality gate, deadline, or budget. The corpus remains unread by implementation contributors before this selection. Verify current eligibility and rates before dispatch and record actual usage for both stages. A failure or cancellation does not release the reservation. Every call remains subject to the original shared $5 experiment ledger; a Gateway credit balance is not a larger authorization.

One twelve-case confirmation pass therefore reserves **$0.12**. Development, prior confirmation, and subsequent regression usage must be reported separately and continue reducing the original remaining allowance. No budget reset or new top-up is authorized by this protocol.

## Unchanged acceptance gates

| Criterion | Gate |
| --- | --- |
| Completion | All 12 logical requests complete normally; disclose every failure |
| Response kind | All 12 match the predeclared kind, including the three negative controls |
| Task coverage | Every required facet is met in every case |
| Citation integrity | All displayed citation IDs resolve to supplied evidence; the server supplies destinations |
| Evidence support | At least 90% macro full support on applicable claim blocks; zero critical invented claims |
| Responsiveness | Successful answer/navigation requests produce their first validated cited claim within 8 seconds of logical-request start; every successful logical request completes within 15 seconds |
| Cost | Routing and answer work fit the declared logical reservation, campaign controls, and original shared $5 cap |

The two-stage implementation does not reset latency at the answer stage. Report routing latency, time to the first cited claim, and total logical-request latency where available, together with stage-specific and aggregate usage. First-cited-claim latency has no denominator for clarification-only responses.

## Review and reporting

Apply the [original semantic-review definitions](answer-evaluation.md): grade every rendered claim block as `full`, `partial`, `unsupported`, or `contradicted`, with a reason tied to its cited packed passages. A block with several assertions is fully supported only if every material assertion is supported. Record a justified covered/not-covered judgment for every facet, the appropriateness of the final kind, and any critical invented claim.

For clarification, require a useful question before numerical answers or procedures; listing every interpretation and asking afterward does not pass. For navigation, require both the correct destination and `navigation` kind. For material context, check the requested entity scope, unit, and revision/date explicitly. For the controls, distinguish ambiguity from an explicit request to compare, an already identified entity, or a conflict between sources about one entity.

Report support, kind accuracy, task completion, and latency separately, with counts by category. A correct citation ID cannot establish semantic support. Label assistant reviews and their project relationships; a second reviewer should cover at least one case per category and disputed or failed judgments. Preserve disagreements and adjudication reasons rather than presenting consensus that did not occur.

Publish the frozen hashes, all case outcomes, review artifacts, conservative commitments, and provider-reported charges separately. These small authored cases do not establish general web accuracy, source truth, production availability, or a search-provider winner, even if every gate passes.
