# Fresh answer-behavior confirmation

Historical protocol: this corpus has since been executed and exposed. Its original cases, gates, and limits below remain unchanged as the record of that confirmation. It is now regression material, not a fresh holdout for the current two-stage revision. Current runtime and evaluation limits are described in [answer-evaluation.md](answer-evaluation.md).

Prepared 14 November 2026 before the confirmation run. This protocol supplements [the original owned-evidence evaluation](answer-evaluation.md). Earlier results and their failed gates remain intact. It evaluates the revised answer pipeline on supplied fictional evidence, not search-provider relevance or general web accuracy.

## Corpus and separation

The [fresh corpus](../../fixtures/answers/confirmation-v3.json) contains twelve newly authored cases, all marked `holdout`, with IDs `ANS21` through `ANS32`. Every product, value, policy, and document passage is fictional. The `example.com` URLs identify supplied sources and must not be fetched.

| Category | Cases | Expected response kinds |
| --- | ---: | --- |
| Genuine ambiguity: entity, key type, unspecified measure | 3 | 3 clarify |
| Navigation: direct request, paraphrase, destination location | 3 | 3 navigation |
| Material context: supersession, scope exception, multiple requested facets | 3 | 3 answer |
| Controls: explicit comparison, explicit disambiguation, same-entity conflict | 3 | 3 answer |

The context-case facets are justified by explicit parts of each query. No case requires an unrequested historical explanation merely to satisfy the rubric. The controls check that improving clarification does not turn clear comparisons, explicitly identified entities, or conflicting evidence about one entity into unnecessary clarification.

A separate assistant authored this corpus without changing generation code. Only category counts, paths, and its hash were sent to the implementation agent before implementation freeze; no case names, values, queries, or passages were intentionally shared. This is limited separation within the same project and assistant family, not independent human evaluation. The corpus author had access to the previous evaluation and its failure themes. Record any later pre-run exposure rather than claiming blinding that did not occur.

The corpus SHA-256 at predeclaration is `eea578857ef5d419d851cab13d7dce86cc8e8d6081505cdf97899f2a6b0d0ad8`. Combined source-passage text is at most 350 UTF-8 bytes per case. The generator must still record the exact packed passages; only those passages may support a grade.

## Freeze and execution

1. Use previously exposed cases for development or regression checks. Label them as such; they are not fresh confirmation evidence.
2. Freeze the implementation, prompt, corpus, model, and rate-card hashes before dispatching any fresh case. Reuse the existing runner's campaign and reservation protections.
3. Run one request per fresh case in a new campaign. Preserve every response, failure, and uncertain reservation. No automatic retries, answer repair call, retrieval, or paid model judge is part of this confirmation set.
4. Grade all cases against their predeclared response kinds and facets. Do not revise a required facet after seeing an output. If a fixture itself is found defective, record that defect and its impact; do not silently omit it from the denominator.
5. A further implementation revision after fresh outputs are visible requires a separately named campaign. These twelve cases then become exposed regression cases; a later fresh-confirmation claim needs another independently authored set.

## Gates and review

| Criterion | Predeclared gate |
| --- | --- |
| Completion | All 12 cases complete normally; disclose and retain every failure |
| Response kind | All 12 match their declared kind, including all three negative controls |
| Task coverage | Every required facet is met in every case; correct kinds alone do not establish completion |
| Citation integrity | Every emitted citation resolves to a supplied source; destinations come from the server source map |
| Evidence support | At least 90% macro full support across applicable claim-block answers and zero critical invented claims |
| Responsiveness | Successful answer/navigation cases produce a first validated cited claim within 8 seconds; every successful response completes within 15 seconds |
| Budget | Every dispatch reserves in the original shared $5 ledger, with no reset or refund assumption |

Use the original support scale: `full`, `partial`, `unsupported`, or `contradicted`. A claim block containing several assertions receives `full` only if all material assertions are supported by its cited packed passages. Record one justified judgment for every claim and every facet. Review clarification messages for a useful question and for invented assumptions; absence of claims gives no support percentage, not an automatic perfect score. For navigation, verify both the declared `navigation` kind and selection of the intended supplied destination. For conflict, distinguish unresolved evidence from an unidentified entity.

Report completion, kind accuracy, full-support grades, coverage, and latency separately, with counts by category. Identify every reviewer and method. A second review should include at least one case from each category and all disputed or failed judgments. Assistant review must not be described as human review or external independence.

## Budget allocation and reporting

The generation bounds stay unchanged: one configured model call per case, at most 4,000 input tokens, 600 output tokens, and a 15-second deadline, without automatic retries. The existing $0.01 conservative reservation makes this twelve-case confirmation pass **$0.12**. The runner must verify current model eligibility and rates before inference.

The user authorized work within **$2.918 remaining** from the original experiment. Development/regression requests also consume that same allowance and must be reported separately from the fresh twelve-case pass. Existing per-campaign controls remain in force; this protocol neither raises the original $5 cap nor creates a new budget. Gateway credits are a billing source, not additional authorization to spend.

Publish the frozen hashes, all outcomes, attributed review, conservative commitments, and provider-reported charges separately. A passing result is evidence for these small authored scenarios only. Do not claim production availability, broad ambiguity resolution, general source truth, or superior search-provider quality from it.
