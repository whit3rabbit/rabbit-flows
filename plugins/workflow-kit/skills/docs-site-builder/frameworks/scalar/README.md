# Scalar

OpenAPI reference renderer (scalar/scalar v1.x). Not a prose-page authoring tool: the
"pages" contract is replaced by a single `scalar.config.json` that points at an OpenAPI
spec. Scalar renders the reference UI client-side in a browser; no build artifact is produced.

## Workflow

Scalar does not use a content-collection or per-page authoring workflow. The sole
deliverable is the renderer config.

1. **Obtain the OpenAPI spec** — locate or receive the spec path (`.yaml` / `.json`) from
   `args.sources`. This is the input; do NOT author MDX prose pages.
2. **Write `scalar.config.json`** — minimum shape:
   ```json
   {
     "openapi": "<path-to-spec>",
     "info": { "title": "<API title from spec or brief>" },
     "servers": []
   }
   ```
   If the spec is a URL, use `"url"` instead of `"openapi"` for the path.
3. **Serve** — any static file server works (`npx @scalar/cli serve scalar.config.json`).
   No local build step; validation is optional via `npx scalar validate scalar.config.json`.

For a single narrow question read the current Scalar docs via find-docs / context7.

## Quick facts

- Config file: `scalar.config.json` at project root
- Input: an OpenAPI 3.x spec (`.yaml` or `.json`) or a URL
- Install (optional): `npm add @scalar/api-reference` or `npm add @scalar/cli`
- Serve: `npx @scalar/cli serve scalar.config.json`
- Validate (optional): `npx scalar validate scalar.config.json`
- No build artifact: Scalar renders client-side; deploy by serving the static assets + config
- content strategy: config-only — do NOT author MDX or prose pages

## Authoring guidance

- The OpenAPI spec is the source of truth. Do not author separate prose pages alongside it.
- `scalar.config.json` is minimal: just `openapi` (file path) or `url` (remote spec), `info.title`,
  and `servers`. Add theme keys only if the brief calls for customization.
- If the spec already exists elsewhere in the repo, reference it with a relative path; do not copy it.
- Validation errors surface as JSON parse failures or CLI warnings; `scalar validate` is the check
  that matters when the CLI is available.
