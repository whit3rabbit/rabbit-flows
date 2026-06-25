# Information architecture for docs sites

Framework-agnostic. Read this **before** planning or authoring pages: good documentation is an IA
problem before it is a syntax problem. The runtime copy of this guidance lives inline in
`.claude/workflows/docs-create.js` (`IA_CONTRACT`); if you change this file, refresh that const.

## Diátaxis: the four quadrants

Every page serves exactly one of four reader needs. The cardinal rule: **do not mix modes on one
page.** A tutorial that stops to explain theory, or a reference that turns into a how-to, fails both
readers.

| Quadrant | Reader is... | Serves | Voice |
|---|---|---|---|
| **Tutorial** | learning | a guided first success | "we will", hand-held, no choices |
| **How-to** | working | a specific task done | "to do X, do Y", goal-directed |
| **Reference** | looking something up | exhaustive, accurate facts | dry, consistent, no narrative |
| **Explanation** | understanding | context and the "why" | discursive, names tradeoffs |

Diagnostic: *learning vs working* (tutorial/how-to are practical steps) crossed with *acquiring
skill vs applying it* (tutorial/explanation orbit study; how-to/reference orbit work).

## Page templates per quadrant

Each page kind has a section skeleton authors must follow.

- **Tutorial** — prerequisites → numbered steps (each with a visible, runnable result) → the final
  result the reader now has → next steps. One happy path, no branching, no "you could also".
- **How-to** — the goal stated up front → ordered steps → a verification step (how the reader
  confirms it worked). Assumes competence; omits teaching.
- **Reference** — consistent, exhaustive entries, grouped or alphabetised, scannable. No narrative,
  no opinion. Same shape for every entry (signature, params, returns, example).
- **Explanation** — context (why this exists) → discussion → tradeoffs and alternatives considered.
  No step-by-step; this is the page that answers "why is it built this way".

Two structural page kinds sit outside the quadrants:
- **index/landing** — routes the reader's journey: what this is, who it's for, the entry points to
  each quadrant. Often `splash` template with a hero on a Starlight site.

## Navigation

- **Shallow over deep.** ≤2 sidebar levels by default. A reader should never hunt three folders deep.
- **Group by user task, not by internal module.** "Getting started / Guides / Reference", not your
  package layout.
- **A landing page routes the journey.** First-touch reader lands somewhere that points them at the
  right quadrant for their need.
- Order groups along the reader journey: first-touch → proficient.

## Writing

- **Task-oriented headings.** "Deploy to production", not "Deployment".
- **Examples first.** Show a working example before the exhaustive prose; readers scan for code.
- **One concept per page.** If a page covers two things, it's two pages.
- **Scannable.** Short paragraphs, code early, lists over walls of text.
- **Define jargon once,** on first use, then use it consistently.

## The getting-started rule

A new reader reaches a **first success within ~5 minutes.** If the quickstart can't get someone to a
working result that fast, the IA (or the product's onboarding) is the problem, not the prose. This is
the single highest-leverage page; design the journey backwards from it.

## Archetypes: what docs a project needs

Diátaxis shapes a page *once you've decided to write it*. This decides **which pages a given project
should have, and whether it needs a site at all.** Identify the archetype first, then plan the
minimum-viable set for it — do not pour every project into the full four-quadrant spread.

| Archetype | Must-have | High-value | Skip / deprioritize |
|---|---|---|---|
| **CLI tool** | command reference, quickstart | install/config how-to | tutorials, deep explanation |
| **Library / SDK** | API reference, getting-started | how-tos, tutorials, key-concepts explanation | ops/deployment |
| **Service / API** | endpoint reference (OpenAPI), auth + deploy runbook | integration how-tos | beginner tutorial |
| **Internal tool / app** | README, runbook, ADRs | onboarding how-to | public splash, marketing |
| **Framework / platform** | getting-started, guides, full reference | tutorials, explanation, migration guides | — (the full spread fits) |

**Minimum-viable-docs baseline (every archetype clears this floor):** a one-paragraph "what this is
+ who it's for", a getting-started that hits first success in ~5 min (the rule above), and one
reference surface for the project's primary interface (commands, API, or endpoints). Everything else
is earned by the archetype, not added by default.

**Two skeletons the four quadrants don't cover** (use when the archetype calls for them):
- **ADR** (architecture decision record) — context (forces at play) → decision → consequences
  (what this commits us to, what it rules out). One decision per record, dated, immutable once
  accepted.
- **Runbook** — symptom / trigger → diagnosis steps → remediation → escalation + rollback. Written
  for an on-call reader at 3am: scannable, imperative, no theory.
- "CLI command page" is a reference entry (signature, flags, example) and "library quickstart" is a
  tutorial — variants of existing quadrants, not new shapes.

**Does this even need a multi-page site?** Match output shape to archetype + size, and record the
verdict so the reader can act on it:
- **single-file** (one README/markdown file) — a CLI or small library whose whole surface fits one
  scannable page. A multi-page site here is overhead.
- **embedded** (docstrings / inline API comments in source, not a separate site) — a library whose
  API reference belongs next to the code it documents.
- **site** — anything with multiple audiences, a real reader journey, or a reference surface too
  large for one page (frameworks, platforms, larger services).

This is a recommendation the planner records, not a branch it takes: note the archetype and the
recommended shape even when the run still builds a site, so a maintainer sees "this is a CLI tool; a
single README likely suffices" and can choose.
