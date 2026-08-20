#!/usr/bin/env node
// Isolated consumer probe: exercises this package against a REAL released OAS
// kernel at or above its declared compatibility floor, in a throwaway sandbox.
//
// It is deliberately not a unit test. `scripts/validate-manifests.mjs` re-checks
// the contract offline; this script proves the kernel actually does what the
// package promises an adopter — acquisition, flat materialization, exact
// restore, requirement reporting, executable trust, explicit template adoption,
// ignore behavior, and task-layer composition at spawn.
//
//   node scripts/consumer-probe.mjs                  # installs the floor kernel
//   node scripts/consumer-probe.mjs --cli <oas-bin>  # probe an existing kernel
//   OAS_PROBE_CLI=<oas-bin> node scripts/consumer-probe.mjs
//
// Isolation rules, all enforced below rather than assumed:
//   * never the `oas` on PATH — a stale global kernel would silently pass a
//     probe about behavior it does not implement;
//   * a sandbox HOME, so no laptop-level OAS config or agent roster is read;
//   * a sanitized PATH for the requirement check, so a host that happens to
//     have `acli` cannot mask missing-requirement reporting;
//   * the payload is copied out of the repo, so nothing here mutates the tree.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const payload = join(repoRoot, "oas-package");
const packageManifest = JSON.parse(readFileSync(join(payload, "oas-package.json"), "utf8"));
const CAPABILITY = "oas.jira";

const results = [];
let failed = 0;
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ ok: true, name, detail });
    process.stdout.write(`  ok    ${name}${detail ? ` — ${detail}` : ""}\n`);
  } catch (error) {
    failed++;
    results.push({ ok: false, name, detail: error.message });
    process.stdout.write(`  FAIL  ${name}\n        ${error.message.replace(/\n/g, "\n        ")}\n`);
  }
}
function assert(condition, message) { if (!condition) throw new Error(message); }

// ------------------------------------------------------------------ sandbox
const sandbox = mkdtempSync(join(tmpdir(), "oas-jira-probe-"));
const home = join(sandbox, "home");
const src = join(sandbox, "payload");
mkdirSync(home, { recursive: true });
cpSync(payload, src, { recursive: true });
let keepSandbox = false;
process.on("exit", () => { if (!keepSandbox) rmSync(sandbox, { recursive: true, force: true }); });

