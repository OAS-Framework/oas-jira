---
type: Decision
title: oas.jira ships 2.0.0 on a >=0.20.0 floor with v1.0.0 preserved
description: The capability-materialization contract is a breaking consumer change, so the package majors rather than raising 1.x, and the published v1.0.0 tag stays for 0.19 consumers.
tags: [oas-jira, release, versioning, oas-0.20]
timestamp: 2026-08-20
---

**Decision**: `oas.jira` 2.0.0, `compatibility.oas: ">=0.20.0"`, dedicated
capability root `capabilities/oas-jira`, canonical `configTemplates` with one
portable default template. `v1.0.0` remains published and untouched.

**Why**

- Raising the floor to `>=0.20.0` breaks every 0.19 consumer, which is a major by
  definition — 0.19 kernels cannot read a `configTemplates` manifest.
- The repo validator requires package version == exported capability version, so
  the capability majors with the package.
- 0.20 rejects a `"."` capability root as soon as the manifest carries
  `configTemplates`, and requires `capabilities` with `minItems: 1`. A dedicated
  root is what makes the materialized artifact independently hashable and
  trustable, so it is the authoring default regardless.
- `configs` is the deprecated 0.19 spelling and carrying both is invalid, so new
  authoring emits only `configTemplates`. The repo validator now REJECTS `configs`
  outright rather than merely warning — this repo never publishes a 0.19 manifest
  again.
- v1.0.0 is preserved because immutable published tags are the only thing 0.19
  adopters can still consume; retagging is forbidden by the 0.20 release notes.

**How to apply**: when the next floor raise lands, repeat this shape — major the
package and capability together, keep every prior tag, and never retag.
