---
title: Skills and agents
description: Catalog of bundled skills (and agents) the workflows depend on, grouped by role.
sidebar:
  label: Skills and agents
  order: 4
---

Skills are the portable specialist roles the workflows lean on. Each skill ships as a `SKILL.md` file under `plugins/workflow-kit/skills/<name>/`, with any support scripts alongside. They travel in two ways:

- **npx bundle** (`npx @whit3rabbit/rabbit-flows`) — installs workflows together with the skills listed in each workflow entry in `installer/manifest.json`. Install a workflow and its skill deps arrive with it.
- **Marketplace plugin** (`/plugin install workflow-kit@rabbit-flows`) — installs the entire `plugins/workflow-kit/` plugin (skills and agents) into any Claude Code project, without workflows. Useful when you want the specialist roles available for direct Skill-tool or human use, independent of the workflow orchestration.

Workflow stages cannot auto-load skills at runtime (`agent()` has no `skills` option); a worker's full contract lives inline in its prompt. The bundled skill file is the portable copy for human and Skill-tool use — not the runtime source.

---

## Front-door intake skills

These skills handle conversational intake with the user, then launch the corresponding workflow as a background job. Because workflows cannot ask the user anything mid-run, all questions happen in the skill first.

### new-project

**Description:** Front door for starting a new project from scratch. Runs a short discussion (interface, language, OS, license, publish, API surface, deps) then launches the `scaffold` workflow with the answers. Not for adding to or refactoring an existing codebase.

**Consumed by:** `scaffold` workflow.

**Location:** `plugins/workflow-kit/skills/new-project/SKILL.md`

---

### document

**Description:** Front door for creating documentation, whatever the starting point. Routes by source — an existing codebase, a written brief with no code yet, or an existing docs site to migrate — to the right workflow (`docs-from-code`, `docs-create`, or `docs-migrate`). Use when you are unsure which docs workflow you need.

**Consumed by:** `docs-create`, `docs-from-code`, `docs-migrate` workflows.

**Location:** `plugins/workflow-kit/skills/document/SKILL.md`

---

### document-codebase

**Description:** Front door for documenting an existing codebase into a docs site. Runs a short discussion (output dir, framework, scaffold mode, tutorials, tier) then launches the `docs-from-code` workflow, or drives the same Eatahorse board conversationally when workflows are off or the repo is small.

**Consumed by:** `docs-from-code` workflow.

**Location:** `plugins/workflow-kit/skills/document-codebase/SKILL.md`

---

## Specialist skills

These skills carry domain contracts used by worker stages inside workflows. Workflow stages distill the relevant contract inline; the skill file is the portable human-facing copy.

### architect

**Description:** Specialist role for proposing a software architecture from a brief, blind to other attempts. Produces one independent candidate design (stack, file layout, key irreversible choices) for a later merge gate to judge against siblings. Diversity between attempts is the point; the skill enforces that each attempt commits to a coherent position without converging on a "safe" consensus.

**Consumed by:** `scaffold` workflow (the blind propose stage).

**Location:** `plugins/workflow-kit/skills/architect/SKILL.md`

---

### secure-review

**Description:** Specialist role for defensive security code review. Audits source for vulnerabilities and emits evidence-backed findings (injection, authorization, secrets, path/file handling, deserialization/SSRF, supply chain) without producing exploit code. Pairs with `scripts/recon.py`, which builds a JSON index of symbols, resolved constants, and a caller/callee graph so every lane reads ground truth instead of re-grepping.

**Consumed by:** `security-audit` workflow (audit lane stages).

**Location:** `plugins/workflow-kit/skills/secure-review/SKILL.md`

---

### docs-site-builder

**Description:** Authoring reference for documentation sites. Astro Starlight is the fully implemented framework (v0.40.0 reference files distilled from the official source). Other frameworks (MkDocs, Docusaurus, Fumadocs, VitePress, Docsify, mdBook) have skeleton folders under `frameworks/` and are not yet filled in. The skill's references cover Starlight setup, configuration, information architecture (Diátaxis), frontmatter, content authoring, and built-in components.

**Consumed by:** `docs-create`, `docs-from-code`, `docs-migrate` workflows (inline authoring contract injected into author stages).

**Location:** `plugins/workflow-kit/skills/docs-site-builder/SKILL.md`

---

### docs-scraper

**Description:** Ingest an existing documentation website into a local markdown corpus. Detects the docs platform (Starlight, Docusaurus, MkDocs/Material, VitePress, Fumadocs, GitBook, Sphinx/ReadTheDocs, Docsify, or generic), enumerates pages, fetches and extracts clean markdown, and assembles a navigable corpus. Carries a bundled `scripts/scrape.py` (trafilatura + bs4 fallback; Playwright opt-in for client-rendered sites) so the model never processes raw HTML directly.

**Consumed by:** `docs-scrape`, `docs-migrate` workflows.

**Location:** `plugins/workflow-kit/skills/docs-scraper/SKILL.md`

---

### eatahorse

**Description:** Maintains lightweight one-bite-at-a-time Kanban boards using `.eatahorse` JSON state and markdown task cards. Bundled `scripts/eatahorse.py` provides the full CLI: `init`, `add`, `list`, `show`, `move`, `bite`, `sync`, `report`, `reopen`, and others. Boards are stored under `.eatahorse/tasks/<status>/` with canonical state in `.eatahorse/state.json`. Used by workflows as a durable, resumable ledger for large fan-out jobs that exceed a single agent run.

**Consumed by:** `eatahorse`, `eatahorse-research`, `docs-from-code` workflows.

**Location:** `plugins/workflow-kit/skills/eatahorse/SKILL.md`

---

## Authoring skills

These skills carry process knowledge for writing and reviewing workflow scripts. They are not consumed by a specific workflow but are available to any Claude Code session with the plugin loaded.

### dynamic-workflow-authoring

**Description:** Author, debug, and save Claude Code dynamic workflows — the JS files in `.claude/workflows/*.js` that the Workflow runtime runs to orchestrate subagents via `agent()`, `parallel()`, and `pipeline()`. Covers the minimal spine (decompose → workers → gate → synthesize), the runtime API, model routing, verified gotchas (no `Date.now()`, no filesystem from the script, `meta` must be a pure literal), and a bundled linter (`scripts/validate.py`).

**Consumed by:** Authoring sessions; not a workflow dependency.

**Location:** `.claude/skills/dynamic-workflow-authoring/SKILL.md`

---

### workflow-guardrails

**Description:** Discipline for authoring Claude Code dynamic workflows. Covers when a task actually warrants a workflow, the design spine, the note schema (`{type: finding|failure|constraint, where, evidence}`), the admission gate requirement, model routing defaults, and write-back rules. Generated from `.claude/rules/` by `scripts/build-skill.mjs` — edit the rules, not this file. Travels as a skill because a plugin's `CLAUDE.md` does not load into other projects.

**Consumed by:** Authoring sessions; not a workflow dependency.

**Location:** `plugins/workflow-kit/skills/workflow-guardrails/SKILL.md`
