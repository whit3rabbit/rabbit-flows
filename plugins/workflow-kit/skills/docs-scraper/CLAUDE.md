# Editing the `docs-scraper` skill

This skill is the **portable copy**. Its `references/*.md` are distilled INLINE as the `DETECTION`
(platform signatures) + `SELECTORS` (content extraction) consts in `.claude/workflows/docs-scrape.js`
— those feed the bs4 fallback + the WebFetch lane. **Edit a reference → refresh those consts**
(workflow stages don't auto-load skills; `.claude/rules/workflow-design.md`).

A SECOND consumer hand-copies a subset of the same `SELECTORS`/`DETECTION` maps:
`.claude/workflows/docs-migrate.js` (source-platform parsing for migration). Its copy deliberately
excludes `fumadocs` (migrate's `from:` list never offered it) but must otherwise stay a subset of
docs-scrape.js's keys/values — refresh it too when you touch a reference.
`scripts/test_platform_drift.py` guards this (run after editing either file).

- Detection checks signals in order; the generator meta tag is the strongest. Keep that ordering
  when adding a platform signature.
