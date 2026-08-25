---
type: Lesson
title: Executable trust withholds hooks only — instructions and skills still compose
description: An untrusted capability contributes its injection and skills normally; only commands/hooks are suppressed, and spawn says so explicitly.
tags: [oas-0.20, trust, spawn, tasks-layer]
timestamp: 2026-08-20
---

The 0.20 trust boundary is surface-selective, verified against the released CLI:

- **Untrusted**: `oas doctor` reports `layers.tasks.hooks: []` and
  `trust.trusted: false` with reason `executable commands/hooks need
  \`oas trust <id>\``. `oas spawn` still composes the capability's injection into
  the instance `AGENTS.md` and wires its skills into `.agents/skills/`, and emits
  the warning `oas.jira: executable surface disabled — executable commands/hooks
  need \`oas trust oas.jira\``. The hook itself does NOT run (its own warnings are
  absent).
- **Trusted**: `layers.tasks.hooks: ["spawn"]`, the hook runs, and its output
  (identity label, settings report) reaches the spawn envelope.

**How to apply**: a tasks-layer package must keep everything an agent needs to
*understand* the layer in the non-executable surface (injection + skill), because
that is what an adopter gets before granting trust. Reserve the hook for advisory
enrichment only — never make correct behavior depend on it. This is why the
oas.jira spawn hook is advisory: it reports identity and settings and makes no
network call.

A probe distinguishing these two states must assert the hook's own output is
ABSENT while untrusted; asserting only the warning text would pass even if the
hook had run.
