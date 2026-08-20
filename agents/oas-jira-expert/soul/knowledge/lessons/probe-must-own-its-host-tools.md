---
type: Lesson
title: A consumer probe must provision every host tool it depends on, not inherit them
description: Two probe checks passed only because the developer laptop had pi and acli installed; CI without them failed three checks and would have silently altered a fourth.
tags: [oas-0.20, consumer-probe, ci, false-green, isolation]
timestamp: 2026-08-20
---

The oas.jira consumer probe passed 14/14 locally and failed in GitHub Actions.
Two distinct host dependencies had been inherited rather than owned:

1. **The runtime binary.** `oas spawn` resolves `pi` (or `claude`) and persists
   the launch command into `instance.json` BEFORE it checks `--no-launch`, so
   even a scaffold-only spawn dies with `pi binary not found on PATH`. Three
   spawn checks failed in CI. A stub is sufficient — `--no-launch` never executes
   the command, only resolves it — and is safer than installing a real runtime,
   provided the stub exits non-zero so an accidental real launch is loud.
2. **`acli`.** The "spawn is clean once settings are supplied" check asserted
   zero warnings. On a laptop with acli installed that held; without it the
   kernel adds a requirement warning and the assertion breaks. This one is worse
   than a CI failure: it means the check's meaning depended on whose machine ran
   it.

**Fix**: provision BOTH as stubs inside the sandbox, and stop inheriting
`process.env.PATH` entirely — the probe's default PATH is now
`[acliBin, runtimeBin, nodeBin, /usr/bin, /bin]`. The missing-requirement check
uses a sanitized PATH that deliberately EXCLUDES the acli stub, so both
directions are controlled rather than accidental. Verified 14/14 both with and
without pi/acli on the ambient PATH.

**Then the stubs themselves needed enforcing.** The first fix had each stub write
to stderr and exit nonzero, described as "shouts if executed". That guarantee was
itself unenforced: the probe captured stderr but never inspected it, and a kernel
that ran a stub and ignored its failure still returned a parseable success
envelope. Review demonstrated it — a wrapper that invoked both stubs and swallowed
their exit codes still passed 14/14.

The enforcement is a SENTINEL FILE: each stub appends its own invocation to a
known path, and the probe checks those paths after EVERY kernel call, so an
invocation fails at the call that caused it regardless of what the kernel
reports. Verified by reproducing the reviewer's wrapper: the probe now fails
immediately, naming the responsible command and the recorded invocation.

**And the enforcement itself was dead in some environments.** The sentinel path
was interpolated into the generated shell stub with `JSON.stringify` — a
JavaScript string literal, not a shell one. Inside the double quotes it produces,
`$`, backticks and `$(...)` stay live. `sandbox` derives from `TMPDIR`, so a
TMPDIR containing shell metacharacters sent the sentinel to an expanded path,
leaving the real one absent and the enforcement silently dead while everything
still reported green; a `$(...)` in the path would have EXECUTED. Fixed with POSIX
single-quoting (embedded quote closed, escaped, reopened).

Two structural lessons from that one bug:

- Quoting for a generated script is a SHELL concern. `JSON.stringify` is the
  wrong tool and looks right, which is why it survived review twice.
- A guard whose own correctness depends on the environment must PROVE itself at
  runtime. The probe now runs a check-zero that executes each provisioned stub
  directly, asserts the sentinel appeared at its real path with the right
  arguments, and baselines that deliberate invocation out. The enforcement can no
  longer be silently dead in any environment, because being dead now fails the
  probe as its first check.

**How to apply**: a probe that claims isolation must enumerate every external
binary the kernel may resolve and provide it, in both the present and absent
directions. "It passes on my machine" is not evidence of isolation — run it once
with a deliberately minimal PATH before believing it. And a stub that "must never
run" needs a positive record of non-execution, not a loud failure mode nobody
reads: if nothing asserts on it, it is decoration.

This was the third AND fourth variant of one theme in a single delivery (see
[Consumer probes must assert the layer is activated or they pass for the wrong reason](/lessons/probe-must-assert-layer-activation.md)): an isolation or absence claim that was
asserted rather than enforced. Every one was caught by review, none by me. The
generalisable rule: for any claim of the form "X never happens", ask what would
FAIL if X happened — if the answer is "nothing observes it", the claim is
decorative.
