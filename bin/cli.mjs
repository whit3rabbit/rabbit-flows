#!/usr/bin/env node
// Installer/bundler: pick workflows from a menu, copy each one plus the skills/agents
// it depends on into the user's .claude/ (project or user scope).
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = path.join(ROOT, 'plugins', 'workflow-kit', 'skills')
const AGENTS_DIR = path.join(ROOT, 'plugins', 'workflow-kit', 'agents')

// --- args ---------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

async function loadManifest() {
  const raw = await readFile(path.join(ROOT, 'installer', 'manifest.json'), 'utf8')
  return JSON.parse(raw).workflows
}

const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

// Parse a "// requires-skills: a, b" or "// requires-agents: x" header comment.
// Returns null when the comment is absent (nothing to assert).
function parseRequires(src, key) {
  const m = src.match(new RegExp(`//\\s*requires-${key}:\\s*(.*)`, 'i'))
  if (!m) return null
  return m[1].split(',').map((s) => s.trim()).filter(Boolean)
}

// --check: assert every referenced file exists AND that each workflow's header comment
// agrees with the manifest. Exit non-zero on drift (CI guard).
async function check(workflows) {
  const missing = []
  const drift = []
  for (const w of workflows) {
    const wfPath = path.join(ROOT, w.file)
    if (!existsSync(wfPath)) {
      missing.push(w.file)
      continue
    }
    for (const s of w.skills ?? []) {
      if (!existsSync(path.join(SKILLS_DIR, s, 'SKILL.md'))) missing.push(`skill:${s}`)
    }
    for (const a of w.agents ?? []) {
      if (!existsSync(path.join(AGENTS_DIR, `${a}.md`))) missing.push(`agent:${a}`)
    }
    const src = await readFile(wfPath, 'utf8')
    for (const [key, manifestList] of [['skills', w.skills ?? []], ['agents', w.agents ?? []]]) {
      const declared = parseRequires(src, key)
      if (declared && !sameSet(declared, manifestList)) {
        drift.push(
          `${w.name}: // requires-${key} [${declared.join(', ')}] != manifest [${manifestList.join(', ')}]`,
        )
      }
    }
    // meta is required to be the first thing in every script, so the first name: is meta.name.
    const metaName = src.match(/name:\s*['"]([^'"]+)['"]/)?.[1]
    if (metaName && metaName !== w.name) {
      drift.push(`${w.name}: meta.name "${metaName}" != manifest name "${w.name}"`)
    }
  }
  if (missing.length || drift.length) {
    if (missing.length) console.error('manifest drift, missing:\n  ' + missing.join('\n  '))
    if (drift.length) console.error('header/manifest drift:\n  ' + drift.join('\n  '))
    process.exit(1)
  }
  console.log(`ok: ${workflows.length} workflow(s), all referenced files present and headers match.`)
}

function list(workflows) {
  for (const w of workflows) {
    const deps = [...(w.skills ?? []), ...(w.agents ?? [])]
    console.log(`${w.name}  -  ${w.description}`)
    if (deps.length) console.log(`    bundles: ${deps.join(', ')}`)
  }
}

// Copy src->dest unless dest exists (skip, unless force). Returns 'copied'|'skipped'.
async function copyInto(src, dest, force) {
  if (existsSync(dest) && !force) return 'skipped'
  // --force is the only update path; remove first so upstream-deleted files don't linger.
  if (force && existsSync(dest)) await rm(dest, { recursive: true, force: true })
  await mkdir(path.dirname(dest), { recursive: true })
  await cp(src, dest, { recursive: true })
  return existsSync(dest) ? 'copied' : 'skipped'
}

async function install(chosen, scopeRoot, force) {
  const done = []
  const installedSkills = new Set() // dedupe skills shared across workflows
  const installedAgents = new Set()
  for (const w of chosen) {
    const wfDest = path.join(scopeRoot, 'workflows', path.basename(w.file))
    done.push([await copyInto(path.join(ROOT, w.file), wfDest, force), rel(scopeRoot, wfDest)])
    for (const s of w.skills ?? []) {
      if (installedSkills.has(s)) continue
      installedSkills.add(s)
      const dest = path.join(scopeRoot, 'skills', s)
      done.push([await copyInto(path.join(SKILLS_DIR, s), dest, force), rel(scopeRoot, dest)])
    }
    for (const a of w.agents ?? []) {
      if (installedAgents.has(a)) continue
      installedAgents.add(a)
      const dest = path.join(scopeRoot, 'agents', `${a}.md`)
      done.push([await copyInto(path.join(AGENTS_DIR, `${a}.md`), dest, force), rel(scopeRoot, dest)])
    }
  }
  return done
}

const rel = (root, p) => path.relative(path.dirname(root), p)

// --- main ---------------------------------------------------------------
async function main() {
  const workflows = await loadManifest()

  if (has('check')) return check(workflows)
  if (has('list')) return list(workflows)

  // Non-interactive path: --workflow a,b [--scope project|user] [--force]
  let chosen
  let scope = flag('scope')
  const force = has('force')

  const wfArg = flag('workflow')
  if (wfArg) {
    const names = wfArg.split(',').map((s) => s.trim())
    chosen = workflows.filter((w) => names.includes(w.name))
    const unknown = names.filter((n) => !workflows.some((w) => w.name === n))
    if (unknown.length) {
      console.error(`unknown workflow(s): ${unknown.join(', ')}`)
      process.exit(1)
    }
  }

  // Interactive menu only when the workflow choice is unresolved AND we have a TTY.
  // scope has a sane default below, so a non-TTY --workflow run never needs the menu.
  if (!chosen) {
    if (!process.stdin.isTTY) {
      console.error('no TTY: pass --workflow <name> (optionally --scope project|user).')
      process.exit(1)
    }
    const p = await import('@clack/prompts')
    p.intro('rabbit-flows')

    const picked = await p.multiselect({
      message: 'Pick workflows to install (their skills/agents come along):',
      options: workflows.map((w) => ({ value: w.name, label: w.name, hint: w.description })),
      required: true,
    })
    if (p.isCancel(picked)) return p.cancel('cancelled')
    chosen = workflows.filter((w) => picked.includes(w.name))

    if (!scope) {
      scope = await p.select({
        message: 'Install scope:',
        options: [
          { value: 'project', label: 'project', hint: './.claude (this repo only)' },
          { value: 'user', label: 'user', hint: '~/.claude (all your projects)' },
        ],
      })
      if (p.isCancel(scope)) return p.cancel('cancelled')
    }
    p.outro('installing...')
  }

  scope = scope ?? 'project'
  const scopeRoot =
    scope === 'user' ? path.join(homedir(), '.claude') : path.join(process.cwd(), '.claude')

  const results = await install(chosen, scopeRoot, force)
  console.log(`\nInstalled to ${scopeRoot} (${scope} scope):`)
  for (const [status, where] of results) {
    console.log(`  ${status === 'copied' ? '+' : '.'} ${status}  ${where}`)
  }
  const skipped = results.filter(([s]) => s === 'skipped').length
  if (skipped) console.log(`\n${skipped} skipped (already present). Re-run with --force to overwrite.`)

  console.log(
    `\nNext: enable "Dynamic workflows" in /config (off by default on Pro),\n` +
      `then run a workflow by name, e.g. /${chosen[0].name}.\n` +
      `Installed: ${chosen.map((w) => w.name).join(', ')}`,
  )
}

main().catch((e) => {
  console.error(e?.message ?? e)
  process.exit(1)
})