const nodeBin = dirname(process.execPath);
// `acli` normally lives outside the Node toolchain directory, so a PATH of just
// the Node bin plus the base system dirs reproduces a host that never installed
// it. Asserted below rather than trusted.
const sanitizedPath = [nodeBin, "/usr/bin", "/bin"].join(delimiter);

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert(r.status === 0, `git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

// ------------------------------------------------------------- kernel under test
function resolveCli() {
  const flagIndex = process.argv.indexOf("--cli");
  const explicit = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.env.OAS_PROBE_CLI;
  if (explicit) {
    assert(existsSync(explicit), `--cli path does not exist: ${explicit}`);
    return { bin: resolve(explicit), installed: false };
  }
  // Derive the exact version to probe from the package's own floor, so the
  // probe follows the manifest instead of a hard-coded constant.
  const floor = String(packageManifest.compatibility?.oas || "");
  const match = floor.match(/(\d+\.\d+\.\d+)/);
  assert(match, `cannot derive a kernel version from compatibility.oas ${JSON.stringify(floor)}`);
  const prefix = join(sandbox, "kernel");
  mkdirSync(prefix, { recursive: true });
  process.stdout.write(`  ..    installing @oas-framework/oas@${match[1]} into an isolated prefix\n`);
  const r = spawnSync("npm", ["install", "--prefix", prefix, `@oas-framework/oas@${match[1]}`, "--no-audit", "--no-fund", "--silent"], { encoding: "utf8" });
  assert(r.status === 0, `could not install the released kernel: ${r.stderr || r.stdout}`);
  return { bin: join(prefix, "node_modules", ".bin", "oas"), installed: true };
}

const cli = resolveCli();
assert(existsSync(cli.bin), `released kernel binary not found at ${cli.bin}`);

/** Run the kernel under test. Always with the sandbox HOME, never via PATH
 * lookup, so an ambient `oas` cannot answer for it. */
function oas(args, { cwd = sandbox, path = process.env.PATH, json = true } = {}) {
  const r = spawnSync(cli.bin, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: home, PATH: path, OAS_PROBE: "1" },
  });
  if (!json) return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  return { status: r.status, envelope: parseEnvelope(r, args), stdout: r.stdout, stderr: r.stderr };
}

/** Kernel --json output is not uniformly shaped: some commands emit exactly one
 * envelope line, others pretty-print a multi-line object after human-readable
 * progress lines. Parse the whole document first, then the tail starting at each
 * top-level "{" line, so neither shape is misread (a naive last-"{"-line reader
 * silently picks up an INNER object of a pretty-printed envelope). */
function parseEnvelope(r, args) {
  const text = r.stdout.trim();
  const attempt = (candidate) => { try { return JSON.parse(candidate); } catch { return undefined; } };
  const whole = attempt(text);
  if (whole !== undefined) return whole;
  const lines = r.stdout.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("{")) continue;              // top-level only: column 0
    const parsed = attempt(lines.slice(index).join("\n").trim());
    if (parsed !== undefined) return parsed;
  }
  throw new Error(`expected a JSON envelope from \`oas ${args.join(" ")}\`, got:\n${r.stdout}\n${r.stderr}`);
}

/** Guard against a FALSE GREEN: `layers.tasks` only carries requirements, hooks
 * and provenance while the layer is actually bound by config. An unbound layer
 * reports an empty everything, which would read as "nothing missing". */
function assertTasksLayerActive(envelope) {
  assert(envelope.layers?.tasks?.integration === CAPABILITY,
    `the tasks layer is not bound to ${CAPABILITY} — this check would pass for the wrong reason (got ${JSON.stringify(envelope.layers?.tasks)})`);
}

function newScope(name, { asGitRepo = false, withAgents = false } = {}) {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  if (asGitRepo) {
    git(["init", "-q"], dir);
    git(["config", "user.email", "probe@example.invalid"], dir);
    git(["config", "user.name", "probe"], dir);
  }
  if (withAgents) mkdirSync(join(dir, "agents"), { recursive: true });
  return dir;
}

/** A content-aware digest of a materialized artifact tree.
 *
 * Comparing file NAMES is not enough to call a restore "exact": a restore that
 * recreates every path while corrupting bytes, flipping the executable bit, or
 * repointing a symlink would look identical. The kernel's own integrity
 * bookkeeping would normally catch that, but a probe exists to VERIFY the kernel,
 * not to take its word for it — so this hashes content independently.
 *
 * Covers, per entry: relative path, entry type, symlink target, the executable
 * bit (a hook that lost +x is a real regression), and file bytes. */
function artifactDigest(dir) {
  const hash = createHash("sha256");
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = join(current, entry.name);
      const rel = relative(dir, path);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) { hash.update(`L ${rel} -> ${readlinkSync(path)}\n`); continue; }
      if (stat.isDirectory()) { hash.update(`D ${rel}\n`); walk(path); continue; }
      hash.update(`F ${rel} ${(stat.mode & 0o111) ? "x" : "-"} `);
      hash.update(createHash("sha256").update(readFileSync(path)).digest("hex"));
      hash.update("\n");
    }
  };
  walk(dir);
  return `sha256-${hash.digest("hex")}`;
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(path, base));
    else out.push(relative(base, path));
  }
  return out.sort();
}

process.stdout.write(`\noas.jira consumer probe — payload ${packageManifest.package}@${packageManifest.version} (floor ${packageManifest.compatibility?.oas})\n\n`);

