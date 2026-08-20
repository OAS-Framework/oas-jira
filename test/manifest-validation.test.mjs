// Negative + positive coverage for scripts/validate-manifests.mjs against the
// OAS 0.20 package contract. Each fixture is a throwaway repo laid out like this
// one (tooling outside, payload under oas-package/) so the validator is exercised
// exactly as CI runs it.
import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const PORTABLE_TEMPLATE = `name: my-deployment
capabilities:
  layers:
    tasks:
      capability: test.capability-1
      from: installed
      global:
        enabled: true
`;

/** Build a fixture repo and run the validator in it.
 *  @param overrides  merged into the package manifest; `undefined` deletes a key.
 *  @param options.templates  { "<package-relative path>": "<contents>" }
 *  @param options.capabilityFiles  extra files written under the first capability root
 *  @param options.after  hook receiving the fixture dir for symlink/edge-case setup
 */
function runFixture(t, capabilityDirs, overrides = {}, options = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "oas-manifest-fixture-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(join(fixture, "scripts"), { recursive: true });
  mkdirSync(join(fixture, "schemas"), { recursive: true });
  mkdirSync(join(fixture, "oas-package"), { recursive: true });
  copyFileSync(join(ROOT, "scripts", "validate-manifests.mjs"), join(fixture, "scripts", "validate-manifests.mjs"));
  for (const schema of ["oas-package.schema.json", "capability-manifest.schema.json"]) {
    copyFileSync(join(ROOT, "schemas", schema), join(fixture, "schemas", schema));
  }

  const manifest = {
    package: "test.capability-1",
    version: "1.0.0",
    description: "Manifest-validation fixture.",
    compatibility: { oas: ">=0.20.0" },
    ...(capabilityDirs === undefined ? {} : { capabilities: capabilityDirs }),
    ...overrides,
  };
  for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete manifest[key];
  writeFileSync(join(fixture, "oas-package", "oas-package.json"), JSON.stringify(manifest, null, 2) + "\n");

  for (const [path, contents] of Object.entries(options.templates || {})) {
    const file = join(fixture, "oas-package", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }

  for (const [index, capabilityDir] of (capabilityDirs || []).entries()) {
    if (capabilityDir === "." || capabilityDir.includes("..")) continue;
    const capabilityRoot = join(fixture, "oas-package", capabilityDir);
    mkdirSync(capabilityRoot, { recursive: true });
    writeFileSync(join(capabilityRoot, "oas.json"), JSON.stringify({
      capability: `test.capability-${index + 1}`,
      version: "1.0.0",
      compatibility: { oas: ">=0.20.0" },
      description: "Manifest-validation fixture capability.",
      requires: [],
      ...(options.capabilityManifest || {}),
    }, null, 2) + "\n");
    for (const [path, contents] of Object.entries(options.capabilityFiles || {})) {
      const file = join(capabilityRoot, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, contents);
    }
  }

  options.after?.(fixture);

  const result = spawnSync(process.execPath, [join(fixture, "scripts", "validate-manifests.mjs")], { cwd: fixture, encoding: "utf8" });
  return { ...result, fixture };
}

// --------------------------------------------------------------- capabilities
test("the real payload satisfies the 0.20 contract", () => {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts", "validate-manifests.mjs")], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /against the OAS 0\.20 package contract/);
});

test("validator rejects a missing capability enumeration", (t) => {
  const result = runFixture(t, undefined);
  assert.equal(result.status, 1);
  // 0.20 made `capabilities` REQUIRED: a config-only package cannot exist.
  assert.match(result.stderr, /missing required property capabilities/);
});

test("validator rejects an empty capability enumeration", (t) => {
  const result = runFixture(t, []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must contain at least 1 item/);
});

test("validator rejects extra capability enumerations", (t) => {
  const result = runFixture(t, ["capabilities/one", "capabilities/two"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must enumerate exactly one capability directory \(found 2\)/);
});

test("validator rejects a non-dedicated '.' capability root", (t) => {
  const result = runFixture(t, ["."], {
    configTemplates: { default: { path: "config-templates/default/oas-config.yaml", default: true } },
  }, { templates: { "config-templates/default/oas-config.yaml": PORTABLE_TEMPLATE } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"\." capability root is rejected by 0\.20 whenever the manifest carries `configTemplates`/);
});

// ----------------------------------------------------------------- templates
test("validator rejects carrying both configTemplates and the legacy configs spelling", (t) => {
  const result = runFixture(t, ["capabilities/one"], {
    configTemplates: { default: { path: "config-templates/default/oas-config.yaml", default: true } },
    configs: { legacy: { path: "config-templates/default/oas-config.yaml" } },
  }, { templates: { "config-templates/default/oas-config.yaml": PORTABLE_TEMPLATE } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /carries both `configTemplates` and the deprecated `configs` spelling/);
});

test("validator rejects the deprecated configs spelling for new authoring", (t) => {
  const result = runFixture(t, ["capabilities/one"], {
    configs: { default: { path: "config-templates/default/oas-config.yaml", default: true } },
  }, { templates: { "config-templates/default/oas-config.yaml": PORTABLE_TEMPLATE } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deprecated 0\.19 spelling/);
});

test("validator rejects a config template outside the canonical config-templates/ root", (t) => {
  const result = runFixture(t, ["capabilities/one"], {
    configTemplates: { default: { path: "profiles/default/oas-config.yaml", default: true } },
  }, { templates: { "profiles/default/oas-config.yaml": PORTABLE_TEMPLATE } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must live under "config-templates\/"/);
});

test("validator rejects more than one default config template", (t) => {
  const result = runFixture(t, ["capabilities/one"], {
    configTemplates: {
      default: { path: "config-templates/default/oas-config.yaml", default: true },
      other: { path: "config-templates/other/oas-config.yaml", default: true },
    },
  }, {
    templates: {
      "config-templates/default/oas-config.yaml": PORTABLE_TEMPLATE,
      "config-templates/other/oas-config.yaml": PORTABLE_TEMPLATE,
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /at most one config template may be marked default/);
});

test("validator rejects a config template that is not portable", (t) => {
  const notPortable = PORTABLE_TEMPLATE + `        settings:
          site: acme.atlassian.net
          project: ACME
          api_token: hunter2
`;
  const result = runFixture(t, ["capabilities/one"], {
    configTemplates: { default: { path: "config-templates/default/oas-config.yaml", default: true } },
  }, { templates: { "config-templates/default/oas-config.yaml": notPortable } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /carries a concrete Jira site/);
  assert.match(result.stderr, /carries a concrete Jira project key/);
  assert.match(result.stderr, /carries a credential-shaped setting/);
});

test("validator accepts placeholder guidance in template COMMENTS", (t) => {
  const commented = PORTABLE_TEMPLATE + `        # settings:
        #   site: your-site.atlassian.net
        #   project: YOURPROJECTKEY
`;
  const result = runFixture(t, ["capabilities/one"], {
    configTemplates: { default: { path: "config-templates/default/oas-config.yaml", default: true } },
  }, { templates: { "config-templates/default/oas-config.yaml": commented } });
  assert.equal(result.status, 0, result.stderr);
});

// ----------------------------------------------------------- self-containment
test("validator rejects a capability resource that escapes its own root", (t) => {
  const result = runFixture(t, ["capabilities/one"], {
    configTemplates: { default: { path: "config-templates/default/oas-config.yaml", default: true } },
  }, {
    templates: { "config-templates/default/oas-config.yaml": PORTABLE_TEMPLATE },
    capabilityManifest: { inject: "injects/shared.md" },
    after: (fixture) => {
      // The target is inside the PACKAGE but outside the CAPABILITY root, so a
      // package-level containment check would wave it through. Materialization
      // would then produce an artifact missing a file it declares.
      writeFileSync(join(fixture, "oas-package", "shared.md"), "# package-only\n");
      mkdirSync(join(fixture, "oas-package", "capabilities", "one", "injects"), { recursive: true });
      symlinkSync(join(fixture, "oas-package", "shared.md"), join(fixture, "oas-package", "capabilities", "one", "injects", "shared.md"));
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /resolves outside .* after symlink resolution/);
});

test("validator rejects a declared capability directory containing an escaping descendant", (t) => {
  const result = runFixture(t, ["capabilities/one"], {
    configTemplates: { default: { path: "config-templates/default/oas-config.yaml", default: true } },
  }, {
    templates: { "config-templates/default/oas-config.yaml": PORTABLE_TEMPLATE },
    capabilityManifest: { skills: ["skills"] },
    capabilityFiles: { "skills/demo/SKILL.md": "# demo\n" },
    after: (fixture) => {
      // The declared `skills` dir is itself contained; only a descendant escapes.
      writeFileSync(join(fixture, "oas-package", "outside.md"), "# package-only\n");
      symlinkSync(join(fixture, "oas-package", "outside.md"), join(fixture, "oas-package", "capabilities", "one", "skills", "leak.md"));
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /contains a path escaping its capability root/);
});

test("validator rejects deployment targeting in a capability manifest", (t) => {
  const result = runFixture(t, ["capabilities/one"], {
    configTemplates: { default: { path: "config-templates/default/oas-config.yaml", default: true } },
  }, {
    templates: { "config-templates/default/oas-config.yaml": PORTABLE_TEMPLATE },
    capabilityManifest: { global: { enabled: true } },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deployment targeting belongs to config/);
});

// ------------------------------------------------------ package ↔ capability
test("validator rejects a package/capability version mismatch", (t) => {
  const result = runFixture(t, ["capabilities/one"], {
    version: "2.0.0",
    configTemplates: { default: { path: "config-templates/default/oas-config.yaml", default: true } },
  }, { templates: { "config-templates/default/oas-config.yaml": PORTABLE_TEMPLATE } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must equal the exported capability version/);
});

test("validator rejects a compatibility floor mismatch", (t) => {
  const result = runFixture(t, ["capabilities/one"], {
    compatibility: { oas: ">=0.19.0" },
    configTemplates: { default: { path: "config-templates/default/oas-config.yaml", default: true } },
  }, { templates: { "config-templates/default/oas-config.yaml": PORTABLE_TEMPLATE } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must match the exported capability compatibility floor/);
});
