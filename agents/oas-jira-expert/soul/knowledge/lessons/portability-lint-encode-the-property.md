---
type: Lesson
title: Encode the property, not a list of known prefixes
description: A "machine path" lint that enumerated /Users/, /home/ and C:\ accepted /tmp, /opt, ~/…, C:/…, UNC and root-relative Windows paths while still claiming to reject machine paths.
tags: [validator, portability, review]
timestamp: 2026-08-20
---

The oas.jira config-template portability lint rejected absolute machine paths
with `/(?:\/Users\/|\/home\/|[A-Za-z]:\\)/`. That is an enumeration of three
spellings wearing the name of a property. It accepted `/tmp/...`, `/opt/...`,
`~/...`, `~alice/...`, `C:/...` (forward slash), `\\server\share` (UNC) and
`\Windows\...` (root-relative) — all machine paths, all waved through by a check
whose diagnostic said "an absolute machine path".

**Fix**: test the PROPERTY — absoluteness / host-anchoring — across every form:

- POSIX absolute `^/`
- home-relative `^~($|[/\\])` and another user's home `^~[^/\\]+([/\\]|$)`
- Windows drive, either separator `^[A-Za-z]:([/\\]|$)`
- UNC `^\\\\[^\\]`
- Windows root-relative `^\\(?!\\)`

with URLs explicitly exempted (`^[A-Za-z][A-Za-z0-9+.-]*://` is
location-independent) and relative paths left alone, since a template legitimately
references package-relative locations.

Run the check on VALUES, not whole lines: parse the YAML value after the first
`:`, strip quotes and flow-sequence brackets. Whole-line matching lets a key name
or a prose word trip the rule, and a quoted value hide from it.

**How to apply**: whenever a lint's message names a property ("an absolute path",
"a credential", "a secret"), check whether the implementation tests that property
or a sample of its instances. If it enumerates, the message is a promise the code
does not keep. Write the reject fixtures across every form of the property AND
the accept controls (relative paths, URLs, prose) — the controls are what stop
the fix from over-matching.

Two of the original five lint rules had the same shape and had already needed
fixing for exactly this reason (`\b` failing before `/` and inside `api_token`).
