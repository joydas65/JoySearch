/** Split a PostgreSQL migration into statements for a single Neon HTTP transaction. */
export function migrationStatements(source: string): string[] {
  const statements: string[] = [];
  let codeStart = -1;
  let quoted: "'" | '"' | undefined;
  let escapedString = false;
  let dollar: string | undefined;
  let lineComment = false;
  let commentDepth = 0;
  const append = (end: number) => {
    const statement = codeStart < 0 ? "" : source.slice(codeStart, end).trim();
    if (statement && !/^(BEGIN|COMMIT)$/i.test(statement)) statements.push(statement);
  };
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    const pair = source.slice(index, index + 2);
    if (lineComment) { if (character === "\n") lineComment = false; continue; }
    if (commentDepth) {
      if (pair === "/*") { commentDepth++; index++; }
      else if (pair === "*/") { commentDepth--; index++; }
      continue;
    }
    if (dollar) {
      if (source.startsWith(dollar, index)) { index += dollar.length - 1; dollar = undefined; }
      continue;
    }
    if (quoted) {
      if (escapedString && character === "\\") { index++; continue; }
      if (character === quoted) {
        if (source[index + 1] === quoted) index++;
        else { quoted = undefined; escapedString = false; }
      }
      continue;
    }
    if (pair === "--") { lineComment = true; index++; continue; }
    if (pair === "/*") { commentDepth = 1; index++; continue; }
    if (character === ";") { append(index); codeStart = -1; continue; }
    if (/\s/.test(character)) continue;
    if (codeStart < 0) codeStart = index;
    if (character === "'" || character === '"') {
      quoted = character;
      escapedString = character === "'" && /[eE]/.test(source[index - 1] ?? "") && !/[A-Za-z0-9_$]/.test(source[index - 2] ?? "");
      continue;
    }
    if (character === "$") {
      const match = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) { dollar = match[0]; index += dollar.length - 1; continue; }
    }
  }
  if (quoted || dollar || commentDepth) throw new Error("Incomplete migration SQL");
  // A final comment needs no terminator; a final SQL statement does.
  if (codeStart >= 0) throw new Error("Migration statements must end with semicolons");
  return statements;
}
