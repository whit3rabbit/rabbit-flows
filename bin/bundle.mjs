// bundle.mjs — read + validate an imported .zip bundle, and write its declared files to a store.
//
// Security model: a bundle is third-party code. unzipSync gives a flat { path: bytes } map, so the
// archive NEVER drives a filesystem write — we read only the entries we DECLARED and write paths we
// COMPUTE from validated names. That alone neutralises zip-slip/symlink/device escape (there is no
// extraction step). Caps below bound the zip-bomb surface. What we cannot stop: the skill scripts
// and workflow .js run with the user's permissions when the workflow later runs — see the import
// trust gate in cli.mjs.
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
// Dynamic import: fflate is only needed at readBundle() time, not for --check.
// This keeps the CI check job dependency-free (import resolves lazily).
let _fflate = null
async function fflate() {
  if (!_fflate) _fflate = await import('fflate')
  return _fflate
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/
export const isBundleName = (s) => typeof s === 'string' && NAME_RE.test(s)

const MAX_ARCHIVE = 32 * 1024 * 1024 // reject the file before we decompress it
const MAX_FILES = 4000
const MAX_TOTAL = 64 * 1024 * 1024 // summed decompressed bytes (bomb guard)

// --- header helpers (also imported by cli.mjs; bundle.mjs is the one-directional leaf) ----------
export const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

// Parse a "// requires-skills: a, b" / "// requires-agents: x" header. null when absent.
export function parseRequires(src, key) {
  const m = src.match(new RegExp(`//\\s*requires-${key}:\\s*(.*)`, 'i'))
  if (!m) return null
  return m[1].split(',').map((s) => s.trim()).filter(Boolean)
}

// Reject only genuinely dangerous keys: a '..' traversal segment, an absolute path, or a null byte.
// Benign oddities ('./' prefixes, '//' from some zip tools, trailing-slash dir entries) are fine —
// we never write archive-controlled paths anyway (writeBundleToStore re-confines to the store dir).
function safeKey(key) {
  if (key.includes('\0') || path.isAbsolute(key)) return false
  return !key.split('/').includes('..')
}

// readBundle: load + fully validate a bundle archive. Throws Error(reason) on any deviation.
// Returns { manifest, entries, sha256 }. entries is the fflate { path: Uint8Array } map.
export async function readBundle(archivePath) {
  if (!existsSync(archivePath)) throw new Error(`no such file: ${archivePath}`)
  const st = await stat(archivePath)
  if (st.size > MAX_ARCHIVE) throw new Error(`archive too large (${st.size} > ${MAX_ARCHIVE} bytes)`)
  const buf = await readFile(archivePath)
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex')

  let entries
  try {
    const { unzipSync } = await fflate()
    entries = unzipSync(new Uint8Array(buf))
  } catch (e) {
    throw new Error(`not a readable zip: ${e.message}`)
  }
  const keys = Object.keys(entries)
  if (keys.length > MAX_FILES) throw new Error(`too many entries (${keys.length} > ${MAX_FILES})`)
  let total = 0
  for (const k of keys) total += entries[k].length
  if (total > MAX_TOTAL) throw new Error(`decompressed size too large (${total} > ${MAX_TOTAL} bytes)`)
  for (const k of keys) if (!safeKey(k)) throw new Error(`unsafe entry path: ${k}`)

  if (!entries['bundle.json']) throw new Error('missing bundle.json')
  let manifest
  try {
    manifest = JSON.parse(Buffer.from(entries['bundle.json']).toString('utf8'))
  } catch (e) {
    throw new Error(`bundle.json is not valid JSON: ${e.message}`)
  }
  validateManifest(manifest, entries)
  return { manifest, entries, sha256 }
}

// Strict schema + cross-checks. `file` is RECOMPUTED from name, never trusted from the archive.
function validateManifest(m, entries) {
  if (!m || m.format !== 1) throw new Error('bundle.json: format must be 1')
  if (!Array.isArray(m.workflows) || m.workflows.length !== 1) {
    throw new Error('bundle.json: expected exactly one workflow (v1)')
  }
  const skills = m.skills ?? []
  const agents = m.agents ?? []
  for (const [label, list] of [['skills', skills], ['agents', agents]]) {
    if (!Array.isArray(list)) throw new Error(`bundle.json: ${label} must be an array`)
    for (const n of list) if (!isBundleName(n)) throw new Error(`bundle.json: invalid ${label} name "${n}"`)
  }
  const w = m.workflows[0]
  if (!isBundleName(w.name)) throw new Error(`bundle.json: invalid workflow name "${w.name}"`)
  w.file = `workflows/${w.name}.js` // recompute, do not trust
  w.skills = w.skills ?? []
  w.agents = w.agents ?? []
  if (!sameSet(w.skills, skills)) throw new Error('bundle.json: workflow.skills != top-level skills')
  if (!sameSet(w.agents, agents)) throw new Error('bundle.json: workflow.agents != top-level agents')

  // The workflow's own header comment is the canonical contract (cli --check enforces it on
  // built-ins); a bundle must not under-declare its deps.
  const src = entries[w.file]
  if (!src) throw new Error(`bundle is missing ${w.file}`)
  const text = Buffer.from(src).toString('utf8')
  for (const [key, declared] of [['skills', w.skills], ['agents', w.agents]]) {
    const header = parseRequires(text, key)
    if (header && !sameSet(header, declared)) {
      throw new Error(`${w.file} // requires-${key} [${header.join(', ')}] != bundle.json [${declared.join(', ')}]`)
    }
  }
  // Every declared skill needs its SKILL.md; every declared agent needs its .md.
  for (const s of skills) if (!entries[`skills/${s}/SKILL.md`]) throw new Error(`skill "${s}" missing skills/${s}/SKILL.md`)
  for (const a of agents) if (!entries[`agents/${a}.md`]) throw new Error(`agent "${a}" missing agents/${a}.md`)
}

// Write ONLY the files the manifest declares, under storeDir. Stray archive entries are ignored.
// Each written key is re-confined to storeDir (defence in depth atop safeKey).
export async function writeBundleToStore(entries, manifest, storeDir) {
  const w = manifest.workflows[0]
  const prefixes = [w.file, ...(manifest.skills ?? []).map((s) => `skills/${s}/`), ...(manifest.agents ?? []).map((a) => `agents/${a}.md`)]
  for (const key of Object.keys(entries)) {
    if (key.endsWith('/')) continue // dir entry, no bytes
    const claimed = prefixes.some((p) => (p.endsWith('/') ? key.startsWith(p) : key === p))
    if (!claimed) continue
    const dest = path.join(storeDir, key)
    const resolved = path.resolve(dest)
    if (resolved !== path.normalize(dest) || !resolved.startsWith(path.resolve(storeDir) + path.sep)) {
      throw new Error(`refusing to write outside store: ${key}`)
    }
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, Buffer.from(entries[key]))
  }
}

// Executable scripts the bundle ships — surfaced in the import trust gate so the user sees what
// will run with their permissions before they consent.
export function listScripts(entries, manifest) {
  const skillPrefixes = (manifest.skills ?? []).map((s) => `skills/${s}/`)
  return Object.keys(entries)
    .filter((k) => skillPrefixes.some((p) => k.startsWith(p)))
    .filter((k) => /\.(py|sh)$/.test(k) || /\/scripts\//.test(k))
    .sort()
}
