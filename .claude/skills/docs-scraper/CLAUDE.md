# Editing the `docs-scraper` skill

This skill is the **portable copy**. Its `references/*.md` are distilled INLINE as the `DETECTION`
(platform signatures) + `SELECTORS` (content extraction) consts in `.claude/workflows/docs-scrape.js`
— those feed the bs4 fallback + the WebFetch lane. **Edit a reference → refresh those consts**
(workflow stages don't auto-load skills; `.claude/rules/workflow-design.md`).

- Detection checks signals in order; the generator meta tag is the strongest. Keep that ordering
  when adding a platform signature.