// ---------------------------------------------------------------- 0. kernel
check("kernel under test satisfies the declared compatibility floor", () => {
  const version = oas(["version", "--json"]).envelope;
  const actual = version.version || version.result?.version;
  assert(actual, `no version in ${JSON.stringify(version)}`);
  const floor = String(packageManifest.compatibility.oas).replace(/^>=/, "");
  const cmp = (a, b) => {
    const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
    return 0;
  };
  assert(cmp(actual, floor) >= 0, `kernel ${actual} is below the declared floor ${floor}`);
  const ambient = spawnSync("oas", ["--version"], { encoding: "utf8" });
  const ambientVersion = (ambient.stdout || "").match(/(\d+\.\d+\.\d+)/)?.[1];
  assert(resolve(cli.bin) !== resolve(spawnSync("command", ["-v", "oas"], { shell: true, encoding: "utf8" }).stdout.trim() || "/nonexistent"),
    "probe would run the ambient PATH kernel — it must run an explicitly resolved binary");
  return `oas ${actual} at ${cli.bin}${ambientVersion ? ` (ambient PATH kernel is ${ambientVersion}, unused)` : ""}`;
});

// -------------------------------------------------- 1. flat materialization
let flatScope; let flatInstall;
check("install materializes ONE flat, self-contained capability artifact", () => {
  flatScope = newScope("flat");
  const { envelope } = oas(["install", src, "--dir", flatScope, "--no-requirements", "--json"]);
  assert(envelope.ok, `install failed: ${JSON.stringify(envelope.error)}`);
  flatInstall = envelope.result;
  assert(flatInstall.capabilities.length === 1, `expected 1 capability, got ${flatInstall.capabilities.length}`);
  const cap = flatInstall.capabilities[0];
  assert(cap.capability === CAPABILITY, `expected ${CAPABILITY}, got ${cap.capability}`);
  assert(cap.version === packageManifest.version, `capability version ${cap.version} ≠ package version ${packageManifest.version}`);
  assert(cap.path === packageManifest.capabilities[0], `locked capability path ${cap.path} ≠ declared ${packageManifest.capabilities[0]}`);

  const artifact = join(flatScope, ".agents", "capabilities", "installed", CAPABILITY);
  assert(existsSync(artifact), `no materialized artifact at ${artifact}`);
  const files = walkFiles(artifact);
  // FLAT: the capability's own root is lifted to the artifact root — the
  // `capabilities/oas-jira/` nesting must not survive materialization.
  assert(files.includes("oas.json"), `artifact is not flat — no oas.json at its root (${files.join(", ")})`);
  assert(!files.some((f) => f.startsWith("capabilities" + "/")), `artifact re-nests the capability root: ${files.join(", ")}`);
  // Package-only source material must NOT be installed. Config templates are
  // source material an adopter adopts explicitly; install applies none of them.
  for (const packageOnly of ["oas-package.json", "LICENSE"]) {
    assert(!files.includes(packageOnly), `package-only file ${packageOnly} leaked into the materialized artifact`);
  }
  assert(!files.some((f) => f.startsWith("config-templates" + "/")), "config templates leaked into the materialized artifact — install must apply none of them");
  assert(files.includes(".oas-installation.json"), "artifact carries no .oas-installation.json provenance");
  return `${files.length} files, flat at ${relative(flatScope, artifact)}`;
});

check("no capability-level config is applied by install", () => {
  assert(!existsSync(join(flatScope, "oas-config.yaml")),
    "install wrote an oas-config.yaml — acquisition must never activate or configure the capability");
  return "install acquired and locked only; no config written";
});

