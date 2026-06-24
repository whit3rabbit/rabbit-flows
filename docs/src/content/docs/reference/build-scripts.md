---
title: Build Script Reference
description: Build-time scripts for maintaining rabbit-flows
---

<!-- generated: javascript lane, signal: package.json -->

## Overview

These Node.js build scripts maintain consistency between various parts of the rabbit-flows repository. They are run locally and in CI to prevent drift.

## build-skill.mjs

Generates the `workflow-guardrails` skill from the rules in `.claude/rules/`.

```bash
node scripts/build-skill.mjs           # Write the generated SKILL.md
node scripts/build-skill.mjs --check   # Exit 1 if the skill is stale
```

**Details:**
- Reads three rule files in order: `workflow-design.md`, `model-routing.md`, `memory.md`
- Concatenates them with demoted headings (one level deeper) under a single "# Workflow guardrails" heading
- Wraps the result with frontmatter metadata
- Writes to `plugins/workflow-kit/skills/workflow-guardrails/SKILL.md`
- The rules are the single source of truth; the skill is a generated build artifact that travels to other projects via the npm package
- Exit non-zero on `--check` if the committed skill does not match the rules (CI gate)

**Usage in npm scripts:**
```bash
npm run build:skill
```

---

## build-docs-contracts.mjs

Generates inline contract blocks in workflow files from documentation reference sources.

```bash
node scripts/build-docs-contracts.mjs           # Write the contract blocks
node scripts/build-docs-contracts.mjs --check   # Exit 1 if any contract is stale
```

**Contract Blocks Generated:**

The script finds and replaces blocks delimited by:
```javascript
// @generated-start docs-contracts/<block-name>
// @generated-end docs-contracts/<block-name>
```

| Block | Source | Target Files | Mode |
|---|---|---|---|
| `starlight-contract` | `plugins/workflow-kit/skills/docs-site-builder/references/*.md` | docs-create.js, docs-from-code.js | concat |
| `ia-contract` | `plugins/workflow-kit/skills/docs-site-builder/references/information-architecture.md` | docs-create.js, docs-from-code.js | concat |
| `frameworks` | `plugins/workflow-kit/skills/docs-site-builder/frameworks/registry.js` | docs-create.js, docs-from-code.js | verbatim |
| `<fw>-contract` (6 frameworks) | `plugins/workflow-kit/skills/docs-site-builder/frameworks/<fw>/references/*.md` | docs-create.js, docs-from-code.js | concat |

**Details:**
- **concat mode:** Concatenates reference files (in order) under a header, then wraps as a JavaScript template-literal const: `const CONTRACT = \`...\``
  - Escapes backticks and `${` sequences in the contract text for safe JS embedding
- **verbatim mode:** Splices the source file's text AS-IS (used for `frameworks/registry.js`, which is already valid JS)
- Both markers must be present in the target file for the block to be updated; blocks in files without both markers are silently skipped
- Exit non-zero on `--check` if any target file contains stale contracts (CI gate)

**Framework Contracts:**
- Per-framework contracts are auto-generated for: docusaurus, mkdocs, vitepress, fumadocs, mdbook, docsify
- Each framework needs a `frameworks/<fw>/references/` directory containing the five reference files: setup.md, configuration.md, frontmatter.md, content-authoring.md, components.md
- The framework contracts are declared ABOVE the `frameworks` block so they are in scope when the verbatim splice references them

**Usage in npm scripts:**
```bash
npm run build:docs-contracts
```

---

## Integration with CI

Both build scripts are part of the `npm run check` gate:

```bash
npm run check
# Runs: npm run build:skill && npm run build:docs-contracts
```

This command (also run in CI) verifies:
1. The workflow-guardrails skill matches `.claude/rules/`
2. All docs-contracts blocks are up-to-date with their sources
3. The installer manifest is consistent with workflow headers

---

## Notes

- The inline contract blocks (`CONTRACT`, `IA_CONTRACT`, etc.) are embedded at RUNTIME in the workflows, not the rules. Edit the rules or reference files, then regenerate.
- Contrasts with the guardrails skill, which is committed and shipped in the npm package; contract blocks are committed but read only by the local workflow session.
- A contract block's presence is detected by exact marker matching; if the end marker text appears anywhere in the contract body (even in a comment), the build will match incorrectly and silently truncate.
