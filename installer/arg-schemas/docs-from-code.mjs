// SINGLE SOURCE OF TRUTH for the docs-from-code workflow's args.
//
// scripts/build-arg-contract.mjs generates THREE surfaces from this list:
//   1. the UNIFORM guard block in .claude/workflows/docs-from-code.js (kind !== 'custom' args)
//   2. the workflow's header "Knobs (args)" comment
//   3. document-codebase/SKILL.md's Workflow args block + Defaults line
// `npm run check` (build:arg-contract --check) fails on drift AND asserts every arg name here
// set-matches the `args?.X` accesses in the guard region — so a hand-added guard or a dropped arg is caught.
//
// To add/rename/remove an arg: edit THIS list, run `npm run build:arg-contract`, then `npm run check`.
// Bespoke validation (object/array shape, normPagePath dependency) lives hand-written in the workflow under
// kind:'custom' — those args still appear in the docs surfaces and the name-set lint, just not the guard codegen.
//
// Fields:
//   name        arg key on `args`
//   kind        guard codegen shape: scalar|string|stringTrim|bool|enum|intClamped|arrayFilter|custom
//   var         const name if it differs from `name` (e.g. pages -> explicitPages)
//   default     guard default (JS literal value; null/''/number/string)
//   choices     enum kind: allowed values
//   max         intClamped kind: ceiling
//   note        optional trailing `// note` on the generated guard line
//   oneLiner    human description for the header + SKILL docs
//   group       'core' | 'optional' | 'update' (doc grouping only)
//   intakeDefault  override shown in the SKILL Defaults line (the skill's suggested value, may differ from `default`)
//   showInDefaults true -> include in the SKILL "Defaults" line
//   required    true -> documented as required

export const ARGS = [
  // --- core ---
  { name: 'root', kind: 'custom', default: '.', group: 'core', showInDefaults: true,
    oneLiner: 'repo root to document (bare string also accepted)' },
  { name: 'outDir', kind: 'string', default: null, group: 'core', required: true,
    intakeDefault: './docs-site', showInDefaults: true,
    oneLiner: 'directory to write the docs site into (required)' },
  { name: 'framework', kind: 'scalar', default: 'starlight', group: 'core', showInDefaults: true,
    oneLiner: 'registry id; unknown ids fall back to work-from-current-docs' },
  { name: 'scaffoldMode', kind: 'enum', choices: ['content-only', 'add-to-existing', 'full-project'],
    default: 'content-only', group: 'core', showInDefaults: true,
    oneLiner: "content-only (default) | add-to-existing | full-project (Starlight only)" },
  { name: 'brief', kind: 'string', default: '', group: 'core',
    oneLiner: 'focus/scope note for the run' },
  { name: 'includeTutorials', kind: 'bool', group: 'core', showInDefaults: true,
    oneLiner: 'also author tutorials (default false; expect more gate churn)' },

  // --- optional ---
  { name: 'board', kind: 'scalar', default: '.eatahorse-docs', group: 'optional', showInDefaults: true,
    oneLiner: 'Eatahorse board directory' },
  { name: 'workerModel', kind: 'scalar', default: 'sonnet', group: 'optional', showInDefaults: true,
    note: 'page authoring is real writing, not mechanical -> sonnet (model-routing.md)',
    oneLiner: 'model for page authors' },
  { name: 'maxRounds', kind: 'intClamped', default: 3, max: 10, group: 'optional', showInDefaults: true,
    note: 'clamp: keep author+sync+gate fan-out under the 1000-agent lifetime cap',
    oneLiner: 'author/gate rounds per run (default 3, clamped to 10)' },
  { name: 'filesPerPage', kind: 'scalar', default: 12, group: 'optional', showInDefaults: true,
    note: 'soft ceiling: split oversized modules at plan time so no author reads 40 files',
    oneLiner: 'split modules bigger than this into sub-pages' },
  { name: 'include', kind: 'scalar', default: '', group: 'optional',
    oneLiner: 'glob(s) to include' },
  { name: 'exclude', kind: 'scalar', default: '', group: 'optional',
    oneLiner: 'glob(s) to exclude' },
  { name: 'pages', kind: 'arrayFilter', var: 'explicitPages', group: 'optional',
    oneLiner: 'explicit page plan; skips the Plan stage' },
  { name: 'scriptPath', kind: 'scalar', default: 'plugins/workflow-kit/skills/eatahorse/scripts/eatahorse.py',
    group: 'optional', oneLiner: 'path to eatahorse.py' },
  { name: 'verify', kind: 'bool', group: 'optional', showInDefaults: true,
    note: 'opt-in build gate; default false (pulls deps, builds generated config). Starlight only',
    oneLiner: 'opt-in end-to-end build gate (Starlight only, needs pinned deps)' },
  { name: 'site', kind: 'stringTrim', default: null, group: 'optional',
    oneLiner: 'full production URL (e.g. https://docs.example.com)' },
  { name: 'basePath', kind: 'stringTrim', default: null, group: 'optional',
    oneLiner: 'subpath the site is served from (e.g. /docs)' },
  { name: 'i18n', kind: 'custom', group: 'optional',
    oneLiner: '{defaultLocale, locales[]} — enable multi-locale output' },
  { name: 'versioning', kind: 'custom', group: 'optional',
    oneLiner: '{current, versions?[]} — version label, mapped where supported' },

  // --- update mode (args.mode='update') ---
  { name: 'mode', kind: 'custom', default: 'fresh', group: 'update',
    oneLiner: "'fresh' (default) | 'update' (re-document an existing run)" },
  { name: 'updateMode', kind: 'custom', default: 'diff', group: 'update',
    oneLiner: "'diff' (default, changed source since `since`) | 'refine' (named pages)" },
  { name: 'since', kind: 'custom', default: 'HEAD~1', group: 'update',
    oneLiner: 'git ref for diff mode' },   // custom: charset-validated (interpolated into a git command in an agent prompt)
  { name: 'refine', kind: 'custom', group: 'update',
    oneLiner: '[{page, ask}] for refine mode' },
  { name: 'planNewModules', kind: 'bool', group: 'update',
    oneLiner: 'plan pages for new undocumented source (default false)' },
]