// ------------------------------------------------------------ 2. exact restore
check("bare install restores the locked artifact EXACTLY and preserves trust", () => {
  const lockPath = join(flatScope, "oas-lock.json");
  oas(["trust", CAPABILITY, "--dir", flatScope], { json: false });
  const before = readFileSync(lockPath, "utf8");
  assert(JSON.parse(before).capabilities[CAPABILITY].trusted === true, "trust did not take effect");
  const artifact = join(flatScope, ".agents", "capabilities", "installed", CAPABILITY);
  const digestBefore = artifactDigest(artifact);

  rmSync(join(flatScope, ".agents", "capabilities", "installed"), { recursive: true, force: true });
  const { envelope } = oas(["install", "--dir", flatScope, "--no-requirements", "--json"]);
  assert(envelope.ok, `restore failed: ${JSON.stringify(envelope.error)}`);

  const after = readFileSync(lockPath, "utf8");
  assert(after === before, "restore rewrote the lock — a lock must never advance silently on restore");
  // Independent of the kernel's own integrity bookkeeping: same paths, same
  // bytes, same modes, same link targets.
  const digestAfter = artifactDigest(artifact);
  assert(digestAfter === digestBefore,
    `restore did not reproduce the artifact byte-for-byte (${digestBefore} → ${digestAfter})`);
  assert(JSON.parse(after).capabilities[CAPABILITY].trusted === true,
    "restore reset trust — materialization is not reproducing the exact locked artifact integrity");
  return `lock byte-identical, artifact reproduced bit-for-bit (${digestBefore.slice(0, 19)}…), trust preserved`;
});

// --------------------------------------------------- 3. requirement reporting
// Requirements and hooks are reported for the ACTIVE tasks layer, so the
// capability has to be ACTIVATED, and `oas install` deliberately never activates.
// Activation also cannot bootstrap from nothing: capability discovery walks the
// config chain, so `oas use` in a scope with no oas-config.yaml anywhere above it
// reports "acquired: none" even though the artifact is installed and `oas list`
// shows it. `oas init --package` is the adopter path that creates the config and
// binds the layer in one step, so these checks run in such a scope — without it
// they would read an absent layer and pass for the wrong reason.
const activeScope = newScope("active", { asGitRepo: true, withAgents: true });
check("a missing `acli` is reported as an unmet host requirement", () => {
  const init = oas(["init", "--package", src, "--dir", activeScope, "--json"]);
  assert(init.envelope.ok !== false, `adoption failed: ${JSON.stringify(init.envelope.error)}`);
  const absent = spawnSync("command", ["-v", "acli"], { shell: true, encoding: "utf8", env: { ...process.env, PATH: sanitizedPath } });
  assert(absent.status !== 0, "sanitized PATH still resolves `acli` — this check cannot prove anything on this host");
  const { envelope } = oas(["doctor", activeScope, "--json"], { path: sanitizedPath });
  assertTasksLayerActive(envelope);
  const missing = envelope.layers?.tasks?.missingRequires || [];
  const acli = missing.find((m) => m.command === "acli");
  assert(acli, `doctor did not report the acli requirement: ${JSON.stringify(missing)}`);
  assert(acli.install, "the acli requirement carries no install guidance for the operator");
  // The package must never authenticate on the operator's behalf; it reports.
  const declared = JSON.parse(readFileSync(join(src, packageManifest.capabilities[0], "oas.json"), "utf8"));
  assert(declared.requires.some((r) => r.command === "acli"), "capability no longer declares the acli requirement");
  return `reported with install guidance (${acli.install})`;
});

check("a present `acli` clears the requirement", () => {
  // A stub is enough: OAS reports host-command PRESENCE, and must never run or
  // authenticate the tool itself.
  const stubDir = join(sandbox, "stub-bin");
  mkdirSync(stubDir, { recursive: true });
  const stub = join(stubDir, "acli");
  writeFileSync(stub, "#!/bin/sh\necho 'probe stub: OAS must never invoke acli'\nexit 0\n", { mode: 0o755 });
  const { envelope } = oas(["doctor", activeScope, "--json"], { path: [stubDir, sanitizedPath].join(delimiter) });
  assertTasksLayerActive(envelope);
  assert((envelope.layers?.tasks?.missingRequires || []).length === 0,
    `requirement still reported with acli present: ${JSON.stringify(envelope.layers?.tasks?.missingRequires)}`);
  return "no unmet requirements when acli is on PATH";
});

