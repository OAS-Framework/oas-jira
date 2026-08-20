---
type: Lesson
title: Capability artifact integrity covers provenance, not just capability bytes
description: The materialized artifact hash includes the generated .oas-installation.json, so identical source bytes acquired from a path vs a git source hash differently.
tags: [oas-0.20, integrity, trust, materialization]
timestamp: 2026-08-20
---

The `capabilities.<id>.integrity` in an `oas-lock.json` v2 is a sha256 tree hash
of every byte under `.agents/capabilities/installed/<id>/` — INCLUDING the
generated `.oas-installation.json` provenance file, which records `source`,
`commit`, `packagePath` and `capabilityPath`.

Observed directly: the same `oas-jira` capability bytes materialized from a
`path:` source hashed `sha256-21f003…`, and from a `git:file://…` source
`sha256-4f8fda…`. The capability's own files were byte-identical; only the
recorded provenance differed.

**Consequences that matter**

- Artifact integrity is NOT a content-addressed identity of the capability. Two
  scopes that installed the same release from different source spellings hold
  different integrity values, both correct.
- Executable trust binds to this hash, so trust is per-scope AND
  per-acquisition-route. Re-acquiring the same version by a different source
  spelling legitimately resets trust.
- Exact restore still preserves trust: within one scope the provenance is stable,
  so bare `oas install` reproduces the identical artifact and the lock's
  `trusted: true` survives. Verified in the consumer probe.

**How to apply**: never assert a hard-coded integrity value in a probe or test,
and never compare integrity across scopes or acquisition routes. Assert the
SHAPE (`^sha256-[0-9a-f]{64}$`) and the invariants (restore reproduces it, trust
resets when it changes).
