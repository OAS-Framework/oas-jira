---
type: Lesson
title: oas use cannot bootstrap a scope that has no oas-config.yaml
description: Capability discovery walks the config chain, so `oas install` + `oas use` alone fails in a config-less scope even though the artifact is installed.
tags: [oas-0.20, activation, config, consumer-probe]
timestamp: 2026-08-20
---

In released OAS 0.20.0, `oas use <capability>` fails in a scope with no
`oas-config.yaml` anywhere in its chain:

```
oas: unknown capability "oas.jira" (acquired: none) — acquire it with `oas install oas.jira`
```

This happens even when the capability IS installed and locked at that scope, and
even when `oas list` shows it correctly.

**Why**: `capabilityManifests(startDir)` in `lib/core.mjs` iterates
`configChain(startDir)` and scans each level's `.agents/capabilities/installed/`
store. With no config file anywhere in the chain the iteration is empty, so the
installed store is never scanned. `bin/oas.mjs` looks the manifest up *before*
writing the config file it is otherwise prepared to create — a genuine
chicken-and-egg in the CLI, not a packaging error.

**How to apply**: the working adopter sequence is to create the config FIRST —
`oas init --package <pkg>` (acquires, adopts the template, and binds the layer in
one step) or plain `oas init` — and only then `oas use`. In consumer probes,
never activate with a bare `oas use` in a fresh scope; it will look like a
package defect. Documented for adopters in the package README.

Related: [Consumer probes must assert the layer is activated or they pass for the wrong reason](/lessons/probe-must-assert-layer-activation.md).
