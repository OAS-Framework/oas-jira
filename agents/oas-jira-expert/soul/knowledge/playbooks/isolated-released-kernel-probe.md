---
type: Playbook
title: Probing a package against a real released OAS kernel in isolation
description: How to drive a package through a released kernel without trusting the ambient CLI, the host's tools, or the developer's own OAS deployment.
tags: [oas-0.20, consumer-probe, testing, playbook]
timestamp: 2026-08-20
---

Offline schema validation cannot prove a package works; the kernel's behavior is
the contract. `scripts/consumer-probe.mjs` in oas-jira is the reference shape.

**Isolate four things, and ENFORCE each rather than assuming it**

1. **The kernel**. Install the exact version into a throwaway prefix
   (`npm install --prefix <tmp> @oas-framework/oas@<v>`) and invoke the binary by
   absolute path. Derive `<v>` from the package's own `compatibility.oas` so the
   probe follows the manifest. Assert the resolved binary is NOT the one on
   `PATH` — a developer laptop commonly has an older global CLI (0.19.4 here)
   that would pass a probe about behavior it does not implement.
2. **HOME**. Pass a sandbox `HOME`, or the probe reads the developer's real
   laptop-level OAS config and agent roster.
3. **PATH**, for requirement checks. Build a sanitized `PATH` (node bin +
   `/usr/bin:/bin`) and ASSERT the required host tool is genuinely unresolvable
   before concluding that a missing-requirement report is correct. On this host
   `acli` was actually installed, which would have silently voided the check.
   Verify the positive case with a stub binary — OAS reports presence and must
   never invoke the tool.
4. **The payload**. Copy `oas-package/` into the sandbox so nothing mutates the
   repository tree.
5. **Every host binary the kernel may resolve.** Do not inherit
   `process.env.PATH` at all — build the probe's PATH from provisioned stubs plus
   the base system dirs. `oas spawn` resolves a runtime binary even under
   `--no-launch`, and host-tool presence changes doctor/spawn output. See
   [A consumer probe must provision every host tool it depends on, not inherit them](/lessons/probe-must-own-its-host-tools.md).

**Parsing kernel output**: `--json` is not uniformly shaped. Some commands emit
one envelope line; `doctor` pretty-prints a multi-line object after human-readable
lines. Parse the whole document first, then retry from each column-0 `{` line. A
naive "last line starting with `{`" reader picks up an INNER object of a
pretty-printed envelope and fails confusingly.

**What to cover**: acquisition (local path AND git source), flat materialization
with no package-only leakage, install-never-activates, exact restore, host
requirements both ways, the trust boundary both ways, explicit template adoption
plus the recorded base, ignore behavior at a git scope, and layer composition at
spawn with settings both unset and set.

Keep the sandbox on failure and print its path; delete it on success.

Related: [Consumer probes must assert the layer is activated or they pass for the wrong reason](/lessons/probe-must-assert-layer-activation.md), [Capability artifact integrity covers provenance, not just capability bytes](/lessons/capability-integrity-is-provenance-bound.md).
