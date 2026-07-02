# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
