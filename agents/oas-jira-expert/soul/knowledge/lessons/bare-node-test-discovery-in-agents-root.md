---
type: Lesson
title: Bare `node --test` in an OAS repo executes nested agent-instance worktrees
description: A repo that is also an agents root has live instance worktrees under agents/<soul>/instances/<id>/work, and default test discovery recurses into their copies of test/.
tags: [oas, testing, ci, false-green]
timestamp: 2026-08-20
---

`node --test` with no path operands recurses from the working directory. An OAS
package repo is usually also an agents root, so live instance worktrees sit at
`agents/<soul>/instances/<id>/work` — each a full checkout carrying its own
`test/`. Default discovery runs those too.

Verified in oas-jira: planting one test file at
`agents/oas-jira-expert/instances/<id>/work/test/sentinel.test.mjs` took
`npm test` from 22 tests to 23 and executed the planted file.

Two distinct problems, and the second is the serious one:

- The reported pass count depends on which worktrees happen to exist, so the
  number in a release packet is not reproducible.
- The gate EXECUTES code from directories it is not reviewing. An instance
  worktree may hold another agent's in-flight, unreviewed work.

**Fix**: name test files explicitly in the `test` script. The cost is silent
omission — a new test file nobody adds simply never runs — so pair it with a
guard asserting every `test/*.test.mjs` on disk is named by the script, and one
asserting `node --test` is never invoked with zero path operands.

**Gotcha when testing this**: a regression test must not run the project's own
test command (it would recurse into itself). Prove the property in a throwaway
fixture repo instead.

**And the gotcha that is worse than it first looks**: Node sets
`NODE_TEST_CONTEXT=child-v8` in test-file processes, and children inherit it. A
spawned `node --test` that inherits it refuses to recurse, prints only
`Warning: node:test run() is being called recursively within a test file.
skipping running files.` — and EXITS 0. Measured on Node 22 with the same failing
suite:

| child env | exit | stdout |
|---|---|---|
| clean | 1 | 831 bytes, real failure report |
| `NODE_TEST_CONTEXT=child-v8` | 0 | 182 bytes (warning only) |

A passing suite under the inherited variable is byte-identical to the failing
one. So it is not merely "the fixture proves nothing" — any harness that spawns
`node --test` reports GREEN OVER RED. Always construct the child env without
`NODE_TEST_CONTEXT` (and `NODE_OPTIONS`), and assert the property you depend on:
a deliberately failing nested suite must exit nonzero and print a real report.
Mutation-test that assertion by re-adding the variable; if the test still passes,
it is not protecting anything.

Related: [Consumer probes must assert the layer is activated or they pass for the wrong reason](/lessons/probe-must-assert-layer-activation.md).
