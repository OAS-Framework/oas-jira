#!/usr/bin/env node
/**
 * oas-jira — OAS tasks-provider hook for Jira.
 *
 * Invoked by the OAS kernel at instance lifecycle events (hook contract):
 *   oas-jira spawn   surface the instance's Jira identity (label) and the
 *                    deployment's site/project in TASK.md — advisory only,
 *                    no Jira calls, nothing to mint or clean up.
 *
 * Env contract (set by the kernel):
 *   OAS_EVENT     spawn
 *   OAS_INSTANCE  instance name (its Jira label is agent-<instance>)
 *   OAS_SETTINGS  JSON of the provider's `settings:` block ({ site?, project? })
 *
 * Output (stdout JSON): { "meta": {...}, "brief": "...", "warning": "..." }
 * Exit code is advisory: the kernel treats hook failure as a warning, never a block.
 */
const out = (o) => { process.stdout.write(JSON.stringify(o) + "\n"); process.exit(0); };
const warn = (m) => out({ warning: `oas-jira: ${String(m).slice(0, 300)}` });

const event = process.env.OAS_EVENT || process.argv[2];
const instance = process.env.OAS_INSTANCE;
const settings = JSON.parse(process.env.OAS_SETTINGS || "{}");

if (event === "spawn") {
  const label = `agent-${instance}`;
  const site = settings.site;
  const project = settings.project;
  const where = site && project ? `project ${project} on ${site}`
    : site ? `site ${site} (project unset — ask your human or check oas doctor)`
    : project ? `project ${project} (site unset — ask your human or check oas doctor)`
    : `your deployment's Jira (site/project not configured — ask your human, or set capabilities.oas.jira.<target>.settings in oas-config.yaml)`;
  out({
    meta: { label, ...(site ? { site } : {}), ...(project ? { project } : {}) },
    brief: `Tasks: Jira — ${where}. Your Jira identity is the label "${label}" (never the assignee field). Load the jira-tasks skill before touching tickets.`,
    ...(site && project ? {} : { warning: `oas-jira: settings incomplete (site: ${site || "unset"}, project: ${project || "unset"}) — set capabilities.oas.jira.<target>.settings.{site,project} in oas-config.yaml` }),
  });
} else {
  warn(`unknown event "${event}" (expected spawn)`);
}
