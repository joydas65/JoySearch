import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyReleaseSource, releaseEnvironment } from "../scripts/release-check.ts";

test("release child environment drops keys, database URLs, Vercel flags, and Node preload options", () => {
  const environment = releaseEnvironment({
    PATH: "/safe/bin", HOME: "/safe/home", CI: "false", EXA_API_KEY: "sentinel",
    BRAVE_SEARCH_API_KEY: "sentinel", AI_GATEWAY_API_KEY: "sentinel",
    BUDGET_DATABASE_URL: "sentinel", DATABASE_URL: "sentinel",
    VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production", NODE_OPTIONS: "--require unsafe.js",
    ANSWER_CONTEXT_SECRET: "sentinel", JOYSEARCH_LIVE_ENABLED: "true",
    GITHUB_TOKEN: "sentinel", npm_config_token: "sentinel",
  });
  assert.deepEqual(environment, {
    PATH: "/safe/bin", HOME: "/safe/home", CI: "true", NEXT_TELEMETRY_DISABLED: "1",
    JOYSEARCH_LIVE_ENABLED: "false", JOYSEARCH_RELEASE_CHECK: "1",
  });
});

test("release copy includes new source but excludes nested environment files and private/generated directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "joysearch-source-isolation-"));
  const source = join(root, "source");
  const destination = join(root, "copy");
  try {
    await mkdir(join(source, "app"), { recursive: true });
    await writeFile(join(source, "app", "page.tsx"), "owned source");
    await writeFile(join(source, "package.json"), "{}");
    await writeFile(join(source, ".env.local"), "secret sentinel");
    await writeFile(join(source, "app", ".env.production.local"), "secret sentinel");
    for (const name of [".evaluation", ".vercel", ".git", "node_modules", ".next", "test-results"]) {
      await mkdir(join(source, "app", name));
      await writeFile(join(source, "app", name, "private.txt"), "secret sentinel");
    }
    await mkdir(join(source, "unrelated"));
    await writeFile(join(source, "unrelated", "private.txt"), "secret sentinel");
    await copyReleaseSource(source, destination);
    assert.deepEqual((await readdir(destination)).sort(), ["app", "package.json"]);
    assert.deepEqual(await readdir(join(destination, "app")), ["page.tsx"]);
    assert.equal(await readFile(join(destination, "app", "page.tsx"), "utf8"), "owned source");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release copy refuses a symlink that could point to private files", async () => {
  const root = await mkdtemp(join(tmpdir(), "joysearch-source-symlink-"));
  const source = join(root, "source");
  try {
    await mkdir(join(source, "app"), { recursive: true });
    await writeFile(join(root, "private.txt"), "secret sentinel");
    await symlink(join(root, "private.txt"), join(source, "app", "linked.ts"));
    await assert.rejects(copyReleaseSource(source, join(root, "copy")), /symbolic link/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
