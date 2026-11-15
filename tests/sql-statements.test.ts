import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { migrationStatements } from "../scripts/sql-statements.ts";

test("budget migration keeps each PL/pgSQL function intact inside one outer transaction", async () => {
  const sql = await readFile(new URL("../scripts/sql/hosted-budget.sql", import.meta.url), "utf8");
  const statements = migrationStatements(sql);
  assert.equal(statements.filter(statement => statement.startsWith("CREATE OR REPLACE FUNCTION")).length, 3);
  assert.equal(statements.filter(statement => statement.startsWith("CREATE TABLE")).length, 3);
  assert.ok(statements.every(statement => !/^(BEGIN|COMMIT)$/i.test(statement)));
  const reserve = statements.find(statement => statement.startsWith("CREATE OR REPLACE FUNCTION joysearch_budget.reserve"))!;
  assert.ok(reserve.includes("FOR UPDATE;"));
  assert.ok(reserve.endsWith("END;\n$$"));
});

test("semicolons in tagged dollar strings, quoted identifiers, comments and escaped strings are retained", () => {
  const sql = String.raw`/* outer /* inner ; */ comment */ BEGIN;
    SELECT 'a;''b', "column;name";
    -- do not split this ; comment
    SELECT E'escaped\'quote;';
    CREATE FUNCTION f() RETURNS text AS $body$ BEGIN RETURN ';'; END; $body$ LANGUAGE plpgsql;
    COMMIT; /* final /* nested */ comment */`;
  const statements = migrationStatements(sql);
  assert.equal(statements.length, 3);
  assert.equal(statements[0], `SELECT 'a;''b', "column;name"`);
  assert.ok(statements[2].includes("RETURN ';'; END;"));
});

test("incomplete SQL is rejected before dispatch", () => {
  for (const sql of ["SELECT 1", "SELECT 'unfinished;", "SELECT $$unfinished;", "/* unfinished", 'SELECT "unfinished;']) {
    assert.throws(() => migrationStatements(sql));
  }
});
