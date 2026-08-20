# oas-jira

Official [OAS](https://github.com/OAS-Framework/oas) tasks-layer integration for Jira. It contributes the `jira-tasks` skill, task-layer instructions, and an advisory spawn hook that gives each instance an `agent-<instance>` label identity and reports the configured Jira site/project.

Jira owns durable task status and outcomes; the selected messaging integration owns conversation. The package never changes Jira assignees, authenticates on an agent's behalf, or makes network calls from lifecycle hooks.

## Requirements

Install Atlassian's `acli` and authenticate it as the human operator:

```bash
acli jira auth status
acli jira auth login --web   # human-run only, when status says unauthorized
```

Installation guide: <https://developer.atlassian.com/cloud/acli/guides/install-acli/>

This package targets OAS `>=0.20.0` and is verified against the released kernel; see [`SCHEMA-STATUS.md`](SCHEMA-STATUS.md).

## Acquire and activate

Acquisition does not activate the capability. After an official release exists:

```bash
oas install oas.jira --dir /path/to/scope          # acquire + lock; no activation
oas trust oas.jira --dir /path/to/scope            # approve the executable hook
oas use oas.jira --global --dir /path/to/scope     # activate (needs a config — see below)
oas doctor /path/to/scope --soul <soul-name>
```

A pinned Git source may be used after publication. Acquisition selects the
`oas-package/` root in this repository by default:

```bash
oas install https://github.com/OAS-Framework/oas-jira.git@v2.0.0 --dir /path/to/scope
```

Install acquires and locks; it never activates. The capability materializes flat
into `.agents/capabilities/installed/oas.jira/` — an independently hashable
artifact that carries only the capability's own files. Nothing package-only (this
README, the manifest, the config template) is installed.

The spawn hook is executable, so it needs explicit per-capability trust bound to
the exact materialized artifact integrity. Until it is granted, the instructions
and the `jira-tasks` skill still compose; only the hook is withheld.

`oas use` resolves capabilities through the config chain, so the scope needs an
`oas-config.yaml` before it can activate one — in a scope that has none it reports
`unknown capability "oas.jira" (acquired: none)` even though the artifact is
installed. Create the config first, either by adopting the shipped template (next
section, which acquires and binds the layer in one step) or with `oas init`.

Configure deployment-owned targeting and settings in `oas-config.yaml`, not in this package:

```yaml
capabilities:
  layers:
    tasks:
      capability: oas.jira
      from: installed
      global:
        enabled: true
        settings:
          site: example.atlassian.net
          project: PROJ
```

## Adopt the shipped config template

The package ships one config template — a complete reference `oas-config.yaml`
that binds the tasks layer to `oas.jira` for every agent. It is a recommended
starting point, not installed policy: `oas install` applies none of it.

```bash
oas init --package oas.jira --dir /path/to/scope   # a scope with no config yet
oas config adopt oas.jira --dir /path/to/scope     # switch an existing scope
```

Adoption copies the template verbatim as your own local config and records the
exact adopted base under `.agents/config-templates/adopted/oas.jira/default/`.
Commit that base: it is what `oas config diff` and `oas config sync` compare
against when a later package version changes the template, so your local edits
survive updates.

The template deliberately leaves the Jira `site` and `project` unset — a template
is portable and carries no account, site, credential, or provider-local ID. Fill
them in before spawning agents; until you do, `oas doctor` and the spawn hook
report the settings as incomplete rather than guessing.

Load the `jira-tasks` skill before reading or changing tickets. Its commands and identity/state rules are the package's supported protocol.

## Development

```bash
npm test     # manifest + template contract, containment, advisory-hook behavior
npm run probe   # the same package against a REAL released OAS kernel
```

`npm test` validates both manifests and the config template against the vendored
0.20 schemas, enforces per-capability self-containment, and smoke-tests the
advisory hook — all offline.

`npm run probe` is the consumer half of the gate. It installs the kernel named by
this package's own compatibility floor into an isolated prefix and drives it
through a throwaway sandbox: acquisition from a local path and from a Git source,
flat materialization, exact restore (lock byte-identical, trust preserved),
`acli` requirement reporting, the trust boundary, explicit template adoption,
ignore behavior, and task-layer composition at spawn. Pass `--cli <oas-bin>` to
probe a kernel you already have. It never uses the `oas` on `PATH`.
