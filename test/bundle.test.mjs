// Tests for the bundle import path: bundle.mjs validation/extraction + the CLI `import` flow.
// node:test + node:assert, no framework. Run via `npm test` (node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { zipSync } from 'fflate'
import { readBundle, writeBundleToStore, listScripts } from '../bin/bundle.mjs'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'bin', 'cli.mjs')
const enc = (s) => new TextEncoder().encode(s)

// A minimal, valid one-workflow bundle. Pass overrides to break a specific invariant.
function makeBundleZip({ name = 'demo-wf', skills = ['demo-skill'], extra = {}, manifest } = {}) {
  const wfSrc =
    `// demo\n// requires-skills: ${skills.join(', ')}\n` +
    `export const meta = {\n  name: '${name}',\n  description: 'demo',\n  phases: [{ title: 'Go' }],\n}\nphase('Go')\nawait agent('hi')\nreturn;\n`
  const files = {
    ['workflows/' + name + '.js']: enc(wfSrc),
    ...Object.fromEntries(skills.flatMap((s) => [
      ['skills/' + s + '/SKILL.md', enc(`---\nname: ${s}\ndescription: d\n---\n# ${s}\n`)],
      ['skills/' + s + '/scripts/run.py', enc('print(1)\n')],
    ])),
    ...extra,
  }
  const m = manifest ?? {
    format: 1,
    workflows: [{ name, file: 'workflows/' + name + '.js', description: 'demo', skills, agents: [] }],
    skills,
    agents: [],
  }
  files['bundle.json'] = enc(JSON.stringify(m))
  return Buffer.from(zipSync(files))
}

async function writeZip(dir, buf, fname = 'bundle.zip') {
  const p = path.join(dir, fname)
  await writeFile(p, buf)
  return p
}

