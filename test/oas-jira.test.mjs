import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../oas-package", import.meta.url)));
const HOOK = join(ROOT, "capabilities", "oas-jira", "bin", "oas-jira.mjs");

function run(args = [], env = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [HOOK, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

test("spawn reports Jira identity and complete deployment settings", async () => {
  const result = await run(["spawn"], {
    OAS_EVENT: "spawn",
    OAS_INSTANCE: "developer-api-1",
    OAS_SETTINGS: JSON.stringify({ site: "example.atlassian.net", project: "PROJ" }),
  });
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.meta, {
    label: "agent-developer-api-1",
    site: "example.atlassian.net",
    project: "PROJ",
  });
  assert.match(payload.brief, /project PROJ on example\.atlassian\.net/);
  assert.match(payload.brief, /agent-developer-api-1/);
  assert.equal(payload.warning, undefined);
});

test("spawn warns when deployment settings are incomplete", async () => {
  const result = await run(["spawn"], {
    OAS_EVENT: "spawn",
    OAS_INSTANCE: "developer-api-1",
    OAS_SETTINGS: JSON.stringify({ project: "PROJ" }),
  });
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.meta, { label: "agent-developer-api-1", project: "PROJ" });
  assert.match(payload.brief, /site unset/);
  assert.match(payload.warning, /site: unset, project: PROJ/);
});

test("unknown lifecycle events degrade to a hook warning", async () => {
  const result = await run(["retire"], { OAS_EVENT: "retire", OAS_SETTINGS: "{}" });
  assert.equal(result.code, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).warning, /unknown event "retire"/);
});
