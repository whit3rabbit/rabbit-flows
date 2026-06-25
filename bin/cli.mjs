#!/usr/bin/env node
// Installer/uninstaller: pick workflows from a menu, copy each one plus the skills/agents
// it depends on into the user's .claude/ (user or project scope). Every install writes a
// receipt so uninstall removes ONLY what we placed and restores any user file we displaced.
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileP = promisify(execFile)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = path.join(ROOT, 'plugins', 'workflow-kit', 'skills')
const AGENTS_DIR = path.join(ROOT, 'plugins', 'workflow-kit', 'agents')

const RECEIPT = '.rabbit-flows-receipt.json' // per-scope install ledger, lives in scopeRoot
const BACKUP_ROOT = '.rabbit-flows-backups' // displaced user files land here, restored on uninstall

// --- args ---------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)
const parseList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean)
const NO_TTY =
  'no TTY: pass --workflow <name> or --all (optionally --scope user|project, or --silo <id> for a ccsilo silo).'

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
    // Anchor to the meta block: a header comment containing `name:`/`filename:` must not shadow meta.name.
    const after = src.slice(src.indexOf('export const meta'))
    const metaName = after.match(/name:\s*['"]([^'"]+)['"]/)?.[1]
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
export async function copyInto(src, dest, force) {
  if (existsSync(dest) && !force) return 'skipped'
  // --force is the only update path; remove first so upstream-deleted files don't linger.
  if (force && existsSync(dest)) await rm(dest, { recursive: true, force: true })
  await mkdir(path.dirname(dest), { recursive: true })
  await cp(src, dest, { recursive: true })
  return existsSync(dest) ? 'copied' : 'skipped'
}

// --- receipt ------------------------------------------------------------
// { version, workflows: [name...], files: { "<posix-rel>": { type, name, backup:<rel|null> } } }
// Keys are POSIX-relative and the entry carries its own type/name so uninstall never re-parses paths.
export async function readReceipt(scopeRoot) {
  const p = path.join(scopeRoot, RECEIPT)
  if (!existsSync(p)) return { version: 1, workflows: [], files: {} }
  try {
    const r = JSON.parse(await readFile(p, 'utf8'))
    return { version: 1, workflows: r.workflows ?? [], files: r.files ?? {} }
  } catch {
    return { version: 1, workflows: [], files: {} }
  }
}

async function writeReceipt(scopeRoot, data) {
  await mkdir(scopeRoot, { recursive: true })
  await writeFile(path.join(scopeRoot, RECEIPT), JSON.stringify(data, null, 2) + '\n')
}

const isEmptyReceipt = (r) => !r.workflows.length && !Object.keys(r.files).length

// YYYYMMDD-HHMMSS local stamp for the per-run backup dir (plain Node, not the workflow VM).
function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// Union of skill/agent deps across a set of workflows.
export function depsOf(workflows) {
  const skills = new Set()
  const agents = new Set()
  for (const w of workflows) {
    for (const s of w.skills ?? []) skills.add(s)
    for (const a of w.agents ?? []) agents.add(a)
  }
  return { skills, agents }
}

// Receipt keys are POSIX-relative so they round-trip on Windows (path.relative emits OS separators).
const REL = (scopeRoot, p) => path.relative(scopeRoot, p).split(path.sep).join('/')
const resolveScope = (scope) =>
  scope === 'project' ? path.join(process.cwd(), '.claude') : path.join(homedir(), '.claude')

// --- ccsilo target ------------------------------------------------------
// A "silo" is one of ccsilo's managed Claude Code variants. Its paths.configDir is an absolute
// dir that IS that silo's CLAUDE_CONFIG_DIR (the .claude equivalent), so it works as a scopeRoot.

