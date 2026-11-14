# JoySearch deployment and spending controls

Prepared 14 November 2026. **Release verification pending.** Hosted controls are implemented and a separate Neon database has been provisioned on the existing Free plan. This document does not yet claim a successful public release.

## Release record

| Item | Target or status |
| --- | --- |
| Repository | [joydas65/JoySearch](https://github.com/joydas65/JoySearch) |
| Vercel team | `joydas0111-7078s-projects` |
| Vercel project | `joysearch` |
| Production origin | `https://joysearch.vercel.app` |
| Pull request / commit | Pending release preparation |
| Verified deployment URL / state | Pending deployment verification |
| Paid-work enablement | Disabled until allocation, controls, and release checks are verified |

Use the existing Hobby hosting and Neon Free plan. No purchase, credit top-up, subscription upgrade, or recurring paid infrastructure is part of this release. Plan limits can make the demo unavailable; availability is subordinate to the spending bound.

## Budget ownership

The original $5 experiment has $3.922 in conservative commitments and $1.078 remaining before this release. Reserve **$1.000** once in the original local ledger for the hosted demo; leave **$0.078** locally. The hosted ledger tracks consumption within that transferred allocation. It is not another dollar added to the original authorization, and its operations must not also be deducted a second time from the local remainder.

| Hosted operation | Reservation |
| --- | ---: |
| Exa search | $0.007 |
| Brave search, if explicitly configured | $0.005 |
| Cited answer, including both possible model stages | $0.010 |
| Signed session total | $0.050 |
| Permanent hosted allocation | $1.000 |

Reservations are integer microdollars. The SQL function locks the singleton budget row before checking the cap, session limit, pacing, and operation uniqueness. Only a successfully validated reservation permits provider dispatch. The process never holds a SQL transaction open during search or inference.

Failures, cancellation, uncertain outcomes, lower actual charges, and expired sessions do not refund commitments. Global accounting has no TTL or monthly reset. A deployment or rollback must use the same database and `joysearch_budget` schema; creating a fresh database is not a way to replenish the allowance. The runtime cannot initialize, reset, or enable the budget.

The current reservations cover the fixed request shapes and verified rate cards. They are not a guarantee that providers will never change prices. Review Exa and model rates before enablement or a provider/model change. A reported search charge above its reservation records the larger known amount and disables further work. That detects a price anomaly after the call; it cannot undo a charge already incurred. Keep Gateway/provider limits as secondary controls, and do not enable automatic top-ups.

## Secrets and environment boundaries

| Variable or credential | Scope and purpose |
| --- | --- |
| `BUDGET_DATABASE_URL` | Production Secret using only the restricted `joysearch_runtime` role |
| `EXA_API_KEY` | Production Secret for the selected search provider |
| `AI_GATEWAY_API_KEY` | Production Secret for bounded answer generation |
| `ANSWER_CONTEXT_SECRET` | Production Secret, independently generated hexadecimal key of at least 32 random bytes |
| `SEARCH_PROVIDER=exa` | Production Config selecting the verified provider |
| `JOYSEARCH_ORIGIN=https://joysearch.vercel.app` | Production Config; exact canonical HTTPS origin, with no trailing slash |
| `JOYSEARCH_LIVE_ENABLED` | Production Config; keep `false` until release verification permits `true` |
| Neon owner/migration credentials | Development/operator use only; never attach to production or previews |

Do not set Vercel's system environment variables manually. Hosted requests require its production environment, the explicit live flag, and matching request URL, Host, and Origin. Forwarded headers do not grant access. Alternate domains and preview deployments cannot start paid work. Previews must not receive production provider keys, the signing key, or the runtime database secret.

Use the Vercel secret mechanism; never place credentials in PR text, Git, client variables, build output, or logs. Pull development environment values into a separate ignored local file and preserve existing `.env.local` values. A production secret cannot be reconstructed by assuming `vercel env pull` returns it.

The runtime role can execute only `joysearch_budget.reserve`, `settle`, and `status`, and has no direct table privileges. The deployed runtime rejects a budget database URL using an owner role. Operational metrics are bounded and allowlisted; query text, page passages, generated answers, raw session IDs, and IP addresses are not stored in the accounting tables.

## Provision and verify

The operator workflow is explicit and separate from request handling:

1. Verify the intended Vercel team/project and the existing free plans. Provision the dedicated database only once, with admin credentials connected to development only.
2. Record the fixed hosted allocation using `scripts/allocate-hosted-budget.ts` against the original `.evaluation/ledger.jsonl`. Keep its durable allocation record. Do not remove it if a later setup step fails.
3. Provision the separate `joysearch_runtime` login role with a generated secret through the operator connection, then apply `scripts/sql/hosted-budget.sql` through `scripts/apply-hosted-budget.ts` using the database owner credential. The migration grants that role only the required functions and creates the singleton with `enabled=false`. Reapplying the migration preserves commitments and enablement state.
4. Run `scripts/verify-hosted-budget.ts` against its isolated verification state. Confirm actual SQL concurrency, exact-boundary refusal, duplicate operations, retained failed charges, idempotent settlement, disabled/missing state, and restricted runtime permissions. Do not reset the production accounting tables to conduct a test.
5. Run lint, TypeScript checks, network-free tests, and a production build. Inspect the final diff for credentials and environment files before pushing the PR.
6. Configure production-only Secrets and Config values, keeping live work disabled. Deploy the exact reviewed commit. Verify the UI, production origin, disabled paid routes, and preview refusal before enabling anything.
7. After confirming the allocation and database status, enable the SQL budget and the production live flag. Perform only the preallocated smoke requests needed to verify search, signed evidence, cited answers, and the final durable reservations. Record the commit, deployment URL, results, and remaining allowance in the release record.

From the repository root, the allocation and migration commands are:

```sh
# Inspect first; no paid API calls or budget mutation.
node scripts/allocate-hosted-budget.ts
# Record the fixed allocation once; reruns do not allocate another dollar.
node scripts/allocate-hosted-budget.ts --run
# Requires the precreated runtime role; this does not enable paid work.
node --env-file=.env.hosted-admin.local scripts/apply-hosted-budget.ts --run
```

The ignored `.env.hosted-admin.local` file supplies `DATABASE_URL`. Database verification uses `node scripts/verify-hosted-budget.ts --run` with both this owner variable and `BUDGET_DATABASE_URL` supplied privately. It creates and removes an isolated verification schema, reports only sanitized results, and makes no search or model calls. Its test-only counter resets must never be copied into the real accounting schema.

The answer-quality pipeline has a preserved [fresh owned-case evaluation](milestone-2/revision-results.md). That historical result does not measure the hosted ledger or production latency. Deployment controls have separate tests; do not rewrite the historical evidence bundle to make its frozen hashes match later code.

## Pause and inspect

Use the owner credential through a trusted SQL console or operator connection. The immediate kill switch is:

```sql
UPDATE joysearch_budget.budget SET enabled = false WHERE id = 1;
SELECT joysearch_budget.status();
```

This blocks new reservations across existing deployments. Already reserved requests may finish and remain accounted for. Also set `JOYSEARCH_LIVE_ENABLED=false` for subsequent deployments when pausing the service; changing an environment variable alone does not retroactively change every existing deployment.

To inspect without exposing stored operation details:

```sql
SELECT joysearch_budget.status();
```

Re-enable only after checking the reason for the pause, current prices, existing allocation, and remaining balance. Enabling never resets the committed amount:

```sql
UPDATE joysearch_budget.budget SET enabled = true
WHERE id = 1 AND cap_micros = 1000000 AND committed_micros < cap_micros;
SELECT joysearch_budget.status();
```

Missing or malformed status must be treated as unavailable, not an empty ledger. Preserve unresolved reservations and provider request IDs for reconciliation. Do not infer a refund from missing usage data or a client error.

## Failure and rollback behavior

| Condition | Expected behavior |
| --- | --- |
| Preview, foreign origin, disabled flag | Denied before database/provider access |
| Missing credential or malformed runtime URL | Paid work unavailable |
| Database error or uncertain reservation response | No provider dispatch; no automatic retry |
| Reused operation or answer receipt | Duplicate refused; no repeated provider call |
| Session quota or pacing limit | Controlled unavailable/rate-limit response |
| Global allocation exhausted or SQL switch disabled | New paid work stops; existing displayed results remain |
| Provider failure/disconnect | Reservation retained; signed session preserved |
| Settlement failure | No successful completion event; reservation retained |

For rollback, pause new work in SQL first, then restore a known deployment without changing the accounting database. Do not enable an older release that lacks these hosted controls. Reverify origin policy and the existing committed total before re-enabling. Credentials, the allocation record, and ledger rows are not build artifacts to roll back.

Signed sessions last 24 hours, with a $0.05 total and separate 5-second search / 10-second answer pacing. Anonymous visitors can create new sessions; these limits are friction, not identity verification. They can exhaust the global allowance but cannot bypass its atomic reservation check. The project deliberately remains a small portfolio demo, with no promise of continuous live API availability or production-scale abuse resistance.
