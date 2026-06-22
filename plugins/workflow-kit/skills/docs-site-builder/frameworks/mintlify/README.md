# Mintlify

SaaS-hosted documentation platform (v4.x). MDX content at the repository root (or a configured
directory); `mint.json` (or `docs.json` in newer versions) is the sole config file.

## Workflow

Work in this order; read the reference when you reach that step.

1. **Scaffold** — `npm i -g mintlify`, project layout, `mint.json` skeleton. → `references/setup.md`
2. **Configure** — `mint.json`: name, logo, colors, favicon, navigation (groups + pages array),
   anchors, tabs, topbarLinks. Navigation grouping is the fiddly part. → `references/configuration.md`
3. **Author pages** — MDX frontmatter (`title`, `description`, `icon`, `sidebarTitle`, `mode`).
   → `references/frontmatter.md`
4. **Rich content** — Mintlify built-in components (Note, Warning, Tip, Info, Card, CardGroup,
   CodeGroup, Steps, Accordion, AccordionGroup, Tabs, Tab, Tooltip). → `references/content-authoring.md`
5. **Components** — Card, CardGroup, CodeGroup, Steps, Accordion, Tabs, Tooltip, Frame, Icon.
   → `references/components.md`

For a single narrow question (e.g. "how do I group navigation pages?") read just the one relevant
reference.

## Quick facts

- CLI: `npm i -g mintlify` | Local preview: `mintlify dev` (serves on port 3000)
- Config file: `mint.json` (older) or `docs.json` (newer projects) at repo root
- Content: MDX files at any path; paths in `mint.json` navigation are relative, no `.mdx` extension
- Dev: `mintlify dev` | Deploy: push to GitHub (Mintlify auto-deploys via their platform)
- Navigation structure: `"navigation": [{"group":"Group Name","pages":["path/to/page",...]}]`
- Anchors: `"anchors": [{"name":"GitHub","icon":"github","url":"https://..."}]`
- Built-in callout components: `<Note>`, `<Warning>`, `<Tip>`, `<Info>` (MDX, no imports needed)
- Validate: `mintlify dev` parses mint.json + MDX on startup; watch for console errors

## Authoring guidance

- Mintlify is a SaaS platform: `mint.json` defines everything; there is no local build artifact.
  The "build" is Mintlify's CDN rendering your repo on push.
- Navigation paths in `mint.json` omit the `.mdx` extension and should be repo-root-relative.
  Example: `"pages": ["introduction", "guides/quickstart"]` maps to `introduction.mdx` and
  `guides/quickstart.mdx`.
- Built-in components (`<Note>`, `<Card>`, etc.) are globally available in MDX; no import needed.
- `mint.json` must be valid JSON (no trailing commas); validation errors surface immediately on
  `mintlify dev` startup.
- After config changes, `mintlify dev` is the check that matters (SaaS has no `build` command).
