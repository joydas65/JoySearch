import { join } from "node:path";
import { appendLedger, assertReservationFits, ledgerState, readLedger, withEvaluationLock } from "../lib/evaluation.ts";
import { HOSTED_BUDGET_MICROS } from "../lib/hosted-budget.ts";

// This allocation is a permanent reservation, not an API charge or a new budget.
// Never refund it locally while hosted operations can still consume the allocation.
const directory = join(process.cwd(), ".evaluation");
const callId = "allocation/joysearch-hosted-v1";
await withEvaluationLock(directory, async () => {
  const file = join(directory, "ledger.jsonl");
  const entries = await readLedger(file);
  const existing = ledgerState(entries).reservations.get(callId);
  if (existing && (existing.provider !== "hosted-budget" || existing.amountMicros !== HOSTED_BUDGET_MICROS)) {
    throw new Error("Hosted allocation does not match; refusing to change it.");
  }
  if (!existing) {
    assertReservationFits(entries, HOSTED_BUDGET_MICROS);
    if (process.argv.includes("--run")) {
      const reservation = { kind: "reserve" as const, callId, invocationId: callId, at: new Date().toISOString(),
        provider: "hosted-budget" as const, queryId: "hosted-budget-allocation", split: "interactive" as const,
        repetition: 1, amountMicros: HOSTED_BUDGET_MICROS };
      await appendLedger(file, reservation);
      entries.push(reservation);
    }
  }
  console.log(JSON.stringify({ allocated: Boolean(existing) || process.argv.includes("--run"),
    hostedAllocationMicros: HOSTED_BUDGET_MICROS, localCommittedMicros: ledgerState(entries).committedMicros,
    note: "The hosted allocation is included in local commitments; do not add it again as actual provider spend." }, null, 2));
});