// ------------------------------------------------------------ 4. executable trust
check("the executable surface is withheld until explicitly trusted", () => {
  const scope = newScope("untrusted", { asGitRepo: true });
  const init = oas(["init", "--package", src, "--dir", scope, "--json"]);
  assert(init.envelope.ok !== false, `adoption failed: ${JSON.stringify(init.envelope.error)}`);

  const lock = JSON.parse(readFileSync(join(scope, "oas-lock.json"), "utf8"));
  assert(lock.capabilities[CAPABILITY].trusted === false, "a freshly acquired capability must not be trusted");
  // Trust binds to the MATERIALIZED artifact integrity, not to the package.
  assert(/^sha256-[0-9a-f]{64}$/.test(lock.capabilities[CAPABILITY].integrity || ""),
    "the lock's capability entry carries no artifact integrity for trust to bind to");
  assert(lock.capabilities[CAPABILITY].package === packageManifest.package, "lock does not attribute the capability to this package");

  const before = oas(["doctor", scope, "--json"]).envelope;
  assertTasksLayerActive(before);
  assert((before.layers?.tasks?.hooks || []).length === 0,
    `untrusted capability composed hooks: ${JSON.stringify(before.layers?.tasks?.hooks)}`);

  oas(["trust", CAPABILITY, "--dir", scope], { json: false });
  const after = oas(["doctor", scope, "--json"]).envelope;
  assertTasksLayerActive(after);
  assert((after.layers?.tasks?.hooks || []).includes("spawn"), "trusted capability still does not compose its spawn hook");
  return "untrusted → no hooks; `oas trust` → spawn hook composed, bound to artifact integrity";
});

// ------------------------------------------------- 5. explicit template adoption
let adoptScope;
check("the config template is adopted only on explicit request, and recorded", () => {
  adoptScope = newScope("adopt", { asGitRepo: true, withAgents: true });
  const { envelope } = oas(["init", "--package", src, "--dir", adoptScope, "--json"]);
  assert(envelope.ok !== false, `adoption failed: ${JSON.stringify(envelope.error)}`);

  const config = join(adoptScope, "oas-config.yaml");
  assert(existsSync(config), "no oas-config.yaml was created from the template");
  const templateName = Object.entries(packageManifest.configTemplates).find(([, t]) => t.default)?.[0];
  assert(templateName, "package marks no default config template — adoption would need an explicit --config");

  // Adopted verbatim: the template's guidance comments are what teach an
  // adopter which settings are theirs to fill in, so they must survive.
  const templateSource = readFileSync(join(src, packageManifest.configTemplates[templateName].path), "utf8");
  assert(readFileSync(config, "utf8") === templateSource, "the adopted config is not a verbatim copy of the template");

  const base = join(adoptScope, ".agents", "config-templates", "adopted", packageManifest.package, templateName);
  assert(existsSync(join(base, "oas-config.yaml")), `no adopted base recorded at ${relative(adoptScope, base)}`);
  const adoption = JSON.parse(readFileSync(join(base, "adoption.json"), "utf8"));
  assert(adoption.package === packageManifest.package, "adopted base records the wrong package");
  assert(adoption.version === packageManifest.version, "adopted base records the wrong version");
  assert(adoption.templatePath === packageManifest.configTemplates[templateName].path, "adopted base records the wrong template path");
  assert(/^sha256-[0-9a-f]{64}$/.test(adoption.hash || ""), `adopted base carries no template hash: ${adoption.hash}`);
  return `template "${templateName}" adopted verbatim; base recorded at ${relative(adoptScope, base)}`;
});

