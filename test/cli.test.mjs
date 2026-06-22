// Behavioral tests for the installer's one destructive op: copyInto with force.
// node:test + node:assert, no framework. Run via `npm test` (node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyInto } from '../bin/cli.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('copyInto: copy / skip / force-overwrite / force-prune', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'rabbit-flows-test-'))
  try {
    const src = path.join(scratch, 'src')
    await mkdir(src, { recursive: true })
    await writeFile(path.join(src, 'a.txt'), 'NEW')

    const dest = path.join(scratch, 'dest')

    // (a) fresh dest -> copied, file present
    assert.equal(await copyInto(src, dest, false), 'copied')
    assert.equal(await readFile(path.join(dest, 'a.txt'), 'utf8'), 'NEW')

    // mutate the dest so we can prove skip vs overwrite
    await writeFile(path.join(dest, 'a.txt'), 'OLD')

    // (b) dest exists, no force -> skipped, original (mutated) content intact
    assert.equal(await copyInto(src, dest, false), 'skipped')
    assert.equal(await readFile(path.join(dest, 'a.txt'), 'utf8'), 'OLD')

    // (c) force -> copied, content replaced from src
    assert.equal(await copyInto(src, dest, true), 'copied')
    assert.equal(await readFile(path.join(dest, 'a.txt'), 'utf8'), 'NEW')

    // (d) force prunes a stale file the upstream src no longer has
    await writeFile(path.join(dest, 'stale.txt'), 'remove me')
    assert.ok(existsSync(path.join(dest, 'stale.txt')))
    assert.equal(await copyInto(src, dest, true), 'copied')
    assert.ok(!existsSync(path.join(dest, 'stale.txt')), 'force should rm dest before copying')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('eatahorse skill hooks resolve inside the installed skill root', async () => {
  const skillRoot = path.join(ROOT, 'plugins', 'workflow-kit', 'skills', 'eatahorse')
  const skillMd = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8')
  const hookArgs = [...skillMd.matchAll(/args:\s*\["([^"]*eatahorse_hook\.py)"\]/g)].map((m) => m[1])

  assert.equal(hookArgs.length, 3)
  for (const hookArg of hookArgs) {
    const resolved = hookArg.replace('${CLAUDE_PLUGIN_ROOT}', skillRoot)
    assert.ok(existsSync(resolved), `${hookArg} should resolve to a bundled hook script`)
  }
})

test('every shipped skill documents git-ignorable artifacts', async () => {
  const skillsRoot = path.join(ROOT, 'plugins', 'workflow-kit', 'skills')
  const entries = await readdir(skillsRoot, { withFileTypes: true })
  const missing = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md')
    if (!existsSync(skillPath)) continue
    const skillMd = await readFile(skillPath, 'utf8')
    if (!/^Artifacts:/m.test(skillMd)) missing.push(entry.name)
  }

  assert.deepEqual(missing, [])
})
