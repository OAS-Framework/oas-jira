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

The amended package schema and OAS `>=0.19.0` compatibility floor are frozen; see [`SCHEMA-STATUS.md`](SCHEMA-STATUS.md) for the remaining released-kernel fixture gate.

## Acquire and activate

Acquisition does not activate the capability. After an official release exists:

```bash
oas install oas.jira --dir /path/to/scope
oas trust oas.jira --dir /path/to/scope
oas use oas.jira --global --dir /path/to/scope
oas doctor /path/to/scope --soul <soul-name>
```

A pinned Git source may be used after publication:

```bash
oas install git:https://github.com/OAS-Framework/oas-jira.git@v1.0.0 --dir /path/to/scope
```

The spawn hook is executable, so it needs explicit per-capability trust tied to the exact package integrity.

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

Load the `jira-tasks` skill before reading or changing tickets. Its commands and identity/state rules are the package's supported protocol.

## Development

```bash
npm test
```

This validates both manifests, checks resource containment, and smoke-tests the advisory hook. The full acquire → lock → trust → activate → spawn probe remains pending released OAS 0.19.0 consumer fixtures.
