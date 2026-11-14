import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { migrationStatements } from "./sql-statements.ts";

if (!process.argv.includes("--run")) {
  console.log("Dry run: applies scripts/sql/hosted-budget.sql using DATABASE_URL. Requires a precreated joysearch_runtime role. Does not enable live work.");
} else {
  if (!process.env.DATABASE_URL) throw new Error("Set a separate operator DATABASE_URL; never deploy it as the runtime credential.");
  const sql = neon(process.env.DATABASE_URL);
  const migration = await readFile(new URL("./sql/hosted-budget.sql", import.meta.url), "utf8");
  await sql.transaction(migrationStatements(migration).map(statement => sql.query(statement)));
  const [row] = await sql.query("SELECT joysearch_budget.status() AS result");
  console.log(JSON.stringify({ migrationApplied: true, status: row.result }));
}
