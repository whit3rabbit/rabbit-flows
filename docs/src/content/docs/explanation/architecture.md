---
title: How rabbit-flows is organized
description: Why the repo has two homes and two distribution paths, how inline contracts replace auto-loaded skills, and why durable knowledge is written back to CLAUDE.md.
sidebar:
  label: How rabbit-flows is organized
  order: 1
---

rabbit-flows is both a working project and a distributable marketplace. That double role explains nearly every structural decision in the repo. The layout you see is not arbitrary: it is the minimum structure needed to serve two audiences (contributors who clone the repo and users who install via `npx` or the marketplace plugin) without duplicating logic or losing consistency.

## Two homes, two distribution paths

The repo distinguishes between two kinds of artifacts and ships each by a different path.

**Workflows, CLAUDE.md, and rules ship by clone.** Workflow scripts live in `.claude/workflows/`. CLAUDE.md and `.claude/rules/` load automatically as project context whenever you open the repo. These files reach contributors and local users through ordinary `git clone`; no packaging step is needed. The tradeoff is that they are not portable: a workflow script in `.claude/workflows/` does nothing for a user who has not cloned the repo.

**Skills and agents ship by plugin and marketplace.** The `plugins/workflow-kit/` directory is an installable Claude Code plugin. Users who run `/plugin marketplace add whit3rabbit/rabbit-flows` or the `npx` installer receive the skills and agents without cloning anything. This path serves any project, not just clones of rabbit-flows.

The split matters because a plugin's `CLAUDE.md` does not load in the target project. Rules authored in `.claude/rules/` are invisible to a marketplace user. The solution is the `workflow-guardrails` skill: `scripts/build-skill.mjs` generates it by concatenating the three rule files, so the rules travel as a skill rather than as a CLAUDE.md. The guardrails are never hand-edited; the rules are the single source of truth. `npm run check` enforces this: if the committed skill drifts from the rules, CI fails. See the [build-scripts reference](/reference/build-scripts) for the mechanics.

The installer manifest at `installer/manifest.json` is the catalog that maps each workflow to its skill and agent dependencies. The `npx` CLI reads this to know what to copy. `npm run check` also verifies that each workflow's `// requires-skills:` header matches the manifest entry exactly; a missing entry means the installer would silently omit a dependency.

## Inline contracts, not auto-loaded skills

Workflow scripts run in a VM sandbox. `agent()` has no `skills` option, and `agentType` resolves only agents already registered in the session (built-ins plus plugin-namespaced agents). A skill or agent file copied during the same session does not resolve until the session reloads. This is not a gap to be worked around; it is the binding behavior of the platform (verified empirically in `docs/WORKFLOW_ANALYSIS.md`).

The consequence for authorship is that a worker's full contract must be inline in its prompt. When a workflow's fan-out stage needs the Starlight authoring rules, the author reads those rules once and embeds them as a JavaScript `const` in the workflow file. At runtime, the constant is injected into every worker prompt with no `Read` or `Skill` call. This is cheaper, deterministic, and immune to session-registration timing.

The bundled skills (listed in `installer/manifest.json` under `skills`) are the portable human and Skill-tool copy of the same contract, not the runtime source. They exist so the same guidance is available when a person invokes a skill interactively or when a front-door skill runs `AskUserQuestion` before calling `Workflow()`. The inline `const` and the bundled skill describe the same contract; when the skill changes, the inline `const` must be refreshed. Do not keep them in two live copies.

For docs workflows, the inline contracts are themselves generated. `scripts/build-docs-contracts.mjs` reads the reference files under `plugins/workflow-kit/skills/docs-site-builder/` and splices them into `docs-create.js` and `docs-from-code.js` between `@generated-start` and `@generated-end` markers. Hand-editing between those markers is overwritten on the next build. `npm run check` includes a third gate that fails if the committed contract blocks are stale relative to their sources.

## The workflow spine

Every workflow in this repo follows the same four-stage structure unless the header comment explains why not: decompose, parallel workers, admission gate, synthesize.

Decompose runs on a strong model because this is the one stage where an error propagates to every subsequent stage. Workers run in parallel on the cheapest model that can handle their task; they return compact structured notes, not raw transcripts. The admission gate runs a fresh-context verifier on the strong model to drop unsupported notes before they reach synthesis. Synthesis then operates only on admitted, evidence-backed notes.

The spine exists because the real gains from multi-agent orchestration are repeatability, clean context, and the verification gate, not accuracy improvements from scale. A weak or same-context verifier rubber-stamps. Spending strong-model tokens only on decompose, the gate, and synthesis keeps costs proportional to value. See `.claude/rules/model-routing.md` for the routing table and the reasoning behind each stage's model choice.

## Durable knowledge and write-back

Workflow script variables evaporate when a run ends. The only memory that persists across sessions is what gets written to `CLAUDE.md` or `.claude/rules/`. A finalize stage, run by an agent (since the script itself cannot touch the filesystem), writes back any durable knowledge the run produced: hard constraints, rejected alternatives, and the why behind decisions.

This requirement is not optional. A workflow that discovers something worth keeping and does not write it back has done work that will be repeated next session. The rules for what belongs in CLAUDE.md versus `.claude/rules/` are in `.claude/rules/memory.md`: CLAUDE.md holds commands and hard constraints; rules hold detailed guidance; anything discoverable in one session does not belong in either.

## Tradeoffs and rejected alternatives

**Why no auto-loading of skills at runtime.** The platform does not support it, and adding a runtime skill-loading mechanism would require changes outside this repo. The inline `const` pattern is the reliable path: one read at author time, zero per-item lookups at run time.

**Why the guardrails skill is generated, not hand-edited.** A plugin's CLAUDE.md does not load in the target project. The only way to ship authoring rules to marketplace users is as a skill. Generating the skill from the rules ensures a single source of truth; a hand-edited copy would drift on the next build and fail CI.

**Why workflows are not plugin components.** Workflow scripts need to be available as project context in `.claude/workflows/`, which loads for cloned repos. A plugin installs into a different project and cannot place files in that project's `.claude/workflows/`. The two paths serve different audiences and cannot be collapsed without losing one of them.

**Why the spine is four stages, not two or six.** Fewer stages lose the verification gate, which is the primary defense against unsupported findings reaching synthesis. More stages add coordination overhead that does not pay off on a strong model. The four-stage shape is the minimum that includes a gate.
