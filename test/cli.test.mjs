// Behavioral tests for the installer's one destructive op: copyInto with force.
// node:test + node:assert, no framework. Run via `npm test` (node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyInto, install, uninstall, readReceipt, depsOf, parseSilos, resolveSilo } from '../bin/cli.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Real manifest entries the install/uninstall tests drive against (files exist in the repo).
const MANIFEST = JSON.parse(
  await readFile(path.join(ROOT, 'installer', 'manifest.json'), 'utf8'),
).workflows
const byName = (n) => MANIFEST.find((w) => w.name === n)

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

test('install: writes a receipt listing the workflow and its bundled skills', async () => {
  const scope = await mkdtemp(path.join(tmpdir(), 'rabbit-flows-test-'))
  try {
    await install([byName('docs-from-code')], scope, false)
    const r = await readReceipt(scope)
    assert.deepEqual(r.workflows, ['docs-from-code'])
    assert.ok('workflows/docs-from-code.js' in r.files, 'workflow file recorded')
    for (const s of byName('docs-from-code').skills) {
      assert.ok(`skills/${s}` in r.files, `skill ${s} recorded`)
      assert.equal(r.files[`skills/${s}`].type, 'skill', `skill ${s} typed`)
      assert.equal(r.files[`skills/${s}`].backup, null, 'no backup for a fresh dest')
      assert.ok(existsSync(path.join(scope, 'skills', s)), `skill ${s} on disk`)
    }
  } finally {
    await rm(scope, { recursive: true, force: true })
  }
})

test('install --force: backs up a displaced foreign file and records it', async () => {
  const scope = await mkdtemp(path.join(tmpdir(), 'rabbit-flows-test-'))
  try {
    // user already has their OWN eatahorse skill at the dest
    const foreign = path.join(scope, 'skills', 'eatahorse')
    await mkdir(foreign, { recursive: true })
    await writeFile(path.join(foreign, 'SKILL.md'), 'USER VERSION')

    await install([byName('eatahorse')], scope, true) // force overwrite
    const r = await readReceipt(scope)
    const backup = r.files['skills/eatahorse'].backup
    assert.ok(backup && backup.startsWith('.rabbit-flows-backups/'), 'backup path recorded')
    assert.equal(
      await readFile(path.join(scope, backup, 'SKILL.md'), 'utf8'),
      'USER VERSION',
      'foreign content preserved in backup',
    )
    assert.notEqual(
      await readFile(path.join(scope, 'skills', 'eatahorse', 'SKILL.md'), 'utf8'),
      'USER VERSION',
      'dest now holds our version',
    )
  } finally {
    await rm(scope, { recursive: true, force: true })
  }
})

test('uninstall selective: keeps a shared skill still needed by a remaining workflow', async () => {
  const scope = await mkdtemp(path.join(tmpdir(), 'rabbit-flows-test-'))
  try {
    // both depend on the shared `eatahorse` skill
    await install([byName('eatahorse'), byName('eatahorse-research')], scope, false)
    assert.ok(existsSync(path.join(scope, 'skills', 'eatahorse')))

    await uninstall(['eatahorse'], scope, MANIFEST, false)
    const r = await readReceipt(scope)
    assert.deepEqual(r.workflows, ['eatahorse-research'], 'only eatahorse-research remains')
    assert.ok(!existsSync(path.join(scope, 'workflows', 'eatahorse.js')), 'workflow file removed')
    assert.ok(
      existsSync(path.join(scope, 'skills', 'eatahorse')),
      'shared skill RETAINED (eatahorse-research still needs it)',
    )
    assert.ok('skills/eatahorse' in r.files, 'shared skill still in receipt')
  } finally {
    await rm(scope, { recursive: true, force: true })
  }
})

