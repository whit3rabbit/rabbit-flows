# Redocly

OpenAPI reference renderer (Redocly/redoc v2.x + Redocly CLI). Not a prose-page authoring
tool: the "pages" contract is replaced by `redocly.yaml` that points at an OpenAPI spec and
controls theming. Redocly renders the reference as a static HTML bundle or serves it locally;
no per-page MDX authoring is involved.

## Workflow

Redocly does not use a content-collection or per-page authoring workflow. The sole
deliverable is the renderer config.

1. **Obtain the OpenAPI spec** — locate or receive the spec path (`.yaml` / `.json`) from
   `args.sources`. This is the input; do NOT author MDX prose pages.
2. **Write `redocly.yaml`** — minimum shape:
   ```yaml
   apis:
     main@latest:
       root: <path-to-spec>   # relative to redocly.yaml
   theme:
     openapi:
       generateCodeSamples:
         languages: [curl, JavaScript, Python]
   ```
   If the brief names a custom theme, logo, or colors, add a `theme.colors` or `theme.logo`
   section. If `redocly.yaml` already exists, patch `apis.main@latest.root` and the `theme`
   block only; do NOT clobber other keys.
3. **Validate / build** — `npx @redocly/cli lint redocly.yaml` validates the config and spec.
   `npx @redocly/cli build-docs <spec>` produces a static `redoc-static.html`.

For a single narrow question read the current Redocly docs via find-docs / context7.

## Quick facts

- Config file: `redocly.yaml` at project root
- Input: an OpenAPI 3.x spec (`.yaml` or `.json`) referenced via `apis.<name>.root`
- CLI: `npm add -D @redocly/cli` (or `npx @redocly/cli`)
- Validate: `npx @redocly/cli lint redocly.yaml`
- Build static HTML: `npx @redocly/cli build-docs <spec> -o redoc-static.html`
- Preview server: `npx @redocly/cli preview-docs <spec>`
- content strategy: config-only — do NOT author MDX or prose pages

## Authoring guidance

- The OpenAPI spec is the source of truth. Do not author separate prose pages alongside it.
- `redocly.yaml` is patch-safe: always read it first and update only the keys your task touches;
  other teams may own separate API entries in the same config.
- `apis` key naming convention: `<name>@<version>` (e.g. `main@latest`). Use the briefed name
  or default to `main@latest`.
- Code samples default to curl, JavaScript, and Python; adjust `generateCodeSamples.languages`
  if the brief specifies different languages.
- `npx @redocly/cli lint` is the check that matters; it validates both the Redocly config and
  the OpenAPI spec for structural errors.
