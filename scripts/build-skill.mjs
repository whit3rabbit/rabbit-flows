#!/usr/bin/env node
// Generate plugins/workflow-kit/skills/workflow-guardrails/SKILL.md from the
// .claude/rules/*.md files. The rules are the single source of truth; the travelling
// skill is a build artifact so the two can never drift.
//
//   node scripts/build-skill.mjs           # write the skill
//   node scripts/build-skill.mjs --check   # exit 1 if the committed skill is stale
//
// This is a repo dev/CI task: it reads .claude/rules/, which is not shipped in the npm
// package. The generated SKILL.md it produces *is* committed and shipped (under plugins/).
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RULES_DIR = path.join(ROOT, '.claude', 'rules')
const SKILL_PATH = path.join(
  ROOT, 'plugins', 'workflow-kit', 'skills', 'workflow-guardrails', 'SKILL.md',
)

// Order = the order sections appear in the generated skill.
const RULES = ['workflow-design.md', 'model-routing.md', 'memory.md']

const FRONTMATTER = `---
name: workflow-guardrails
description: Discipline for authoring Claude Code dynamic workflows. Use when writing or reviewing a .claude/workflows/*.js script, deciding whether a task even needs a workflow, or choosing how many agents and which models to spend. Travels as a skill because a plugin's CLAUDE.md does not load.
---`

const INTRO = `# Workflow guardrails

Default to LESS: a conversation with subagents beats a workflow; a three-agent workflow
beats a thirty-agent one. Add machinery only when a concrete need forces it, and note the
need in the workflow's header comment.

> Generated from \`.claude/rules/\` by \`scripts/build-skill.mjs\`. Edit the rules, not this file.`

// Push every heading down one level so each rule's "# Title" becomes an "## Title"
// section under the skill's single "# Workflow guardrails" heading.
const demote = (md) => md.replace(/^(#{1,5}) /gm, (_, h) => '#'.repeat(h.length + 1) + ' ')

async function generate() {
  const sections = []
  for (const name of RULES) {
    const p = path.join(RULES_DIR, name)
    if (!existsSync(p)) {
      console.error(`missing rule: .claude/rules/${name}`)
      process.exit(1)
    }
    sections.push(demote((await readFile(p, 'utf8')).trim()))
  }
  return [FRONTMATTER, INTRO, ...sections].join('\n\n') + '\n'
}

const want = await generate()

if (process.argv.includes('--check')) {
  const have = existsSync(SKILL_PATH) ? await readFile(SKILL_PATH, 'utf8') : ''
  if (have !== want) {
    console.error('workflow-guardrails SKILL.md is stale. Run: npm run build:skill')
    process.exit(1)
  }
  console.log('ok: workflow-guardrails skill matches .claude/rules/.')
} else {
  await writeFile(SKILL_PATH, want, 'utf8')
  console.log(`wrote ${path.relative(ROOT, SKILL_PATH)} from ${RULES.length} rule files.`)
}
