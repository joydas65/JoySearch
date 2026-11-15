# Milestone 3: sample mode and automated release checks

Prepared 15 November 2026. This milestone is a focused personal-portfolio change: make the existing behavior inspectable without provider credentials, and make release checks repeatable. It introduces no new paid infrastructure, provider/model configuration, or evaluation allocation.

## Acceptance contract

| Boundary | Required outcome |
| --- | --- |
| Sample identity | The sample page and answer clearly identify authored fictional examples; no claim of fresh retrieval or new model generation |
| Sample transport | Selecting and playing examples makes zero requests to search, model, or budget services |
| Evidence | Sample citations open the matching owned source passages in this app |
| Shared UI | Sample playback uses the existing result and answer presentation, including cancellation and source inspection |
| Stale work | Switching samples or replacing a search prevents old work from changing the current result |
| Failure behavior | A cancelled, malformed, or unavailable answer leaves useful search results available |
| Accessibility | Core controls work with keyboard, visible focus, status announcements, and a narrow viewport |
| Release isolation | Build and browser server run from a source copy without local secrets or private ledgers; live work remains disabled |
| Repeatability | Lint, type checks, regression tests, production build, and focused browser tests pass from one release command |
| Cost | No paid API calls, budget resets, new allocations, or production database mutations |

## Sample boundary

`/samples` is an explicit destination linked from the live search page. The examples are authored for JoySearch and use fictional facts. Their source passages are served by `/samples/sources`; they do not copy provider search results. A sample does not fall back to a live query when its playback fails.

The client selects a fixed example, displays its owned search results, and plays a predetermined answer through the shared answer component. Delays demonstrate visible progress and cancellation. They are simulated and must never be reported as provider or end-to-end latency measurements.

Live search continues to use the existing server routes, signed receipts, exact-origin policy, and durable budget reservations. No query parameter, client flag, sample receipt, or preview setting bypasses those controls. Sample data and playback code do not need credentials, database access, or a server-side mode switch.

## Release checks

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check:release
```

Use `pnpm exec playwright install --with-deps chromium` on Linux. Add `--keep` to `pnpm check:release` to retain the isolated directory; otherwise it is removed on completion or failure. Browser binaries and dependencies are ordinary development tooling downloads, not provider/model calls.

The same release command is intended for a local checkout and GitHub Actions. It validates the source in an isolated temporary directory, excluding environment files, local accounting, Git/Vercel metadata, and generated output. Child processes receive a small environment allowlist; funded-provider credentials and inherited Node preload options are not forwarded. The browser server uses a production build with live work disabled.

Browser tests block unexpected external and API requests. Sample tests assert that no such request was even attempted. Live-UI tests supply owned search/answer responses at the browser boundary and record expected requests. Those tests exercise rendering, cancellation, source-ID validation, and stale-response handling, rather than search relevance or model quality. An unmocked paid route cannot dispatch from the isolated server.

GitHub Actions runs these checks on pull requests and main using a standard Ubuntu runner, read-only repository permissions, bounded execution time, and cancellation of superseded runs. It needs no production secrets, uses no paid evaluation jobs, and uploads no artifacts or caches. Logs and the job summary carry the result. Production deployment and promotion remain explicit operator actions after checks and review.

The existing eleven real-Postgres scenarios remain separate operator validation. This milestone does not rerun them against production or claim that mocked CI tests establish real database concurrency behavior.

The sample callback supplies authored events directly to the shared component. Separate live-UI browser tests exercise the production NDJSON decoder with mocked HTTP responses, including an invented citation ID that must be rejected. A sample passing its own playback test is not evidence that the live parser or a model produced that result.

## Evidence and limits

Local verification on 15 November 2026 passed **106 offline tests**, lint, TypeScript checks, the production Webpack build, and **9 Chromium browser tests** through `pnpm check:release`. The sample page was also inspected in Chrome; the fictional-data notice, authored answer, and same-origin citations rendered correctly with no captured browser warnings or errors. These checks made no paid API calls. The committed workflow repeats the same checks on pull requests and main.

Sample outcomes are predetermined demonstrations. Passing their tests establishes interaction behavior and separation from paid work; it does not measure AI correctness. The [historical twelve-case answer evaluation](../milestone-2/revision-results.md), [initial failed evaluation](../milestone-2/results.md), and [production smoke](../deployment.md) retain their original scope and dates.

The last verified authorization after merging PR #2 was **$0.983 hosted plus $0.078 local, or $1.061 total**. The hosted amount is already allocated inside the original $5 ledger and cannot also be spent locally. This milestone reserves none of it. Public live visitors can reduce the hosted remainder independently.

## Release procedure

1. Run the complete isolated release check and review the diff for changes to live request, secret, and accounting boundaries.
2. Require the PR's automated check to pass for its current revision. A workflow file alone is not branch protection; repository-required-check configuration must be verified separately.
3. Review and merge the focused PR. This milestone does not authorize automatic production promotion.
4. For a separately requested release, follow the existing [staged production procedure](../deployment.md). Verify sample playback with no API requests and verify the canonical request guards before promotion.

Persistent research, additional provider/model comparisons, accounts, and an observability platform remain outside this milestone.
