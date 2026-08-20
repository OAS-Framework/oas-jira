# Schema status

- **Vendored schemas verified against the RELEASED kernel**: `schemas/oas-package.schema.json`,
  `schemas/oas-lock.schema.json` and `schemas/capability-manifest.schema.json` are
  byte-identical to the `docs/` copies shipped in `@oas-framework/oas@0.20.0`.
  `npm run validate` checks both manifests and the config template against them.
- **Released-kernel consumer probe: CLOSED.** `TODO(engine-consumer-fixtures)` is
  resolved. `npm run probe` exercises this package against a real released
  0.20.0 kernel in a throwaway sandbox — acquisition (local path and Git source),
  flat materialization, exact restore, host-requirement reporting, executable
  trust, explicit template adoption, ignore behavior, and task-layer composition
  at spawn. 14/14 checks pass; CI runs it on every push and pull request.

The package targets OAS `>=0.20.0`. The 0.19 floor and the `configs` template
spelling are no longer emitted; `v1.0.0` remains published and untouched for
0.19 consumers.