test('readBundle: round-trips a valid bundle and writes only declared files to the store', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'rf-bundle-'))
  try {
    const zipPath = await writeZip(scratch, makeBundleZip({ name: 'round-trip', skills: ['greeter'] }))
    const { manifest, entries, sha256 } = await readBundle(zipPath)
    assert.equal(manifest.workflows[0].name, 'round-trip')
    assert.equal(manifest.workflows[0].file, 'workflows/round-trip.js') // recomputed from name
    assert.match(sha256, /^[0-9a-f]{64}$/)

    const store = path.join(scratch, 'store')
    await writeBundleToStore(entries, manifest, store)
    assert.ok(existsSync(path.join(store, 'workflows', 'round-trip.js')))
    assert.ok(existsSync(path.join(store, 'skills', 'greeter', 'SKILL.md')))
    assert.ok(existsSync(path.join(store, 'skills', 'greeter', 'scripts', 'run.py')))

    assert.deepEqual(listScripts(entries, manifest), ['skills/greeter/scripts/run.py'])
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('readBundle: rejects a traversal entry, malformed json, dep drift, and a missing SKILL.md', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'rf-bundle-'))
  try {
    // (a) path traversal anywhere in the archive -> whole bundle refused
    const evil = await writeZip(scratch, makeBundleZip({ extra: { '../../escape.txt': enc('x') } }), 'evil.zip')
    await assert.rejects(readBundle(evil), /unsafe entry path/)

    // (b) format != 1
    const badFmt = await writeZip(scratch, makeBundleZip({ manifest: { format: 2, workflows: [], skills: [], agents: [] } }), 'fmt.zip')
    await assert.rejects(readBundle(badFmt), /format must be 1/)

    // (c) bundle.json under-declares a dep the workflow header requires
    const drift = await writeZip(
      scratch,
      makeBundleZip({
        name: 'drift-wf',
        skills: ['a'],
        manifest: { format: 1, workflows: [{ name: 'drift-wf', file: 'workflows/drift-wf.js', skills: [], agents: [] }], skills: [], agents: [] },
      }),
      'drift.zip',
    )
    await assert.rejects(readBundle(drift), /requires-skills|!=/)

    // (d) declared skill with no SKILL.md: header says ghost, but no skills/ghost/SKILL.md present
    const wf = `// x\n// requires-skills: ghost\nexport const meta = { name: 'no-skill', description: 'd', phases: [] }\nreturn;\n`
    const m = { format: 1, workflows: [{ name: 'no-skill', file: 'workflows/no-skill.js', skills: ['ghost'], agents: [] }], skills: ['ghost'], agents: [] }
    const noSkill = await writeZip(scratch, Buffer.from(zipSync({ 'workflows/no-skill.js': enc(wf), 'bundle.json': enc(JSON.stringify(m)) })), 'noskill.zip')
    await assert.rejects(readBundle(noSkill), /missing skills\/ghost\/SKILL\.md/)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

// --- CLI import flow (subprocess, hermetic RABBIT_FLOWS_HOME) -------------------------------------
async function cli(args, { home, cwd } = {}) {
  const env = { ...process.env }
  if (home) env.RABBIT_FLOWS_HOME = home
  try {
    const { stdout, stderr } = await execFileP('node', [CLI, ...args], { env, cwd })
    return { code: 0, stdout, stderr }
  } catch (e) {
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

test('import: happy path registers a bundle that then installs into a scope with a clean receipt', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'rf-import-'))
  try {
    const home = path.join(scratch, 'home')
    const zipPath = await writeZip(scratch, makeBundleZip({ name: 'my-flow', skills: ['my-skill'] }))

    const imp = await cli(['import', zipPath, '--yes'], { home })
    assert.equal(imp.code, 0, imp.stderr)
    assert.match(imp.stdout, /WARNING: this bundle ships executable scripts/) // trust gate fired
    assert.ok(existsSync(path.join(home, 'registry.json')))
    assert.ok(existsSync(path.join(home, 'bundles', 'my-flow', 'workflows', 'my-flow.js')))

    // shows up in the merged catalog, tagged (imported)
    const list = await cli(['--list'], { home })
    assert.match(list.stdout, /my-flow.*\(imported\)/)

    // and installs into a project scope from the store
    const proj = path.join(scratch, 'proj')
    await mkdir(proj, { recursive: true })
    const inst = await cli(['install', '--workflow', 'my-flow', '--scope', 'project'], { home, cwd: proj })
    assert.equal(inst.code, 0, inst.stderr)
    assert.ok(existsSync(path.join(proj, '.claude', 'workflows', 'my-flow.js')))
    assert.ok(existsSync(path.join(proj, '.claude', 'skills', 'my-skill', 'SKILL.md')))
    const receipt = JSON.parse(await readFile(path.join(proj, '.claude', '.rabbit-flows-receipt.json'), 'utf8'))
    assert.ok(receipt.workflows.includes('my-flow'))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('import: refuses to shadow a built-in (even with --force) and refuses a re-import without --force', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'rf-import-'))
  try {
    const home = path.join(scratch, 'home')

    // shadow a built-in workflow name -> hard refusal, no override
    const shadowZip = await writeZip(scratch, makeBundleZip({ name: 'security-audit', skills: ['x'] }), 'shadow.zip')
    const shadow = await cli(['import', shadowZip, '--yes', '--force'], { home })
    assert.equal(shadow.code, 1)
    assert.match(shadow.stderr, /built-in workflow; a bundle may not shadow it/)
    assert.ok(!existsSync(path.join(home, 'registry.json')), 'nothing should be written on refusal')

    // import once, then re-import the same name -> refused unless --force
    const zipPath = await writeZip(scratch, makeBundleZip({ name: 'dupe', skills: ['s'] }))
    assert.equal((await cli(['import', zipPath, '--yes'], { home })).code, 0)
    const again = await cli(['import', zipPath, '--yes'], { home })
    assert.equal(again.code, 1)
    assert.match(again.stderr, /already imported/)
    assert.equal((await cli(['import', zipPath, '--yes', '--force'], { home })).code, 0)

    // --remove drops it from the catalog
    assert.equal((await cli(['import', '--remove', 'dupe'], { home })).code, 0)
    const list = await cli(['--list'], { home })
    assert.doesNotMatch(list.stdout, /dupe/)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('import: non-interactive without --yes refuses (no consent)', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'rf-import-'))
  try {
    const home = path.join(scratch, 'home')
    const zipPath = await writeZip(scratch, makeBundleZip({ name: 'noconsent', skills: ['s'] }))
    const r = await cli(['import', zipPath], { home }) // no --yes, not a TTY under execFile
    assert.equal(r.code, 1)
    assert.match(r.stderr, /pass --yes to consent/)
    assert.ok(!existsSync(path.join(home, 'registry.json')))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
