// test-bundle.mjs — self-checks for the export side (src/server/bundle.js gatherBundle).
// Builds a bundle for a real repo workflow and asserts the zip is well-formed + clean.
// Run: node frontend/test-bundle.mjs (exits 0/1). Wired into `npm test`.
import assert from 'node:assert/strict';
import { gatherBundle } from './src/server/bundle.js';
import { unzipSync } from './vendor/fflate.module.js';

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS:', name); }
  catch (e) { failed++; console.error('FAIL:', name, '\n  ', e.message); }
}

// security-audit is a built-in workflow whose header declares two skills with scripts + a .venv.
check('gatherBundle(security-audit) produces a clean, well-formed zip', () => {
  const { buffer, filename } = gatherBundle('security-audit');
  assert.equal(filename, 'security-audit-bundle.zip');
  const z = unzipSync(new Uint8Array(buffer));
  const keys = Object.keys(z);

  const manifest = JSON.parse(Buffer.from(z['bundle.json']).toString('utf8'));
  assert.equal(manifest.format, 1);
  const w = manifest.workflows[0];
  assert.equal(w.name, 'security-audit');
  assert.equal(w.file, 'workflows/security-audit.js'); // recomputed from name
  assert.deepEqual(w.skills.sort(), ['audit-codebase', 'secure-review']);

  assert.ok(z['workflows/security-audit.js'], 'workflow file present');
  assert.ok(z['skills/secure-review/SKILL.md'], 'skill SKILL.md present');

  // local build/venv noise must NOT leak into the bundle
  assert.ok(!keys.some((k) => /(^|\/)(\.venv|__pycache__|node_modules|\.git)(\/|$)/.test(k)),
    'excluded dirs must not appear: ' + keys.filter((k) => /\.venv|__pycache__|node_modules/.test(k)).join(', '));
});

check('gatherBundle rejects an unknown workflow with a 404-shaped error', () => {
  assert.throws(() => gatherBundle('does-not-exist-xyz'), (e) => e && e.status === 404);
});

check('gatherBundle rejects a traversal-y name', () => {
  assert.throws(() => gatherBundle('../etc/passwd'), (e) => e && e.status === 400);
});

if (failed) { console.error(`\n${failed} bundle check(s) failed.`); process.exit(1); }
console.log('\nAll bundle checks passed.');