// Pure: parse `ccsilo variant list --json` stdout into {id,name,provider,configDir}[].
// Drops entries lacking a configDir; returns [] on parse error (callers treat that as "no silos").
export function parseSilos(stdout) {
  let arr
  try {
    arr = JSON.parse(stdout)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  return arr
    .map((v) => ({
      id: v?.id,
      name: v?.name ?? v?.id,
      provider: v?.provider?.label ?? v?.provider?.key,
      configDir: v?.paths?.configDir,
    }))
    .filter((s) => s.id && s.configDir)
}

export function resolveSilo(silos, id) {
  return silos.find((s) => s.id === id)
}

// Enumerate silos by shelling out to ccsilo. Returns [] when ccsilo isn't on PATH (ENOENT),
// exits non-zero, or reports no silos. ponytail: shell-out is the authoritative source; add a
// filesystem workspace scan only if a PATH-less ccsilo install becomes a real need.
async function ccsiloSilos() {
  try {
    const { stdout } = await execFileP('ccsilo', ['variant', 'list', '--json'])
    return parseSilos(stdout)
  } catch {
    return []
  }
}

// --- install ------------------------------------------------------------
export async function install(chosen, scopeRoot, force) {
  const receipt = await readReceipt(scopeRoot)
  const backupDir = path.posix.join(BACKUP_ROOT, stamp())
  const done = []
  const seen = new Set() // dedupe skills/agents copied across the chosen workflows this run

  // Place one src->dest, backing up a displaced FOREIGN file and recording our own in the receipt.
  // type/name let uninstall classify the entry without re-parsing the path. Returns true if it's ours now.
  const place = async (src, dest, dedupe, type, name) => {
    const relPath = REL(scopeRoot, dest)
    if (dedupe) {
      if (seen.has(relPath)) return relPath in receipt.files
      seen.add(relPath)
    }
    const isOurs = relPath in receipt.files
    let backup = isOurs ? receipt.files[relPath].backup : null
    // Only a --force overwrite of a file that isn't already ours can destroy user data: back it up.
    if (force && existsSync(dest) && !isOurs) {
      const bdest = path.join(scopeRoot, backupDir, relPath)
      await mkdir(path.dirname(bdest), { recursive: true })
      await cp(dest, bdest, { recursive: true })
      backup = path.posix.join(backupDir, relPath)
    }
    const status = await copyInto(src, dest, force)
    // Record only files we actually own now: freshly copied, or a prior install of ours.
    const owned = status === 'copied' || isOurs
    if (owned) receipt.files[relPath] = { type, name, backup }
    done.push([status, relPath])
    return owned
  }

  for (const w of chosen) {
    let owned = await place(path.join(ROOT, w.file), path.join(scopeRoot, 'workflows', path.basename(w.file)), false, 'workflow', w.name)
    for (const s of w.skills ?? []) owned = (await place(path.join(SKILLS_DIR, s), path.join(scopeRoot, 'skills', s), true, 'skill', s)) || owned
    for (const a of w.agents ?? []) owned = (await place(path.join(AGENTS_DIR, `${a}.md`), path.join(scopeRoot, 'agents', `${a}.md`), true, 'agent', a)) || owned
    // Claim the workflow if we own ANY of its files (the .js, or a freshly-copied dep). A foreign .js
    // collision still leaves the .js the user's, but its installed skills stay selectively removable.
    if (owned && !receipt.workflows.includes(w.name)) receipt.workflows.push(w.name)
  }

  await writeReceipt(scopeRoot, receipt)
  return done
}

// --- uninstall ----------------------------------------------------------
// Remove only paths the receipt says we placed; restore any backed-up foreign file.
// Selective removal prunes a shared skill/agent only once no remaining workflow needs it.
export async function uninstall(chosenNames, scopeRoot, manifest, all) {
  const receipt = await readReceipt(scopeRoot)
  if (isEmptyReceipt(receipt)) return { empty: true, done: [] }

  let toRemove
  let remainingWorkflows
  if (all) {
    toRemove = new Set(Object.keys(receipt.files))
    remainingWorkflows = []
  } else {
    const removeNames = new Set(chosenNames)
    remainingWorkflows = receipt.workflows.filter((n) => !removeNames.has(n))
    const keep = depsOf(manifest.filter((w) => remainingWorkflows.includes(w.name)))
    // Classify from the receipt entry, never by parsing the path: drop a workflow file we own for a
    // removed name, and an owned skill/agent once no remaining workflow's deps still need it.
    toRemove = new Set()
    for (const [rel, e] of Object.entries(receipt.files)) {
      if (e.type === 'workflow') {
        if (removeNames.has(e.name)) toRemove.add(rel)
      } else if (e.type === 'skill') {
        if (!keep.skills.has(e.name)) toRemove.add(rel)
      } else if (e.type === 'agent') {
        if (!keep.agents.has(e.name)) toRemove.add(rel)
      }
    }
  }

  const done = []
  for (const rel of toRemove) {
    const dest = path.join(scopeRoot, rel)
    const backup = receipt.files[rel]?.backup
    if (existsSync(dest)) await rm(dest, { recursive: true, force: true })
    const bsrc = backup ? path.join(scopeRoot, backup) : null
    if (bsrc && existsSync(bsrc)) {
      await cp(bsrc, dest, { recursive: true }) // restore the user's displaced file
      await rm(bsrc, { recursive: true, force: true })
      done.push(['restored', rel])
    } else {
      done.push(['removed', rel])
    }
    delete receipt.files[rel]
  }
  receipt.workflows = remainingWorkflows

  if (isEmptyReceipt(receipt)) {
    await rm(path.join(scopeRoot, RECEIPT), { force: true })
    await rm(path.join(scopeRoot, BACKUP_ROOT), { recursive: true, force: true }) // nothing of ours left
  } else {
    await writeReceipt(scopeRoot, receipt)
  }
  return { empty: false, done }
}

// --- main ---------------------------------------------------------------
async function main() {
  const workflows = await loadManifest()

  if (has('check')) return check(workflows)
  if (has('list')) return list(workflows)

  const verb = ['install', 'uninstall'].includes(argv[0]) ? argv[0] : null
  const scope = flag('scope')
  const silo = flag('silo') // ccsilo silo id; takes precedence over --scope when set
  const force = has('force')
  const all = has('all')

  if (all && flag('workflow')) {
    console.error('--all and --workflow are mutually exclusive.')
    process.exit(1)
  }

  // No verb, no --workflow, but a TTY: ask install-or-uninstall.
  let action = verb
  if (!action && !flag('workflow') && process.stdin.isTTY) {
    const p = await import('@clack/prompts')
    action = await p.select({
      message: 'rabbit-flows:',
      options: [
        { value: 'install', label: 'Install', hint: 'add workflows to .claude' },
        { value: 'uninstall', label: 'Uninstall', hint: 'remove what rabbit-flows installed' },
      ],
    })
    if (p.isCancel(action)) return p.cancel('cancelled')
  }
  action = action ?? 'install'

  if (action === 'uninstall') return runUninstall(workflows, scope, silo, all)
  return runInstall(workflows, scope, silo, force, all)
}

// Resolve the install/uninstall destination as { scopeRoot, label, removeArgs }.
// --silo wins over --scope. With a clack module `p` and a TTY (and no flag), it prompts for the
// target and, if ccsilo is chosen, the silo. Returns null only when the user cancels a prompt.
async function resolveTarget(scopeArg, siloArg, p) {
  if (siloArg) {
    const silos = await ccsiloSilos()
    if (!silos.length) {
      console.error('no ccsilo silos found (is ccsilo installed and on PATH?).')
      process.exit(1)
    }
    const s = resolveSilo(silos, siloArg)
    if (!s) {
      console.error(`unknown silo: ${siloArg} (known: ${silos.map((x) => x.id).join(', ')})`)
      process.exit(1)
    }
    return { scopeRoot: s.configDir, label: `ccsilo:${s.id}`, removeArgs: `--silo ${s.id}` }
  }
  if (scopeArg) {
    return { scopeRoot: resolveScope(scopeArg), label: scopeArg, removeArgs: `--scope ${scopeArg}` }
  }
  if (!p || !process.stdin.isTTY) {
    return { scopeRoot: resolveScope('user'), label: 'user', removeArgs: '--scope user' }
  }
  const silos = await ccsiloSilos()
  const opts = [
    { value: 'user', label: 'Claude Code (user)', hint: '~/.claude (all your projects)' },
    { value: 'project', label: 'Claude Code (project)', hint: './.claude (this repo only)' },
  ]
  if (silos.length) opts.push({ value: 'ccsilo', label: 'ccsilo silo', hint: `${silos.length} detected` })
  const target = await p.select({ message: 'Target:', options: opts })
  if (p.isCancel(target)) return null
  if (target !== 'ccsilo') {
    return { scopeRoot: resolveScope(target), label: target, removeArgs: `--scope ${target}` }
  }
  const id = await p.select({
    message: 'Pick a silo:',
    options: silos.map((s) => ({
      value: s.id,
      label: s.name,
      hint: [s.provider, s.configDir].filter(Boolean).join(' · '),
    })),
  })
  if (p.isCancel(id)) return null
  const s = resolveSilo(silos, id)
  return { scopeRoot: s.configDir, label: `ccsilo:${s.id}`, removeArgs: `--silo ${s.id}` }
}

async function runInstall(workflows, scopeArg, siloArg, force, all) {
  let chosen
  let target
  const wfArg = flag('workflow')

  if (all) {
    chosen = workflows
  } else if (wfArg) {
    const names = parseList(wfArg)
    chosen = workflows.filter((w) => names.includes(w.name))
    const unknown = names.filter((n) => !workflows.some((w) => w.name === n))
    if (unknown.length) {
      console.error(`unknown workflow(s): ${unknown.join(', ')}`)
      process.exit(1)
    }
  }

  if (chosen) {
    // Flag path: no prompts; resolve the target from flags (default: user scope).
    target = await resolveTarget(scopeArg, siloArg)
  } else {
    if (!process.stdin.isTTY) {
      console.error(NO_TTY)
      process.exit(1)
    }
    const p = await import('@clack/prompts')
    p.intro('rabbit-flows · install')
    target = await resolveTarget(scopeArg, siloArg, p) // target first, then a silo if chosen
    if (!target) return p.cancel('cancelled')
    const picked = await p.multiselect({
      message: 'Pick workflows to install (their skills/agents come along):',
      options: workflows.map((w) => ({ value: w.name, label: w.name, hint: w.description })),
      required: true,
    })
    if (p.isCancel(picked)) return p.cancel('cancelled')
    chosen = workflows.filter((w) => picked.includes(w.name))
    p.outro('installing...')
  }

  const { scopeRoot, label, removeArgs } = target

  const results = await install(chosen, scopeRoot, force)
  console.log(`\nInstalled to ${scopeRoot} (${label}):`)
  for (const [status, where] of results) {
    console.log(`  ${status === 'copied' ? '+' : '.'} ${status}  ${where}`)
  }
  const skipped = results.filter(([s]) => s === 'skipped').length
  if (skipped) console.log(`\n${skipped} skipped (already present). Re-run with --force to overwrite (a backup is kept).`)

  console.log(
    `\nNext: enable "Dynamic workflows" in /config (off by default on Pro),\n` +
      `then run a workflow by name, e.g. /${chosen[0].name}.\n` +
      `Installed: ${chosen.map((w) => w.name).join(', ')}\n` +
      `Remove later: rabbit-flows uninstall ${removeArgs} (--all for everything).`,
  )
}

async function runUninstall(workflows, scopeArg, siloArg, all) {
  const wfArg = flag('workflow')
  const interactive = !all && !wfArg
  let p
  if (interactive) {
    if (!process.stdin.isTTY) {
      console.error(NO_TTY)
      process.exit(1)
    }
    p = await import('@clack/prompts')
    p.intro('rabbit-flows · uninstall')
  }

  const target = await resolveTarget(scopeArg, siloArg, p) // target first, then a silo if chosen
  if (!target) return p.cancel('cancelled')
  const { scopeRoot, label } = target

  const receipt = await readReceipt(scopeRoot)
  if (isEmptyReceipt(receipt)) {
    console.log(`Nothing installed by rabbit-flows in ${scopeRoot} (${label}).`)
    return
  }

  let chosenNames
  if (all) {
    chosenNames = receipt.workflows.slice()
  } else if (wfArg) {
    chosenNames = parseList(wfArg)
    const unknown = chosenNames.filter((n) => !receipt.workflows.includes(n))
    if (unknown.length) {
      console.error(`not installed in ${label}: ${unknown.join(', ')}`)
      process.exit(1)
    }
  } else {
    const picked = await p.multiselect({
      message: 'Pick workflows to uninstall (shared skills are kept if still needed):',
      options: receipt.workflows.map((n) => ({ value: n, label: n })),
      required: true,
    })
    if (p.isCancel(picked)) return p.cancel('cancelled')
    chosenNames = picked
    p.outro('uninstalling...')
  }

  const res = await uninstall(chosenNames, scopeRoot, workflows, all)
  console.log(`\nUninstalled from ${scopeRoot} (${label}):`)
  for (const [status, where] of res.done) {
    console.log(`  ${status === 'restored' ? '~' : '-'} ${status}  ${where}`)
  }
  if (!res.done.length) console.log('  (nothing to remove for that selection)')
}

// Only run when invoked as a script, not when imported (e.g. by tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e?.message ?? e)
    process.exit(1)
  })
}
