# JoySearch design brief

Date: 11 November 2026. Owner: Joy Das. Original design, with delivery sequence updated 15 November 2026.

**Current scope:** search, cited answers, and durable spending controls are deployed. Milestone 3 adds a credential-free sample experience and automated release checks with zero paid API calls. Persistent research is deferred. The original recurring-budget estimates below are historical proposals, not authorized spending; the current permanent allocation and remaining authorization are documented in the [deployment runbook](../deployment.md).

JoySearch will help a visitor find useful web pages, obtain a supported answer, and investigate a question more deeply. The portfolio objective is to demonstrate senior full-stack execution and staff-level judgment through explicit scope, measurable tradeoffs, failure handling, and decisions another engineer can review.

The first release will use one search provider and one model. Exa Auto and Brave Web Search are evaluation candidates; neither is a measured winner. The [architecture plan](architecture-plan.md) describes the implementation boundaries. The [provider evaluation](provider-evaluation.md) defines the selection method and budget.

## Product and audience

The primary user is a technically curious person researching a question or engineering decision. Demonstration scenarios will emphasize documentation lookup, software comparisons, and questions requiring several sources. General web search remains available. Recruiters should understand the product in two minutes; engineers should be able to inspect its decisions, measurements, and failure behavior.

The core product promise is that links remain usable while answer generation or research proceeds independently. Sources, uncertainty, and incomplete work should be visible.

| Mode | User outcome | Initial scope |
| --- | --- | --- |
| Search | Find relevant pages quickly | Ten ranked results with titles, URLs, excerpts, and available dates; keyboard and mobile support |
| Answer | Understand the retrieved evidence | Explicit Answer action after search; streamed response with citations linked to actual retrieved sources |
| Research | Explore a question requiring more evidence | Explicit start, progress, bounded follow-up searches, cancellation, partial findings, and saved run viewing where retention is permitted |

Answer and Research are available to every visitor within the demo allowance. They do not run automatically for every query. Navigation queries should lead to the intended destination; ambiguous queries should invite clarification. An absence of sufficient evidence is a valid outcome.

## Portfolio evidence

| Capability | Evidence to produce |
| --- | --- |
| Product judgment | This brief, explicit constraints, and a small set of end-to-end scenarios |
| Architecture | A clear component diagram, typed boundaries, and decisions with reasons and reconsideration triggers |
| Full-stack ownership | Accessible interactions, request validation, server-only credentials, persistent research state, and a working deployment |
| Reliability | Deterministic demonstrations of timeout, cancellation, malformed response, and generation failure |
| Measurement | Reproducible provider comparison, latency distributions, human evidence review, and cost per task |
| Communication | A concise README, two-minute demo, and a case study explaining a measured improvement |

These artifacts demonstrate technical judgment. Résumé claims will identify evaluation or simulated traffic and use measured numbers; organizational leadership claims will come from professional experience. Staff expectations vary by company; responsible tradeoffs, decomposition of ambiguity, and production understanding are relevant examples in [GitLab's Staff Fullstack framework](https://handbook.gitlab.com/handbook/engineering/careers/matrix/development/dev/fullstack/staff/).

## Scope and operating limits

Retain Next.js, TypeScript, Tailwind, and the existing deployment. Add one server application and one relational database as justified by usage accounting and research state. Research may use one managed job executor. Provider and model selection must remain reversible through narrow interfaces.

The initial release excludes accounts and billing, team collaboration, a web crawler, a proprietary index, a vector database, multiple cooperating agents, and automatic provider failover. These do not currently solve a required user problem. Public sharing and permanent report storage remain later decisions because they introduce access and retention requirements.

| Resource | Proposed limit | Enforcement or dependency |
| --- | --- | --- |
| One-time provider evaluation | $5 total external API usage | Preflight calculation, call/token limits, and cost ledger; details in the evaluation plan |
| Recurring external APIs | $15/month allowance | Alert at $10; stop dispatch at $12 including reservations; retain $3 for billing reconciliation |
| Hosting, database, and job execution | Target $0; at most $5/month combined | Verify eligible free tiers and minimum charges before provisioning |
| Recurring cash budget | Target at most $20/month | Include minimum commitments and taxes in the preflight estimate; revise scope if a plan exceeds the allowance |
| Guest live usage | Initially 5 searches, 2 answers, and 1 research run per session per day | Shared counters plus a global cap; session limits alone do not prevent abuse |

These are planning limits, not a commitment to purchase services. Free credits are excluded from unit-cost comparisons. A clearly labeled sample-data mode will keep the demo useful after live usage is exhausted. Sample data must be owned, synthetic, or explicitly licensed, and cannot imply a current live search.

## Success criteria

The following are initial product targets to measure in the deployed application. They are distinct from the provider-only pilot gates and are not achieved performance claims.

| Outcome | Target and measurement |
| --- | --- |
| Responsive search | p95 at most 3 seconds from submit to usable results under the documented demo workload |
| Useful answer | p95 at most 8 seconds to the first substantive answer content with an associated source; loading text does not count |
| Bounded work | Ordinary answer finishes or returns an explicit partial/failure state within 15 seconds; research actively executes for at most 60 seconds and has a 90-second overall deadline |
| Citation integrity | Every emitted citation maps to evidence actually available to that run; no fabricated source URLs |
| Graceful failure | Existing search results stay usable if generation fails; superseded requests never replace current results |
| Accessible use | Core flow works with keyboard, visible focus, screen-reader status announcements, and a narrow viewport |
| Predictable spend | New paid work requires an atomic budget reservation and respects request, session, and global limits |

A performance miss leads to a recorded tradeoff and a revised implementation or target. It must not be hidden by omitting failed requests or relabeling targets as results.

## Delivery sequence

1. **Milestone 1 — design and evaluation preparation.** Deliver this brief, architecture, frozen query corpus, scoring rules, and budget. Leave measured results and provider selection pending until the eligible comparison is executed.
2. **Milestone 2 — search and answers.** Implement server routes, one selected provider, evidence-linked streaming, shared usage accounting, and meaningful integration tests. Deploy the complete flow with automated checks.
3. **Milestone 3 — sample mode and release checks.** Demonstrate owned examples without credentials or provider requests. Automate lint, types, existing regression checks, a production build, and focused browser failure-path checks. Preserve live API and accounting boundaries. See the [milestone contract](../milestone-3/release-checks.md).
4. **Presentation follow-up.** Use the existing evaluation and release evidence for a concise engineering case study and two-minute walkthrough. Persistent research remains deferred until a concrete portfolio need justifies its implementation, retention decisions, and separate budget.

## Decisions still required

Provider selection depends on measured usefulness, latency, complete-task cost, and applicable permissions for public search, answer grounding, evaluation, and retention. A search subscription alone does not establish all of those permissions. If saved provider-derived content is not permitted within budget, durable evidence retention must be redesigned or the provider rejected for that mode.

The model, database host, and job executor remain implementation choices. Select them against the limits above, with one candidate per responsibility and an explicit reason to add any dependency. The [evaluation decision record](provider-evaluation.md#result-artifact-and-decision-record) will capture the first provider decision.