check("the shipped template is portable — it binds the layer but sets no deployment identity", () => {
  const { envelope } = oas(["doctor", adoptScope, "--json"]);
  assert(envelope.layers?.tasks?.integration === CAPABILITY, `template did not bind the tasks layer to ${CAPABILITY}`);
  const settings = envelope.capabilities?.find((c) => c.id === CAPABILITY)?.settings || {};
  assert(Object.keys(settings).length === 0,
    `template pre-set deployment-owned settings ${JSON.stringify(settings)} — a template must carry no site, project or account`);
  return "tasks layer bound; site/project left to the adopter";
});

// ------------------------------------------------------------- 6. ignore behavior
check("materialized artifacts are uncommittable; the lock and adopted base are not", () => {
  const ignoreFile = join(adoptScope, ".agents", "capabilities", ".gitignore");
  assert(existsSync(ignoreFile), "no .agents/capabilities/.gitignore at a Git-backed scope");
  assert(readFileSync(ignoreFile, "utf8").split("\n").some((l) => l.trim() === "installed/"),
    "the capability store .gitignore does not ignore installed/");

  const ignored = (rel) => spawnSync("git", ["check-ignore", "-q", rel], { cwd: adoptScope }).status === 0;
  assert(ignored(join(".agents", "capabilities", "installed", CAPABILITY, "oas.json")),
    "the materialized artifact is committable — generated artifacts must never enter a commit");
  // Provenance and the adopted base are review artifacts: they MUST stay
  // committable, or an adopter cannot review what they took on.
  assert(!ignored("oas-lock.json"), "oas-lock.json is ignored — the lock is committed provenance");
  assert(!ignored(join(".agents", "config-templates", "adopted", packageManifest.package, "default", "oas-config.yaml")),
    "the adopted base is ignored — it is meant to be reviewed and committed");
  return "installed/ ignored; lock + adopted base committable";
});

// ----------------------------------------- 7. task-layer composition and spawn
check("spawn composes the tasks layer and reports incomplete settings", () => {
  oas(["trust", CAPABILITY, "--dir", adoptScope], { json: false });
  oas(["create", "probe-dev", "--description", "probe soul"], { cwd: adoptScope, json: false });
  const { envelope } = oas(["spawn", "probe-dev", "--purpose", "unset", "--no-launch", "--json"], { cwd: adoptScope });
  assert(envelope.ok, `spawn failed: ${JSON.stringify(envelope.error)}`);
  const instanceHome = envelope.result.home;

  const composed = readFileSync(join(instanceHome, "AGENTS.md"), "utf8");
  assert(/Tasks: Jira/.test(composed), "the composed AGENTS.md carries no Jira tasks-layer section");
  assert(/jira-tasks/.test(composed), "the composed AGENTS.md never points the agent at the jira-tasks skill");
  assert(existsSync(join(instanceHome, ".agents", "skills", "jira-tasks", "SKILL.md")),
    "the jira-tasks skill was not wired into the instance");

  // The template ships site/project unset on purpose; the hook must SAY so
  // rather than guess a site or project.
  const warnings = envelope.result.warnings || [];
  assert(warnings.some((w) => /settings incomplete/.test(w) && /site: unset/.test(w) && /project: unset/.test(w)),
    `spawn did not report incomplete settings: ${JSON.stringify(warnings)}`);
  return "AGENTS.md + skill composed; unset site/project reported, never guessed";
});

check("spawn is clean once the adopter supplies site and project", () => {
  oas(["use", CAPABILITY, "--global", "--settings", "site=example.atlassian.net", "project=PROJ", "--dir", adoptScope], { json: false });
  const { envelope } = oas(["spawn", "probe-dev", "--purpose", "set", "--no-launch", "--json"], { cwd: adoptScope });
  assert(envelope.ok, `spawn failed: ${JSON.stringify(envelope.error)}`);
  const warnings = envelope.result.warnings || [];
  assert(warnings.length === 0, `spawn still warned with complete settings: ${JSON.stringify(warnings)}`);
  return "no warnings with site + project set";
});

