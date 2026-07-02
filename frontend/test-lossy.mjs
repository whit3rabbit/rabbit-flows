/**
 * test-lossy.mjs — check every .claude/workflows/*.js for lossy (unparseable) entries.
 *
 * Parsing a workflow JS file into a visual graph is best-effort. Lossy entries
 * represent constructs the heuristic parser could not map to nodes. A clean run
 * (= 0 lossy entries) means every workflow produces a complete graph.
 *
 * Usage:
 *   node frontend/test-lossy.mjs           # exit 1 on any lossy
 *   node frontend/test-lossy.mjs --report  # print counts, exit 0 regardless
 *   node frontend/test-lossy.mjs --json    # print JSON summary
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorkflow } from './parser.js';

const WORKFLOWS_DIR = new URL('../.claude/workflows', import.meta.url).pathname;

function main() {
  const reportMode = process.argv.includes('--report');
  const jsonMode = process.argv.includes('--json');

  const files = readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.js')).sort();
  const results = [];

  for (const f of files) {
    const src = readFileSync(join(WORKFLOWS_DIR, f), 'utf8');
    const { nodes, edges, lossy } = parseWorkflow(src);
    results.push({
      file: f,
      nodes: nodes.length,
      edges: edges.length,
      lossy: lossy.map(l => ({ line: l.line, reason: l.reason })),
    });
  }

  const totalLossy = results.reduce((sum, r) => sum + r.lossy.length, 0);
  const filesWithLossy = results.filter(r => r.lossy.length > 0);

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (reportMode) {
    for (const r of results) {
      const status = r.lossy.length
        ? `\x1b[33m${r.lossy.length} lossy\x1b[0m`
        : '\x1b[32mok\x1b[0m';
      console.log(`${r.file.padEnd(24)} ${r.nodes} nodes  ${r.edges} edges  ${status}`);
      for (const l of r.lossy) {
        console.log(`  \x1b[33m  line ${l.line}: ${l.reason}\x1b[0m`);
      }
    }
    if (filesWithLossy.length) {
      console.log(`\n${filesWithLossy.length} file(s) with lossy entries (${totalLossy} total)`);
    } else {
      console.log('\nAll clean - 0 lossy entries');
    }
  }

  // Default mode: exit 1 on any lossy
  if (!reportMode && !jsonMode) {
    let exitCode = 0;
    for (const r of results) {
      if (r.lossy.length) {
        console.log(`${r.file}: ${r.lossy.length} lossy`);
        for (const l of r.lossy) {
          console.log(`  line ${l.line}: ${l.reason}`);
        }
        exitCode = 1;
      }
    }
    if (exitCode === 0) {
      console.log('All workflows parse cleanly (0 lossy entries)');
    }
    process.exit(exitCode);
  }
}

main();
