---
type: Lesson
title: The kernel treats capability agents[] and skills[] asymmetrically
description: assertCapabilitySelfContained requires every agents[] entry to be a directory but walks a skills[] entry only when it happens to be one.
tags: [oas-0.20, containment, validator-parity]
timestamp: 2026-08-20
---

In released 0.20 `lib/core.mjs`, `assertCapabilitySelfContained` handles the two
tree-shaped declarations differently:

```js
for (const declared of manifest.skills || []) {
  const { path, real } = resolveDeclared(declared, "skill tree");
  if (statSync(real).isDirectory()) walkContained(path, "skill tree", declared);
}
for (const declared of manifest.agents || []) {
  const { path, real } = resolveDeclared(declared, "capability-defined agent");
  if (!statSync(real).isDirectory()) throw oasError("capability-not-self-contained",
    `capability ${id} capability-defined agent "${declared}" is not a directory`);
  walkContained(path, "capability-defined agent", declared);
}
```

A `skills` entry that is a plain file is ACCEPTED (contained, just not walked).
An `agents` entry that is a plain file is REJECTED outright.

Confirmed against the released CLI: `agents: ["agents/solo.md"]` fails
`oas install` with `capability-not-self-contained` and exactly that message.

**How to apply**: a repo-side validator that ports this check must not collapse
the two into one "walk if it is a directory" branch — that silently accepts a
package the kernel will refuse at install time, which is the worst place to find
out. The oas.jira validator now carries a `mustBeDirectory` flag for agents and
regression tests for both halves of the asymmetry.

This was caught by post-commit review, not by the probe: the probe only exercises
the payload as it actually is, and oas.jira declares no `agents`. Contract ports
need their own negative tests independent of what the shipping payload happens to
use.

Related: [Consumer probes must assert the layer is activated or they pass for the wrong reason](/lessons/probe-must-assert-layer-activation.md).