check("an untrusted capability composes instructions but never runs its hook", () => {
  const scope = newScope("untrusted-spawn", { asGitRepo: true, withAgents: true });
  oas(["init", "--package", src, "--dir", scope, "--json"]);
  // Settings are left UNSET on purpose. This check proves the hook did not run
  // by the ABSENCE of the hook's own output, and absence only means something
  // when the hook WOULD have spoken had it run: with settings unset a running
  // hook emits "settings incomplete". With settings complete this hook is
  // silent, so the same assertion would pass even if the hook had executed.
  oas(["create", "probe-dev", "--description", "probe soul"], { cwd: scope, json: false });
  const { envelope } = oas(["spawn", "probe-dev", "--purpose", "u", "--no-launch", "--json"], { cwd: scope });
  assert(envelope.ok, `spawn failed: ${JSON.stringify(envelope.error)}`);
  const warnings = envelope.result.warnings || [];
  assert(warnings.some((w) => /executable surface disabled/.test(w)),
    `untrusted spawn did not report the disabled executable surface: ${JSON.stringify(warnings)}`);
  assert(!warnings.some((w) => /settings incomplete/.test(w)),
    "the hook emitted its incomplete-settings warning while untrusted — it must not have run");
  // Belt and braces: no trace of the hook's identity/brief output anywhere in
  // the spawn envelope either.
  const envelopeText = JSON.stringify(envelope.result);
  assert(!/agent-probe-dev-u/.test(envelopeText),
    "the untrusted hook's label output reached the spawn envelope — it must not have run");

  const composed = readFileSync(join(envelope.result.home, "AGENTS.md"), "utf8");
  assert(/Tasks: Jira/.test(composed), "the non-executable surface (instructions) was withheld — only hooks are trust-gated");
  assert(existsSync(join(envelope.result.home, ".agents", "skills", "jira-tasks", "SKILL.md")),
    "the jira-tasks skill was withheld — only executable surfaces are trust-gated");
  return "instructions + skill composed; hook provably silent pending `oas trust`";
});

// -------------------------------------------------- 8. git-source acquisition
check("acquisition from a Git source selects the conventional oas-package root", () => {
  const remote = newScope("remote", { asGitRepo: true });
  cpSync(payload, join(remote, "oas-package"), { recursive: true });
  git(["add", "-A"], remote);
  git(["commit", "-qm", "probe"], remote);
  const head = git(["rev-parse", "HEAD"], remote);

  const scope = newScope("from-git");
  const { envelope } = oas(["install", `file://${remote}`, "--dir", scope, "--no-requirements", "--json"]);
  assert(envelope.ok, `git install failed: ${JSON.stringify(envelope.error)}`);
  const pkg = envelope.result.installed[0];
  assert(pkg.path === "oas-package", `git acquisition selected root ${JSON.stringify(pkg.path)}, expected "oas-package"`);
  assert(pkg.commit === head, `locked commit ${pkg.commit} ≠ source HEAD ${head}`);
  assert(/^git:/.test(pkg.source), `git source not normalized: ${pkg.source}`);
  assert(!pkg.source.includes("#"), "the selected root leaked into the source string instead of the lock's path field");
  return `locked at ${head.slice(0, 12)} with root "oas-package"`;
});

// ------------------------------------------------------------------- report
const passed = results.filter((r) => r.ok).length;
process.stdout.write(`\n${failed ? "FAILED" : "PASSED"}: ${passed}/${results.length} consumer checks against the released kernel.\n`);
if (failed) { keepSandbox = true; process.stdout.write(`Sandbox kept for inspection: ${sandbox}\n`); }
process.exit(failed ? 1 : 0);
