#!/usr/bin/env node
// Generate the docs-from-code ARG contract surfaces from the single source of truth
// installer/arg-schemas/docs-from-code.mjs:
//   1. the uniform guard block in .claude/workflows/docs-from-code.js
//   2. that workflow's header "Knobs (args)" comment
//   3. document/SKILL.md's Workflow args block + Defaults line
//
//   node scripts/build-arg-contract.mjs           # write the generated blocks
//   node scripts/build-arg-contract.mjs --check    # exit 1 on drift OR arg-name mismatch
//
// --check also LINTS that every schema arg name set-matches the `args?.X` accesses in the workflow's
// guard region (the @generated-start arg-contract/guards marker down to the "end args / guards" sentinel),
// so a hand-added guard the schema doesn't know — or a schema arg with no guard — is caught mechanically.

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW = path.join(ROOT, '.claude', 'workflows', 'docs-from-code.js')
const SKILL = path.join(ROOT, 'plugins', 'workflow-kit', 'skills', 'document', 'SKILL.md')
const { ARGS } = await import(path.join(ROOT, 'installer', 'arg-schemas', 'docs-from-code.mjs'))

// --- literal + guard-expression rendering -------------------------------------------------------
const lit = (v) =>
  v === null || v === undefined ? 'null'
  : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const litArr = (a) => `[${a.map((s) => lit(s)).join(', ')}]`
const varOf = (a) => a.var ?? a.name

function guardExpr(a) {
  const n = a.name
  switch (a.kind) {
    case 'scalar': return `args?.${n} ?? ${lit(a.default)}`
    case 'string': return `typeof args?.${n} === 'string' ? args.${n} : ${lit(a.default)}`
    case 'stringTrim': return `typeof args?.${n} === 'string' && args.${n}.trim() ? args.${n}.trim() : ${lit(a.default)}`
    case 'bool': return `args?.${n} === true`
    case 'enum': return `${litArr(a.choices)}.includes(args?.${n}) ? args.${n} : ${lit(a.default)}`
    case 'intClamped': return `Math.min(args?.${n} ?? ${a.default}, ${a.max})`
    case 'arrayFilter': return `Array.isArray(args?.${n}) ? args.${n}.filter(Boolean) : null`
    default: throw new Error(`unknown guard kind '${a.kind}' for arg '${n}'`)
  }
}

// --- block bodies (arrays of content lines, marker lines preserved by the splice) ----------------
const GROUPS = [['core', 'core'], ['optional', 'optional'], ['update', "update mode (args.mode='update')"]]
const GEN_NOTE = 'GENERATED from installer/arg-schemas/docs-from-code.mjs (build:arg-contract); edit the schema.'

function guardsBody() {
  return ARGS.filter((a) => a.kind !== 'custom').map((a) => {
    const line = `const ${varOf(a)} = ${guardExpr(a)}`
    return a.note ? `${line}   // ${a.note}` : line
  })
}

function docLines(prefix) {
  // prefix is the comment lead for each line (e.g. '// ' or '   // ').
  const out = [`${prefix}Knobs (args) — ${GEN_NOTE}`]
  for (const [key, label] of GROUPS) {
    const group = ARGS.filter((a) => a.group === key)
    if (!group.length) continue
    out.push(`${prefix}${label}:`)
    for (const a of group) out.push(`${prefix}  ${a.name}${a.required ? ' (required)' : ''} — ${a.oneLiner}`)
  }
  return out
}

function defaultsBody() {
  const parts = ARGS.filter((a) => a.showInDefaults).map((a) => {
    const v = a.kind === 'bool' ? 'false'
      : a.intakeDefault !== undefined ? a.intakeDefault
      : a.kind === 'intClamped' ? `${a.default} (max ${a.max})`
      : a.default
    return `${a.name}=${v}`
  })
  return [parts.join(' · ') + '.']
}

const BLOCKS = {
  'arg-contract/guards': { target: WORKFLOW, body: guardsBody() },
  'arg-contract/header': { target: WORKFLOW, body: docLines('// ') },
  'arg-contract/skill-args': { target: SKILL, body: docLines('   // ') },
  'arg-contract/skill-defaults': { target: SKILL, body: defaultsBody() },
}

// Line-based splice: keep the marker lines verbatim (preserving indentation + comment style), swap the
// content between them for `body`. Returns the new source, or null if either marker line is missing.
function spliceBlock(src, key, body) {
  const lines = src.split('\n')
  const start = lines.findIndex((l) => l.includes(`@generated-start ${key}`))
  const end = lines.findIndex((l) => l.includes(`@generated-end ${key}`))
  if (start === -1 || end === -1) return null
  if (end <= start) { console.error(`malformed markers for ${key}: end before start`); process.exit(1) }
  return [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join('\n')
}

// --- name-set lint: schema names vs the workflow guard region's args?.X accesses -----------------
function lintArgNames(workflowSrc) {
  const startIdx = workflowSrc.indexOf('@generated-start arg-contract/guards')
  // Search the sentinel AFTER the start marker: the explanatory comment above the block also contains the
  // phrase "end args / guards", and a from-zero indexOf would match that and look like an inverted region.
  const endIdx = startIdx === -1 ? -1 : workflowSrc.indexOf('--- end args / guards', startIdx)
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return ['guard region markers/sentinel not found in docs-from-code.js']
  }
  const region = workflowSrc.slice(startIdx, endIdx)
  const accessed = new Set()
  for (const m of region.matchAll(/args\??\.([A-Za-z_]\w*)/g)) accessed.add(m[1])
  const schema = new Set(ARGS.map((a) => a.name))
  const errs = []
  for (const n of schema) if (!accessed.has(n)) errs.push(`schema arg '${n}' has no guard/use in the region`)
  for (const n of accessed) if (!schema.has(n)) errs.push(`guard region uses args.${n} but it is not in the schema`)
  return errs
}

// --- run -----------------------------------------------------------------------------------------
const CHECK = process.argv.includes('--check')
let allOk = true

// Group blocks by target file so each file is read/written once.
const byTarget = {}
for (const [key, b] of Object.entries(BLOCKS)) (byTarget[b.target] ??= []).push([key, b.body])

for (const [target, blocks] of Object.entries(byTarget)) {
  if (!existsSync(target)) { console.warn(`skipping missing target: ${path.relative(ROOT, target)}`); continue }
  const src = await readFile(target, 'utf8')
  let updated = src
  for (const [key, body] of blocks) {
    const result = spliceBlock(updated, key, body)
    if (result === null) { console.error(`markers for ${key} not found in ${path.relative(ROOT, target)}`); process.exit(1) }
    updated = result
  }
  if (updated === src) {
    console.log(`ok: ${path.relative(ROOT, target)} (arg contract up-to-date)`)
  } else if (CHECK) {
    console.error(`stale arg contract in ${path.relative(ROOT, target)}. Run: npm run build:arg-contract`)
    allOk = false
  } else {
    await writeFile(target, updated, 'utf8')
    console.log(`updated ${path.relative(ROOT, target)}`)
  }
}

// Lint always runs (build + check): it is cheap and catches drift the splice can't see.
const lintErrs = lintArgNames(await readFile(WORKFLOW, 'utf8'))
if (lintErrs.length) {
  console.error('arg-name drift between schema and docs-from-code.js guard region:')
  for (const e of lintErrs) console.error(`  - ${e}`)
  allOk = false
}

if (!allOk) process.exit(1)
if (CHECK) console.log('ok: arg contract is up-to-date and arg names match.')
