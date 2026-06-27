// registry.mjs — the user-writable catalog of IMPORTED bundles.
// The baked installer/manifest.json ships the built-in workflows; this is the second source
// loadManifest() merges in, so a bundle a user imported shows up in the install TUI alongside
// them. Lives under ~/.rabbit-flows (override with RABBIT_FLOWS_HOME so tests stay hermetic).
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const RF_HOME = process.env.RABBIT_FLOWS_HOME || path.join(homedir(), '.rabbit-flows')
export const REGISTRY = path.join(RF_HOME, 'registry.json')
export const BUNDLES_DIR = path.join(RF_HOME, 'bundles')

// { version, bundles: { <bundleName>: { workflows: [<manifest entry>...], importedAt, sha256, archive } } }
// Tolerant parse: a corrupt/missing registry reads as empty (mirrors cli.mjs readReceipt).
export async function readRegistry() {
  if (!existsSync(REGISTRY)) return { version: 1, bundles: {} }
  try {
    const r = JSON.parse(await readFile(REGISTRY, 'utf8'))
    return { version: 1, bundles: r.bundles ?? {} }
  } catch {
    return { version: 1, bundles: {} }
  }
}

export async function writeRegistry(data) {
  await mkdir(RF_HOME, { recursive: true })
  const tmp = REGISTRY + '.tmp'
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n')
  await rename(tmp, REGISTRY) // atomic-ish: a reader sees the old or new file, never a half-write
}

// Flatten every imported bundle into manifest-shaped entries the installer can consume.
// _base points the install/source resolver at this bundle's store dir; _builtin:false routes
// its skills/agents to the flat store layout (skills/, agents/) instead of the repo plugin tree.
export function registryWorkflows(reg) {
  const out = []
  for (const [bundleName, b] of Object.entries(reg.bundles ?? {})) {
    for (const w of b.workflows ?? []) {
      out.push({ ...w, _base: path.join(BUNDLES_DIR, bundleName), _builtin: false, _bundle: bundleName })
    }
  }
  return out
}

export const storeDirFor = (bundleName) => path.join(BUNDLES_DIR, bundleName)

// Drop a bundle from the catalog and delete its stored source. Does NOT touch already-installed
// copies in a scope — those are receipt-owned; the caller tells the user to `uninstall` them.
export async function removeBundle(reg, name) {
  if (!reg.bundles?.[name]) return false
  delete reg.bundles[name]
  await rm(storeDirFor(name), { recursive: true, force: true })
  await writeRegistry(reg)
  return true
}
