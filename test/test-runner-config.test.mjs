// Guards the TEST RUNNER ITSELF.
//
// `node --test` with no path arguments recurses from the working directory. This
// repository is also an OAS agents root, so a live instance worktree at
// agents/<soul>/instances/<id>/work carries its own copy of test/ — bare
// discovery executes those too. That makes the reported pass count depend on
// which worktrees happen to exist, and runs code from a directory the repo's own
// gate is not reviewing. Verified before the fix: planting one nested test file
// took `npm test` from 22 tests to 23 and executed the planted file.
//
// These tests never invoke the project's own test command (that would recurse
// into this file). They assert the command's SHAPE from package.json, and prove
// the behavioural difference in a throwaway fixture repo instead.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const testScript = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.test;

test("the test script never runs `node --test` with bare discovery", () => {
  const match = testScript.match(/node\s+--test\b(?<rest>.*)$/);
  assert.ok(match, `test script does not invoke node --test: ${testScript}`);
  const operands = match.groups.rest.trim().split(/\s+/).filter((token) => token && !token.startsWith("-"));
  assert.ok(operands.length > 0,
    `\`node --test\` is invoked with no path operands, so it recurses from the working directory and will execute nested agent-instance worktrees: ${testScript}`);
});

test("every test file in test/ is named explicitly by the test script", () => {
  // The cost of an explicit list is silent omission: a new test file that nobody
  // adds to the script simply never runs, and the suite still reports green.
  const onDisk = readdirSync(join(ROOT, "test")).filter((name) => name.endsWith(".test.mjs")).sort();
  const missing = onDisk.filter((name) => !testScript.includes(`test/${name}`));
  assert.deepEqual(missing, [],
    `these test files exist but are not run by the test script: ${missing.join(", ")}`);
});

test("every path named by the test script exists", () => {
  const named = [...testScript.matchAll(/test\/[\w.-]+\.test\.mjs/g)].map((m) => m[0]);
  assert.ok(named.length > 0, "the test script names no test files");
  for (const rel of named) assert.ok(existsSync(join(ROOT, rel)), `test script names a missing file: ${rel}`);
});

test("bare discovery reaches a nested agent worktree and explicit paths do not", (t) => {
  // Proven in a fixture rather than this repo: the point is the difference
  // between the two invocations, and running the real suite here would recurse.
  const fixture = mkdtempSync(join(tmpdir(), "oas-discovery-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const sentinel = join(fixture, "nested-was-executed");

  mkdirSync(join(fixture, "test"), { recursive: true });
  writeFileSync(join(fixture, "test", "intended.test.mjs"),
    'import test from "node:test";\ntest("intended", () => {});\n');

  const nested = join(fixture, "agents", "some-soul", "instances", "some-instance", "work", "test");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "nested.test.mjs"),
    `import test from "node:test";\nimport { writeFileSync } from "node:fs";\n` +
    `test("nested", () => { writeFileSync(${JSON.stringify(sentinel)}, "executed"); });\n`);

  // Node sets NODE_TEST_CONTEXT in test child processes; inheriting it makes the
  // spawned runner behave as a nested reporter and emit nothing, which would
  // make this fixture silently prove nothing.
  const cleanEnv = { ...process.env };
  delete cleanEnv.NODE_TEST_CONTEXT;
  delete cleanEnv.NODE_OPTIONS;
  const run = (args) => spawnSync(process.execPath, args, { cwd: fixture, encoding: "utf8", env: cleanEnv });

  const bare = run(["--test"]);
  assert.ok(existsSync(sentinel),
    `fixture is not reproducing the hazard — bare discovery did not reach the nested worktree:\n${bare.stdout}`);

  rmSync(sentinel, { force: true });
  const explicit = run(["--test", "test/intended.test.mjs"]);
  assert.equal(explicit.status, 0, explicit.stdout + explicit.stderr);
  assert.ok(!existsSync(sentinel),
    "explicit test paths still executed the nested agent worktree's test file");
});

test("the spawned runner reports truthfully: failing suite exits nonzero, passing exits zero", (t) => {
  // Node sets NODE_TEST_CONTEXT=child-v8 in test-file processes and children
  // inherit it. A spawned `node --test` that inherits it refuses to recurse and
  // exits 0 with no report — reproduced on this Node: the SAME failing suite
  // exits 1 with an 831-byte report on a clean env, and exits 0 with 182 bytes
  // (just a recursion warning) with the variable inherited. Passing and failing
  // become indistinguishable, so a harness that spawns the runner would report
  // green over red.
  //
  // The strip in run() is therefore load-bearing, not hygiene. This asserts the
  // property the fixture above depends on: that its spawned runner's exit codes
  // mean something.
  const fixture = mkdtempSync(join(tmpdir(), "oas-runner-truth-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(join(fixture, "test"), { recursive: true });
  writeFileSync(join(fixture, "test", "pass.test.mjs"),
    'import test from "node:test";\ntest("passes", () => {});\n');
  writeFileSync(join(fixture, "test", "fail.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("fails", () => { assert.equal(1, 2); });\n');

  const cleanEnv = { ...process.env };
  delete cleanEnv.NODE_TEST_CONTEXT;
  delete cleanEnv.NODE_OPTIONS;
  const run = (file) => spawnSync(process.execPath, ["--test", file], { cwd: fixture, encoding: "utf8", env: cleanEnv });

  const failing = run("test/fail.test.mjs");
  assert.notEqual(failing.status, 0,
    `a failing nested suite exited 0 — the spawned runner is not reporting real results:\n${failing.stdout}${failing.stderr}`);
  assert.match(failing.stdout, /fail 1/, "a failing nested suite produced no readable failure report");

  const passing = run("test/pass.test.mjs");
  assert.equal(passing.status, 0, `a passing nested suite exited ${passing.status}:\n${passing.stdout}${passing.stderr}`);
  assert.match(passing.stdout, /pass 1/, "a passing nested suite produced no readable report");
});