test('uninstall --all: removes our files, restores a backed-up foreign file, deletes receipt', async () => {
  const scope = await mkdtemp(path.join(tmpdir(), 'rabbit-flows-test-'))
  try {
    const foreign = path.join(scope, 'skills', 'eatahorse')
    await mkdir(foreign, { recursive: true })
    await writeFile(path.join(foreign, 'SKILL.md'), 'USER VERSION')

    await install([byName('eatahorse')], scope, true)
    await uninstall([], scope, MANIFEST, true)

    assert.ok(!existsSync(path.join(scope, 'workflows', 'eatahorse.js')), 'workflow gone')
    assert.ok(!existsSync(path.join(scope, '.rabbit-flows-receipt.json')), 'receipt deleted')
    assert.ok(!existsSync(path.join(scope, '.rabbit-flows-backups')), 'backups cleaned')
    assert.equal(
      await readFile(path.join(foreign, 'SKILL.md'), 'utf8'),
      'USER VERSION',
      'user file restored from backup',
    )
  } finally {
    await rm(scope, { recursive: true, force: true })
  }
})

test('depsOf: unions skills/agents across workflows', () => {
  const { skills } = depsOf([byName('docs-from-code'), byName('eatahorse')])
  // Exact set, not just membership: a bug that unioned ALL workflows' deps must fail here.
  assert.deepEqual([...skills].sort(), ['docs-site-builder', 'document', 'document-codebase', 'eatahorse'])
})

test('install: a pre-existing foreign workflow .js is left alone but its skills stay selectively removable', async () => {
  const scope = await mkdtemp(path.join(tmpdir(), 'rabbit-flows-test-'))
  try {
    // user already has their OWN workflow .js at our dest, but not the skill
    const wfDest = path.join(scope, 'workflows', 'eatahorse.js')
    await mkdir(path.dirname(wfDest), { recursive: true })
    await writeFile(wfDest, 'USER WORKFLOW')

    await install([byName('eatahorse')], scope, false) // no force: foreign .js is skipped
    const r = await readReceipt(scope)
    assert.deepEqual(r.workflows, ['eatahorse'], 'claimed via its copied skill, not the .js')
    assert.ok(!('workflows/eatahorse.js' in r.files), 'foreign workflow file NOT claimed')
    assert.equal(r.files['skills/eatahorse'].type, 'skill', 'skill recorded as a structured entry')
    assert.ok(existsSync(path.join(scope, 'skills', 'eatahorse')), 'skill installed')

    await uninstall(['eatahorse'], scope, MANIFEST, false)
    assert.equal(await readFile(wfDest, 'utf8'), 'USER WORKFLOW', 'foreign workflow untouched')
    assert.ok(!existsSync(path.join(scope, 'skills', 'eatahorse')), 'claimed skill removed')
  } finally {
    await rm(scope, { recursive: true, force: true })
  }
})

test('parseSilos: maps ccsilo json, drops entries without a configDir, tolerates junk', () => {
  // Real shape from `ccsilo variant list --json` (trimmed to the fields we read).
  const json = JSON.stringify([
    { id: 'zai', name: 'zai', provider: { label: 'Zai Cloud' }, paths: { configDir: '/w/zai/config' } },
    { id: 'or', provider: { key: 'openrouter' }, paths: { configDir: '/w/or/config' } }, // name falls back to id
    { id: 'broken', name: 'broken', paths: {} }, // no configDir -> dropped
    { name: 'noid', paths: { configDir: '/w/x/config' } }, // no id -> dropped
  ])
  assert.deepEqual(parseSilos(json), [
    { id: 'zai', name: 'zai', provider: 'Zai Cloud', configDir: '/w/zai/config' },
    { id: 'or', name: 'or', provider: 'openrouter', configDir: '/w/or/config' },
  ])
  assert.deepEqual(parseSilos('not json'), [], 'parse error -> []')
  assert.deepEqual(parseSilos('{"not":"array"}'), [], 'non-array -> []')
})

test('resolveSilo: matches by id, undefined on miss', () => {
  const silos = parseSilos(
    JSON.stringify([{ id: 'zai', name: 'zai', paths: { configDir: '/w/zai/config' } }]),
  )
  assert.equal(resolveSilo(silos, 'zai').configDir, '/w/zai/config')
  assert.equal(resolveSilo(silos, 'nope'), undefined)
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
