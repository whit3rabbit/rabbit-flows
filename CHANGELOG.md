# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-07-28

### Security

- Resolved all open Dependabot alerts by updating transitive dependencies in the
  `frontend/` and `docs/` lockfiles:
  - `postcss` 8.5.15 -> 8.5.24 (GHSA-r28c-9q8g-f849, high) in both.
  - `js-yaml` 4.2.0 -> 4.3.0 (GHSA-52cp-r559-cp3m, high) in both.
  - `brace-expansion` 1.1.15 -> 1.1.16 (GHSA-3jxr-9vmj-r5cp, high) in `frontend/`.
  - `nanoid` 3.3.15 -> 3.3.16 pulled in alongside `postcss`.
- No production dependency of the published package changed; both affected
  lockfiles cover dev/site tooling only.

### Known issues

- `npm audit` still reports `brace-expansion` GHSA-mh99-v99m-4gvg in `frontend/`
  via `eslint` -> `minimatch`. No patched version of `brace-expansion` exists for
  that advisory, so it is unfixable today. It is dev-only lint tooling and is not
  reachable from any shipped code path.

## [0.1.1] - 2026-07-02

### Added

- `CHANGELOG.md`.
- Documented the release process in `CLAUDE.md`: run `act` locally and update
  this changelog before tagging a release.

## [0.1.0] - 2026-07-02

### Added

- Initial public release of the `rabbit-flows` npx installer for Claude Code
  dynamic workflows: `eatahorse` / `eatahorse-plan` / `eatahorse-execute`,
  `security-audit`, `docs-from-code`, `docs-create`, `docs-migrate`,
  `docs-scrape`, `scaffold` (plus `starter.js` as an uninstalled reference
  example).
- Bundle import/export handshake between the Visual Flow Designer and the
  installer (`rabbit-flows import <bundle.zip>`).
- Visual Flow Designer (`frontend/`), publishable as a Docker image
  (`followthewhit3rabbit/rabbit-flow-designer`) or run locally with
  `npm run designer`.
- CI: manifest/skill drift gates, recon self-checks (stdlib + tree-sitter),
  plugin manifest validation; release automation (npm publish via OIDC
  trusted publishing, GitHub release, Docker image) on `v*` tag push.
