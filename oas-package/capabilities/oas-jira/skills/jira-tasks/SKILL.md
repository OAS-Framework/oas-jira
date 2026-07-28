---
name: jira-tasks
description: >-
  Jira task tracking and agent roster protocol for OAS agents. Use when you
  are an agent instance working an epic, story, or task in Jira: reading your
  assignment, finding your work queue, joining or leaving an epic's Agent
  Roster, posting progress or handoff comments, transitioning ticket status,
  or creating stories/tasks under an epic. Also use when asked about "the
  board", "the roster", "your ticket", "epic status", or task tracking
  between agents. Uses the acli CLI (Atlassian CLI) from bash.
---

# Agent task tracking (Jira)

Jira is your deployment's **tasks layer** — the shared record for task
tracking and the agent roster. Agents do not know about projects — you know
**repos and epics**. The hierarchy:

- **Epic** — the unit of work that kicks off, runs, and completes. May touch
  one repo or several. Its description carries the **Agent Roster** — the
  source of truth for who is on the epic and their role. Bugs/support run as
  a standing epic.
- **Story** — a **group of related tasks** covering one part of the epic's
  work (often one repo's slice, one feature area). Not every task needs a
  story.
- **Task** — a small bounded item, the thing an agent actually works. Lives
  **either directly under the epic** (standalone item) **or under a story**
  (part of a grouped slice). Everything traces up to an epic.

## Site and project (from your deployment, never hardcoded)

Your Jira **site** and **project key** come from the deployment's OAS config
(`capabilities.oas.jira.<target>.settings: { site, project }`). Find them, in order:

1. Your `TASK.md` briefing — the spawn hook writes a
   `Tasks: Jira — project <KEY> on <site>` line.
2. `oas doctor --json` from your work tree (the tasks layer's settings).
3. Ask your human.

Below, `<PROJECT>` means that project key. If site or project are unset,
STOP and ask your human to set them — do not guess.

**First use**: run `acli jira auth status` — if unauthorized, STOP and tell
the human to run `acli jira auth login --web`. Never attempt login yourself.

## Identity rules (non-negotiable)

- **The human assignee is always the owning engineer** (never change
  assignee to yourself; agents are not Jira users). Do not touch assignee
  unless told.
- **You are identified by label and description**, not the assignee field:
  - Label `agent-<your-instance-alias>` on any story/task you work.
  - An `Agent:` line in the description (see templates).
- **Never set or modify sprints.** Never delete tickets. Comment, don't
  rewrite, other agents' descriptions (exception: coordinators maintain the
  roster table).

## Your work queue

```bash
acli jira workitem search --jql "project = <PROJECT> AND labels = agent-<alias> AND statusCategory != Done ORDER BY rank" --json
acli jira workitem view <PROJECT>-1234 --json          # read one ticket (description, labels, status)
acli jira workitem search --jql "project = <PROJECT> AND parent = <PROJECT>-<epic> AND statusCategory != Done" --json   # epic's direct children (stories + standalone tasks)
acli jira workitem search --jql "project = <PROJECT> AND parent = <PROJECT>-<story> AND statusCategory != Done" --json  # a story's tasks
```

An epic's full open work = its direct children **plus** the tasks under each
of its stories — walk one level down from stories when you need the complete
picture.

Record your epic and ticket keys in your instance memory (e.g. `STATE.md`
`# Context`).

## The Agent Roster (epics)

The epic description contains a `## Agent Roster` markdown table — current
truth for who is on the epic:

```
## Agent Roster

| Agent (instance) | Soul / class | Repo | Role on epic | Status | Since |
|---|---|---|---|---|---|
| coordinator-digest | coordinator (newsletter) | newsletter-service | runs the epic | active | 2026-07-07 |
| developer-digest-api | developer (newsletter) | newsletter-service | implements API | active | 2026-07-07 |
```

Protocol:
- **Joining**: the coordinator (or the spawning agent) adds your row to the
  table (`acli jira workitem edit <epic> --description ...` with the full
  updated description — read it first, edit only the roster table) AND posts
  a comment: `[roster] <alias> joined — role: <role>, repo: <repo>`.
- **Leaving/retiring**: set the row's Status to `retired` (keep the row — it
  is history) and comment `[roster] <alias> retired — <one-line outcome>`.
- Only edit the roster table; never rewrite the rest of the epic description.
- Comments are the event log; the table is current state. On conflict, fix
  the table and note it in a comment.

## Working a ticket

1. Read your ticket and its epic (description + roster) before starting.
2. **Milestones** → comment on your ticket, prefixed `[<alias>]`. Mirror the
   entry you record in your instance memory — same events, two audiences.
3. **Status transitions** — move your ticket as you work:
   `acli jira workitem transition <PROJECT>-1234 --status "In Progress"`.
   Discover valid statuses with `--help` or by trying; if a transition is
   rejected, comment instead and let the coordinator move it.
4. **Done** = your latest commit is review-clean and the branch is handed
   off. Comment the outcome (branch, PR link, verification), then transition.
5. **Handoff/blocked** → comment
   `[<alias>] handoff → <next-alias>: <what+where>` or
   `[<alias>] blocked: <what is needed, from whom>`.

Tasks ≠ messaging: status and outcomes live here in Jira; conversation lives
in your deployment's messaging layer. Mail nudges; Jira records.

## Creating tickets (coordinators; developers file follow-ups as Tasks)

House rules: summary ≤ 12 words, describe the requirement not the solution,
bugs always include reproduction steps, keep descriptions to a few bullets.

**Choosing the level:**
- Small bounded item, no siblings needed → **Task directly under the epic**.
- A part of the epic's work that breaks into several related tasks → **Story
  under the epic, tasks under the story**. The story is the group, not the
  work item — agents are assigned to its tasks (a story worked wholly by one
  agent may carry that agent's label too).
- Never create a story for a single task, and never nest stories.

```bash
acli jira workitem create --project <PROJECT> --type Task --summary "<summary>" \
  --parent <PROJECT>-<epic-or-story> --label "agent-<alias>" --description "<see template>"
acli jira workitem create --project <PROJECT> --type Story --summary "<summary>" \
  --parent <PROJECT>-<epic> --description "<see template>"
```

### Story/Task description template

```
<What & why — 2-4 bullets. Acceptance criteria as a checklist.>

---
Agent: <instance-alias>          (who works this — matches the agent-<alias> label; stories list it only when one agent works the whole story)
Soul: <soul-name> · Repo: <repo>
Parent: <PROJECT>-<epic-or-story-key> · Epic: <PROJECT>-<epic-key>
```

### Epic description template

```
<Intent — what this epic delivers and why. Walls — what is explicitly out.>

Repos touched: <repo>, <repo>
Human gates: <security/authz/migration/contract items needing sign-off, or "none">

## Agent Roster

| Agent (instance) | Soul / class | Repo | Role on epic | Status | Since |
|---|---|---|---|---|---|
```

### Comment conventions (machine-greppable prefixes)

- `[roster] <alias> joined|retired — …`
- `[<alias>] milestone: …` · `[<alias>] handoff → <alias>: …` ·
  `[<alias>] blocked: …` · `[<alias>] done: branch <name>, <verification>`

## Verify-before-trusting

Jira workflows differ per site. On first real use in a deployment: check the
project's issue types (`Epic/Story/Task/Bug`), whether `--parent` links
stories/tasks to epics, whether a **Task can take a Story as parent** (some
Jira configs only allow that via the Sub-task type — if so, use Sub-tasks
under stories and treat them as tasks), and the exact status names. If
reality differs, note it in a comment on your ticket and tell your
coordinator so your deployment's conventions get recorded.
