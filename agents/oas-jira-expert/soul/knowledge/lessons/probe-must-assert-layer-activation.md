---
type: Lesson
title: Consumer probes must assert the layer is activated or they pass for the wrong reason
description: doctor's layers.<slot> is empty unless config binds the layer, so requirement and hook assertions silently succeed against an unbound layer.
tags: [oas-0.20, testing, false-green, consumer-probe]
timestamp: 2026-08-20
---

`oas doctor --json` reports `layers.tasks.missingRequires`, `layers.tasks.hooks`
and `layers.tasks.integration` only for an ACTIVE (config-bound) layer. In a scope
where the capability is installed but not activated, `layers.tasks` is just
`{ "provenance": null }`.

This bit twice while writing the oas.jira consumer probe:

- "a present `acli` clears the requirement" PASSED against a scope with no config
  at all — `missingRequires` was `[]` because there was no tasks layer, not
  because the requirement was met.
- The trust check read `hooks: []` and would have "proved" the untrusted state in
  a scope where hooks could never appear anyway.

**How to apply**: every probe assertion that reads a layer must first assert
`envelope.layers.<slot>.integration === <capability>`. The oas.jira probe has a
shared `assertTasksLayerActive()` guard for exactly this, and it is what surfaced
the [oas use cannot bootstrap a scope that has no oas-config.yaml](/lessons/oas-use-needs-a-config-chain.md) bootstrapping issue instead of hiding it.

More generally: for any "absence proves correctness" assertion, first assert the
precondition that makes the absence meaningful.

**It recurred.** Post-commit review caught the same class again in the
untrusted-hook check: it proved the hook had not run by the absence of the hook's
"settings incomplete" warning — while supplying COMPLETE settings, for which the
hook is silent anyway. The fix was to leave settings unset, so a hook that did run
would necessarily speak. Verified both directions against the released kernel:
untrusted+unset emits only "executable surface disabled"; trusted+unset emits
"settings incomplete".

Two lessons: absence-assertions need an explicit precondition check, and a probe
author is not a reliable reviewer of their own absence-assertions — this pattern
slipped past me twice in one session.
