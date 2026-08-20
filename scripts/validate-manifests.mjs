#!/usr/bin/env node
// Repository-side gate for the DISTRIBUTED payload under `oas-package/`.
//
// It mirrors the checks the released OAS 0.20 kernel performs when it acquires
// this package (`loadPackageManifestAt` + `assertCapabilitySelfContained` in
// lib/core.mjs), so a contract break is caught here rather than in an adopter's
// scope. `scripts/consumer-probe.mjs` proves the same contract against the real
// released CLI; this script is the fast, offline half of the gate.
//
// Containment boundary: repo tooling (`schemas/`, `scripts/`, `test/`) is NOT
// distributed bytes and must never be reachable from a declared package path.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repoRoot, "oas-package");
const errors = [];
const report = (path, message) => errors.push(`${path}: ${message}`);
const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { report(relative(root, path), `invalid JSON (${error.message})`); return undefined; }
};

function validateSchema(value, schema, at) {
  if (!schema || typeof schema !== "object") return;
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) report(at, `must be one of ${schema.enum.join(", ")}`);
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (schema.type && actual !== schema.type) { report(at, `must be ${schema.type}, got ${actual}`); return; }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) report(at, `must contain at least ${schema.minLength} character(s)`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) report(at, `must match ${schema.pattern}`);
    if (schema.not?.pattern && (new RegExp(schema.not.pattern)).test(value)) report(at, `must not match ${schema.not.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) report(at, `must contain at least ${schema.minItems} item(s)`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) report(at, "must contain unique items");
    value.forEach((item, index) => validateSchema(item, schema.items, `${at}[${index}]`));
  }
  if (value && actual === "object") {
    for (const key of schema.required || []) if (!(key in value)) report(at, `missing required property ${key}`);
    const properties = schema.properties || {};
    for (const [key, item] of Object.entries(value)) {
      if (schema.propertyNames?.pattern && !(new RegExp(schema.propertyNames.pattern)).test(key)) report(`${at}.${key}`, `property name must match ${schema.propertyNames.pattern}`);
      if (properties[key]) validateSchema(item, properties[key], `${at}.${key}`);
      else if (schema.additionalProperties === false) report(`${at}.${key}`, "unknown property");
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validateSchema(item, schema.additionalProperties, `${at}.${key}`);
    }
  }
}

/** Exact port of isCanonicalTemplatePath (0.20 lib/core.mjs): the canonical
 * `configTemplates` spelling must address a contained file under
 * `config-templates/`. The deprecated `configs` spelling is exempt so already
 * published 0.19 tags stay readable — this repo never emits it. */
const CANONICAL_TEMPLATE_ROOT = "config-templates/";
function isCanonicalTemplatePath(p) {
  if (typeof p !== "string" || !p.startsWith(CANONICAL_TEMPLATE_ROOT)) return false;
  const rest = p.slice(CANONICAL_TEMPLATE_ROOT.length);
  if (!rest || rest.includes("\\")) return false;
  return !rest.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}

/** Resource containment against an arbitrary base. `boundary` is the root the
 * resolved path may not escape — the PAYLOAD root for package-level paths, and
 * the capability's OWN root for everything a capability declares. */
function safeResource(base, candidate, at, kind = "path", boundary = root) {
  if (typeof candidate !== "string" || !candidate.trim()) { report(at, `${kind} must be a non-empty string`); return undefined; }
  if (isAbsolute(candidate) || candidate.split(/[\\/]+/).includes("..")) { report(at, `${kind} must be relative and may not contain '..'`); return undefined; }
  const target = join(base, candidate);
  if (!existsSync(target)) { report(at, `${kind} does not exist: ${candidate}`); return undefined; }
  const realBoundary = realpathSync(boundary);
  const realTarget = realpathSync(target);
  if (realTarget !== realBoundary && !realTarget.startsWith(realBoundary + sep)) {
    report(at, `${kind} resolves outside ${relative(root, realBoundary) || "the package root"} after symlink resolution — it cannot be materialized as a self-contained artifact`);
    return undefined;
  }
  return realTarget;
}

/** Port of assertCapabilitySelfContained's directory walk: a declared directory
 * may itself be contained while a descendant symlink escapes. */
function walkContained(dir, capabilityRoot, at, kind, declared, visited = new Set()) {
  let realDir;
  try { realDir = realpathSync(dir); } catch { return; }
  if (visited.has(realDir)) return;
  visited.add(realDir);
  const realRoot = realpathSync(capabilityRoot);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    let real;
    try { real = realpathSync(path); }
    catch { report(at, `${kind} "${declared}" contains a broken symlink: ${relative(capabilityRoot, path)}`); continue; }
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
      report(at, `${kind} "${declared}" contains a path escaping its capability root: ${relative(capabilityRoot, path)} → ${real}`);
      continue;
    }
    if (entry.isSymbolicLink()) { if (lstatSync(real).isDirectory()) walkContained(real, capabilityRoot, at, kind, declared, visited); }
    else if (entry.isDirectory()) walkContained(path, capabilityRoot, at, kind, declared, visited);
  }
}

/** Templates are package SOURCE MATERIAL an adopter copies verbatim, so they
 * must stay PORTABLE: the schema forbids any secret, credential, account,
 * machine path or provider-local ID. Commentary may show placeholder examples
 * (that is how an adopter learns the shape), so the lint reads only the
 * effective, non-comment configuration. */
function lintTemplatePortability(file, at) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (error) { report(at, `config template is unreadable (${error.message})`); return; }
  const effective = text.split("\n").map((line) => {
    if (/^\s*#/.test(line)) return "";          // whole-line commentary
    return line.replace(/\s+#.*$/, "");          // trailing commentary
  });
  const forbidden = [
    [/[A-Za-z0-9-]+\.atlassian\.net/, "a concrete Jira site — the site is deployment-owned and must be left unset"],
    [/(?:\/Users\/|\/home\/|[A-Za-z]:\\)/, "an absolute machine path"],
    [/(?:^|[\s"'_.-])(?:api[_-]?key|secret|passwd|password|token|credential)s?\s*:/i, "a credential-shaped setting — credentials never live in OAS config"],
    [/\bproject\s*:\s*["']?[A-Z][A-Z0-9_]{1,}["']?\s*$/, "a concrete Jira project key — the project is deployment-owned and must be left unset"],
    [/\bteam\s*:\s*\S/, "a deployment team identity"],
  ];
  for (const [index, line] of effective.entries()) {
    for (const [pattern, why] of forbidden) {
      if (pattern.test(line)) report(`${at}:${index + 1}`, `config template is not portable — it carries ${why}: ${line.trim()}`);
    }
  }
}

const packagePath = join(root, "oas-package.json");
const packageManifest = readJson(packagePath);
const packageSchema = readJson(join(repoRoot, "schemas", "oas-package.schema.json"));
const capabilitySchema = readJson(join(repoRoot, "schemas", "capability-manifest.schema.json"));

if (packageManifest && packageSchema) validateSchema(packageManifest, packageSchema, "oas-package.json");

// ---------------------------------------------------------------- templates
// 0.20 renamed `configs` → `configTemplates`. Both spellings normalize to one
// descriptor shape, but carrying BOTH is an invalid manifest, and new authoring
// must emit the canonical one.
const hasCanonical = packageManifest?.configTemplates !== undefined;
const hasLegacy = packageManifest?.configs !== undefined;
if (hasCanonical && hasLegacy) {
  report("oas-package.json", "carries both `configTemplates` and the deprecated `configs` spelling — a manifest may declare only one");
}
if (hasLegacy) {
  report("oas-package.json.configs", "`configs` is the deprecated 0.19 spelling, readable only for already-published tags; new authoring must emit `configTemplates`");
}

const templates = (hasCanonical && typeof packageManifest.configTemplates === "object" && packageManifest.configTemplates)
  || (hasLegacy && typeof packageManifest.configs === "object" && packageManifest.configs)
  || {};
const templateEntries = Object.entries(templates);
if (templateEntries.filter(([, spec]) => spec?.default === true).length > 1) {
  report("oas-package.json.configTemplates", "at most one config template may be marked default");
}
for (const [name, spec] of templateEntries) {
  const at = `oas-package.json.${hasCanonical ? "configTemplates" : "configs"}.${name}`;
  if (typeof spec?.path !== "string") continue;
  if (hasCanonical && !isCanonicalTemplatePath(spec.path)) {
    report(at, `path ${JSON.stringify(spec.path)} must live under "${CANONICAL_TEMPLATE_ROOT}" with a contained file path (e.g. "${CANONICAL_TEMPLATE_ROOT}default/oas-config.yaml")`);
    continue;
  }
  const real = safeResource(root, spec.path, `${at}.path`, "config template");
  if (!real) continue;
  if (!lstatSync(real).isFile()) { report(`${at}.path`, `config template path is not a file: ${spec.path}`); continue; }
  lintTemplatePortability(real, spec.path);
}

// ------------------------------------------------------------- capabilities
const declaredCapabilities = Array.isArray(packageManifest?.capabilities) ? packageManifest.capabilities : [];
if (declaredCapabilities.length !== 1) {
  report("oas-package.json.capabilities", `official single-capability package must enumerate exactly one capability directory (found ${declaredCapabilities.length})`);
}
if (new Set(declaredCapabilities).size !== declaredCapabilities.length) {
  report("oas-package.json.capabilities", "contains duplicates");
}

const capabilities = [];
for (const [index, capabilityDir] of declaredCapabilities.entries()) {
  const at = `oas-package.json.capabilities[${index}]`;
  // A "." root is 0.20 READ COMPATIBILITY for already-published packages only,
  // and the kernel rejects it outright once the manifest carries
  // `configTemplates`. Authoring must never emit it: a dedicated root is what
  // makes the materialized artifact independently hashable and trustable.
  if (capabilityDir === ".") {
    report(at, hasCanonical
      ? "a \".\" capability root is rejected by 0.20 whenever the manifest carries `configTemplates`"
      : "a \".\" capability root is read-compatibility for already-published packages only; authoring must use a dedicated root such as \"capabilities/<slug>\"");
    continue;
  }
  safeResource(root, capabilityDir, at, "capability directory");
  if (isAbsolute(capabilityDir) || capabilityDir.split(/[\\/]+/).includes("..")) continue;
  const manifestPath = join(root, capabilityDir, "oas.json");
  if (!existsSync(manifestPath)) { report(at, `${capabilityDir} has no oas.json`); continue; }
  const manifest = readJson(manifestPath);
  if (!manifest) continue;
  capabilities.push(manifest);
  if (capabilitySchema) validateSchema(manifest, capabilitySchema, `${capabilityDir}/oas.json`);

  // SELF-CONTAINMENT: every declared resource resolves inside the capability's
  // OWN root, not merely inside the package. This is the boundary that lets the
  // kernel materialize the capability flat into
  // .agents/capabilities/installed/<id>/ and hash it independently.
  const capabilityRoot = dirname(manifestPath);
  const declare = (resource, resourceAt, kind, walk = false) => {
    const real = safeResource(capabilityRoot, resource, resourceAt, kind, capabilityRoot);
    if (real && walk && lstatSync(real).isDirectory()) walkContained(real, capabilityRoot, resourceAt, kind, resource);
  };
  for (const [i, resource] of (manifest.skills || []).entries()) declare(resource, `${capabilityDir}/oas.json.skills[${i}]`, "skill path", true);
  if (manifest.inject) declare(manifest.inject, `${capabilityDir}/oas.json.inject`, "injection path");
  for (const [i, agent] of (manifest.agents || []).entries()) declare(agent, `${capabilityDir}/oas.json.agents[${i}]`, "agent path", true);
  // A hook may be a plain "entrypoint args" string or the object form
  // { command, required } (only the spawn hook may set required). Commands are
  // always strings. Reduce either to the executable entrypoint for containment.
  const entrypoint = (spec) => {
    const command = typeof spec === "string" ? spec : (spec && typeof spec === "object" ? spec.command : undefined);
    return typeof command === "string" ? command.trim().split(/\s+/)[0] : command;
  };
  for (const [name, command] of Object.entries(manifest.commands || {})) declare(entrypoint(command), `${capabilityDir}/oas.json.commands.${name}`, "command entrypoint");
  for (const [event, hook] of Object.entries(manifest.hooks || {})) declare(entrypoint(hook), `${capabilityDir}/oas.json.hooks.${event}`, "hook entrypoint");
  for (const forbidden of ["global", "agent-types", "souls"]) if (forbidden in manifest) report(`${capabilityDir}/oas.json.${forbidden}`, "deployment targeting belongs to config, not a capability manifest");
}

// ------------------------------------------------------ package ↔ capability
if (capabilities.length === 1 && packageManifest) {
  const capability = capabilities[0];
  if (packageManifest.package !== capability.capability) report("oas-package.json.package", "single-capability official package ID must equal its capability ID");
  if (packageManifest.version !== capability.version) report("oas-package.json.version", "must equal the exported capability version");
  if (packageManifest.compatibility?.oas !== capability.compatibility?.oas) report("oas-package.json.compatibility.oas", "must match the exported capability compatibility floor");
}

if (errors.length) {
  process.stderr.write(`Manifest validation failed:\n- ${errors.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`Validated ${relative(process.cwd(), packagePath) || "oas-package.json"}, ${templateEntries.length} config template(s) and ${capabilities.length} capability manifest(s) against the OAS 0.20 package contract.\n`);
