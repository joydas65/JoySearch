# Cited answers with measured quality

Historical single-stage baseline. The subsequent [intent and context revision](revision-results.md) reports the final two-stage implementation and its separate fresh confirmation; the failed results below remain unchanged.

14 November 2026. Status: **implemented and verified locally; the complete quality gate does not pass.** This is a personal portfolio experiment, not a production search-quality or availability claim.

JoySearch returns search links first. An explicit action generates an answer from at most five supplied excerpts, with clickable citations and inspection of the exact passages. The browser preserves search results when an answer fails. One model call, a 15-second deadline, a 4,000-input-token upper bound, and a 600-output-token cap keep the work bounded. No autonomous research loop, extra retrieval, or paid judge was added.

## Measured outcome

The frozen `cited-v2` campaign used `openai/gpt-4.1-mini` on four development cases and eight previously unrun holdout cases. All documents are fictional and authored for this project. The [protocol](answer-evaluation.md) predates the run; [the evidence bundle](measured-results.json) includes both campaigns, exact prepared passages, generated outputs, configuration hashes, and attributed review judgments.

| Measurement | Development | Holdout | Combined |
| --- | ---: | ---: | ---: |
| Completed responses | 4/4 | 8/8 | 12/12 |
| Correct response kind | 3/4 | 7/8 | **10/12 — gate failed** |
| Citation references resolving to supplied sources | 14/14 | 16/16 | 30/30 |
| Fully supported rendered claim blocks, assistant-reviewed | 12/12 | 15/15 | 27/27 |
| Tasks meeting all declared facets and response-kind requirements | 3/4 | 6/8 | **9/12** |
| Critical invented claims observed | 0 | 0 | 0 |

Seven of the eight primary factual/comparison cases met every required facet, meeting that narrow coverage threshold. The navigation case selected the correct source but returned `answer` instead of `navigation`. The missing-data case abstained without inventing a customer count. The single source-injection development case neither leaked the fixture sentinel nor followed its false PDF-export instruction; this is not a broad adversarial-robustness result.

For these twelve small supplied-evidence requests, generation completion p95 was **2.07 seconds**; first structurally valid cited-claim p95 was **1.67 seconds** across eleven responses containing claims. There were no transport failures in this run. These timings exclude search, browser rendering, larger contexts, concurrent load, and cold-start variability.

## What failed, and the decision it changed

- **Ambiguity (`ANS10`):** “What is Mercury's limit?” produced two correctly cited limits for unrelated products instead of asking which product the user meant. A general prompt revision in `cited-v2` did not fix the `cited-v1` failure. Both runs are retained. A network-free SDK request inspection confirmed the revised system instructions were transmitted.
- **Coverage (`ANS04`):** the current 25 MB limit was correct, but the answer omitted the predeclared requirement to explain that the older 10 MB limit was superseded. The rubric was not relaxed after seeing the result. This requirement is stricter than simply answering the literal query.
- **Response kind (`ANS09`):** the correct password-reset source was supplied, but its terminal response kind was wrong. This fails the protocol's behavior gate even though the destination was useful.

The decision is to retain an experimental local feature and a failed release gate, rather than equate valid citations with satisfactory answers. A future focused revision can test selecting the response kind before emitting claims in the same generation. It should use fresh confirmation cases after this holdout exposure; these results must not be overwritten or presented as an untouched holdout again.

## Review limits

An assistant reviewed every claim against only the exact prepared passages and checked all declared facets. A second assistant, without reading the first judgments, reviewed the ordinary factual, conflict, dated-update, missing-data, and injection cases. Both identified the missing dated-update facet. Both treated attribution plus an explicit unresolved conflict as satisfying the uncertainty requirement; that interpretation is recorded.

All reviewers are project contributors from the same assistant family. There was no independent human review. Fixtures and implementation share project authorship, the sample is small, and rendered claim blocks are not validated atomic-fact segmentation. The observed full-support grades establish neither source truth nor general web accuracy, and do not establish an Exa-versus-Brave quality winner. No live search-provider excerpts are included in the published evidence bundle.

## Cost and verification

This milestone made **17 model calls**: four baseline development calls, twelve revised-campaign calls, and one live browser smoke call. Gateway reported **$0.0056888** for them. The browser smoke also made one Exa search, reported at **$0.007**. No top-up or recurring purchase was made.

The local ledger conservatively committed **$0.177** for this milestone, retaining a $0.01 reservation for each generation rather than refunding the difference. Including previous search evaluation and Gateway setup, the original $5 experiment has **$2.082 committed and $2.918 remaining**. The separately checked Gateway free-credit balance was **$4.9943063**; it is not an increase in the authorized experiment budget.

Verification completed:

- 49 network-free tests, lint, TypeScript, and a production webpack build passed.
- A real local browser flow returned ten Exa results, then completed a three-claim answer; source inspection worked with mouse and keyboard. A 390-pixel viewport override showed no horizontal overflow; the original viewport was restored. No browser warnings or errors were captured.
- Local HTTP checks rejected forged receipts, cross-origin requests, empty searches, and oversized bodies before any ledger entry or paid request.
- Regression tests exercise malformed/truncated streams, fabricated citation IDs, cancellation, session mismatch, expiry, budget exhaustion, concurrent accounting, and uncertain charges. Manual browser verification covered the happy path; it did not independently reproduce every synthetic failure.

## Portfolio evidence and next boundary

The reviewable engineering work is the separation of retrieval from optional generation, a session-bound evidence receipt, strict stream validation, durable pre-dispatch cost reservations, and a reproducible evaluation that preserved failures. Citation destinations come from the signed server map, not model-produced URLs. Completion waits for normal provider termination and ledger settlement. Logs exclude queries, page text, and credentials.

The implementation remains one Next.js application. Hosted paid routes deliberately fail closed because a local file ledger cannot enforce shared serverless quotas. These changes have **not been deployed**. The next decision is whether an owned-fixture public demo is sufficient for the portfolio, or whether live public search merits shared atomic quotas and abuse controls after the answer-behavior gate improves. Research orchestration remains deferred.
