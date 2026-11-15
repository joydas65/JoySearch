import { spawn } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Explicit inputs keep local credentials, accounting, and deployment metadata out
// of Next's automatic environment-file loading and the release build entirely.
const SOURCE_INPUTS = [
  "app", "components", "lib", "fixtures", "tests", "scripts", "docs", "public",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json",
  "eslint.config.mjs", "next.config.ts", "postcss.config.mjs", "playwright.config.ts",
  "AGENTS.md",
];
const EXCLUDED_NAMES = new Set([
  ".git", ".agents", ".codex", ".aws", ".evaluation", ".vercel", ".next",
  "node_modules", "out", "test-results", "playwright-report", "next-env.d.ts",
]);

export function includeReleaseInput(path: string): boolean {
  const name = basename(path);
  return !EXCLUDED_NAMES.has(name) && !name.startsWith(".env") &&
    !name.endsWith(".log") && !name.endsWith(".tsbuildinfo");
}

/** An allowlist also removes inherited NODE_OPTIONS, provider keys, and DB URLs. */
export function releaseEnvironment(source: Record<string, string | undefined>): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TMPDIR", "TEMP", "TMP", "PLAYWRIGHT_BROWSERS_PATH"]) {
    if (source[key]) environment[key] = source[key];
  }
  return {
    ...environment,
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    JOYSEARCH_LIVE_ENABLED: "false",
    JOYSEARCH_RELEASE_CHECK: "1",
  };
}

export async function copyReleaseSource(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const name of SOURCE_INPUTS) {
    const input = join(source, name);
    try { await lstat(input); } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    await cp(input, join(destination, name), {
      recursive: true,
      filter: async (path) => {
        if (!includeReleaseInput(path)) return false;
        if ((await lstat(path)).isSymbolicLink()) {
          throw new Error("Release source contains a symbolic link. Use regular source files.");
        }
        return true;
      },
    });
  }
}

function run(directory: string, environment: Record<string, string | undefined>, label: string, args: string[]): Promise<void> {
  console.info(`\n[release-check] ${label}`);
  return new Promise((fulfill, reject) => {
    // Next globally requires NODE_ENV in ProcessEnv's type, but Node permits an
    // absent value. Let each CLI choose its own default instead of forcing one.
    const child = spawn(process.execPath, args, { cwd: directory, env: environment as NodeJS.ProcessEnv, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) fulfill();
      else reject(new Error(`${label} failed (${signal ?? code}).`));
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--keep")) throw new Error("Usage: pnpm check:release [--keep]");
  const source = resolve(import.meta.dirname, "..");
  const directory = await mkdtemp(join(tmpdir(), "joysearch-release-check-"));
  const environment = releaseEnvironment(process.env);
  try {
    await copyReleaseSource(source, directory);
    // Dependencies are installed once with the pinned lockfile; source and env
    // isolation does not install packages or copy any private runtime files.
    await symlink(join(source, "node_modules"), join(directory, "node_modules"), "dir");
    console.info(`[release-check] Isolated source: ${directory}`);
    console.info("[release-check] No environment files, provider credentials, or hosted accounting copied.");
    await run(directory, environment, "Lint", ["node_modules/eslint/bin/eslint.js", "."]);
    await run(directory, environment, "Route types", ["node_modules/next/dist/bin/next", "typegen"]);
    await run(directory, environment, "TypeScript", ["node_modules/typescript/bin/tsc", "--noEmit"]);
    const tests = (await readdir(join(directory, "tests"))).filter(name => name.endsWith(".test.ts")).sort();
    if (!tests.length) throw new Error("No offline tests found.");
    await run(directory, environment, "Offline tests", ["--test", ...tests.map(name => `tests/${name}`)]);
    await run(directory, environment, "Production build", ["node_modules/next/dist/bin/next", "build", "--webpack"]);
    await run(directory, environment, "Browser checks", ["node_modules/@playwright/test/cli.js", "test"]);
    console.info("\n[release-check] All release checks passed. No paid evaluation was run.");
  } finally {
    if (args.includes("--keep")) console.info(`[release-check] Kept isolated source for inspection: ${directory}`);
    else await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Release checks failed.");
    process.exitCode = 1;
  });
}
