#!/usr/bin/env node
// Generate the inline FRAMEWORKS contract consts in the docs-create.js and docs-from-code.js
// workflows from the docs-site-builder skill reference files.
//
// The references are the single source of truth. The inline const blocks are build artifacts
// so the two workflow files can never drift from the references (the same discipline
// build:skill enforces for the guardrails skill).
//
//   node scripts/build-docs-contracts.mjs           # write the contracts
//   node scripts/build-docs-contracts.mjs --check   # exit 1 if any contract is stale
//
// Markers: the script finds/replaces blocks delimited by:
//   // @generated-start docs-contracts/<block-name>
//   // @generated-end docs-contracts/<block-name>
// Both markers must be present in the target file for the block to be updated.
//
// This is a repo dev/CI task: it reads plugins/workflow-kit/skills/docs-site-builder/references/,
// which IS shipped in the npm package (but the build artifacts it produces — the inline const blocks
// in .claude/workflows/ — are not; they are committed and read only by the local session).

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REFS_DIR = path.join(ROOT, 'plugins', 'workflow-kit', 'skills', 'docs-site-builder', 'references')
const WORKFLOWS_DIR = path.join(ROOT, '.claude', 'workflows')

// Reference files that compose each contract block.
// Order matters: files are concatenated in the order listed.
const BLOCKS = {
  'starlight-contract': {
    // Full Starlight authoring reference: setup, config, frontmatter, content, components.
    refs: ['setup.md', 'configuration.md', 'frontmatter.md', 'content-authoring.md', 'components.md'],
    constName: 'CONTRACT',
    header: 'STARLIGHT AUTHORING CONTRACT (distilled from docs-site-builder/references; do not re-derive syntax from memory).',
  },
  'ia-contract': {
    // Framework-agnostic information-architecture reference.
    refs: ['information-architecture.md'],
    constName: 'IA_CONTRACT',
    header: 'DOCS INFORMATION-ARCHITECTURE CONTRACT (distilled from docs-site-builder/references; design before syntax).',
  },
}

// Workflow files that embed the generated contract blocks.
// Each entry maps block names to which files embed them.
const TARGETS = [
  path.join(WORKFLOWS_DIR, 'docs-create.js'),
  path.join(WORKFLOWS_DIR, 'docs-from-code.js'),
]

// Build the contract text for one block by concatenating its reference files.
// The result is the literal string value assigned to the const (no surrounding backticks).
async function buildBlock(blockKey) {
  const { refs, header } = BLOCKS[blockKey]
  const parts = [header]
  for (const ref of refs) {
    const p = path.join(REFS_DIR, ref)
    if (!existsSync(p)) {
      console.error(`missing reference file: ${path.relative(ROOT, p)}`)
      process.exit(1)
    }
    const content = (await readFile(p, 'utf8')).trim()
    parts.push(`\n---\n\n${content}`)
  }
  return parts.join('\n')
}

// Build the full replacement text for a marker block (start marker + const assignment + end marker).
function wrapBlock(blockKey, contractText) {
  const { constName } = BLOCKS[blockKey]
  // Escape backticks and ${} in the contract text so they survive the JS template literal.
  const escaped = contractText.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
  return (
    `// @generated-start docs-contracts/${blockKey}\n` +
    `const ${constName} = \`${escaped}\`\n` +
    `// @generated-end docs-contracts/${blockKey}`
  )
}

// Replace a single marker block in a file's content string. Returns the updated string.
// Throws if the markers are not found.
function replaceBlock(src, blockKey, replacement) {
  const startMarker = `// @generated-start docs-contracts/${blockKey}`
  const endMarker = `// @generated-end docs-contracts/${blockKey}`
  const startIdx = src.indexOf(startMarker)
  const endIdx = src.indexOf(endMarker)
  if (startIdx === -1 || endIdx === -1) {
    return null // markers absent — skip this block in this file
  }
  if (endIdx <= startIdx) {
    console.error(`malformed markers for ${blockKey}: end marker appears before start`)
    process.exit(1)
  }
  return src.slice(0, startIdx) + replacement + src.slice(endIdx + endMarker.length)
}

// Pre-build all block texts.
const generated = {}
for (const key of Object.keys(BLOCKS)) {
  generated[key] = wrapBlock(key, await buildBlock(key))
}

const CHECK = process.argv.includes('--check')
let allOk = true

for (const target of TARGETS) {
  if (!existsSync(target)) {
    console.warn(`skipping missing target: ${path.relative(ROOT, target)}`)
    continue
  }

  let src = await readFile(target, 'utf8')
  let updated = src

  for (const key of Object.keys(BLOCKS)) {
    const result = replaceBlock(updated, key, generated[key])
    if (result === null) {
      // Block markers not present in this file — skip silently.
      continue
    }
    updated = result
  }

  if (updated === src) {
    console.log(`ok: ${path.relative(ROOT, target)} (no markers found or already up-to-date)`)
    continue
  }

  if (CHECK) {
    console.error(`stale contracts in ${path.relative(ROOT, target)}. Run: npm run build:docs-contracts`)
    allOk = false
  } else {
    await writeFile(target, updated, 'utf8')
    console.log(`updated ${path.relative(ROOT, target)}`)
  }
}

if (CHECK && !allOk) process.exit(1)
if (CHECK && allOk) console.log('ok: all docs contracts are up-to-date.')
