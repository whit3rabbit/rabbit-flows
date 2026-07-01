# Scaffold Workflow

The `scaffold` workflow starts a new project from scratch. It leads a discussion to refine a design brief, researches required dependencies, runs parallel independent blind architecture proposals, debates the options, merges them at a decision gate, and then generates stub files for the entire project tree.

## Overview

Associated skills:
- **`new-project`** (Front-door skill): Gathers conversational requirements, languages, target structures, and sets parameters.
- **`architect`** (Specialist dependency): Generates candidate architecture designs and stub structures.

---

## `scaffold`

### Args

| Key | Type | Meaning |
|---|---|---|
| `brief` | `string` | High-level project goal/description. Also accepts a bare string: `/scaffold <brief>`. |
| `dir` | `string` | Output directory path. Default `./scaffold-out`. Must be a new subdirectory (cannot write to `.`, `~`, or parent/traversal paths). Set `allowAbsoluteDir:true` to override. |
| `write` | `boolean` | Default `true`. If `false`, stops after the architecture decision (dry run; no files are written). |
| `verify` | `boolean` | Default `false`. If `true`, runs the generated installation, compile, build, and test scripts (runs generated code). |
| `attempts` | `number` | Number of independent architecture proposals drafted before the merge decision. Default `2`, max `6`. |
| `debate` | `boolean` | Default `false`. If `true`, runs one blind debate round where architects review/rebut each other's proposals before merging. |
| `polish` | `boolean` | Default `false`. If `true`, runs a clean-up round (e.g. checks duplication, API compliance, and import matching). |
| `maxFileLines` | `number` | Line count cap per generated source stub. Default `400` (range `80` to `1000`). |
| `interface` | `string` | Target UI: `cli`, `tui`, `gui`, `library`, `service`, `unspecified`. |
| `targetOS` | `string \| string[]` | Target OS(es). Default `cross-platform`. |
| `language` | `string` | Language or runtime framework. Default: selected automatically by the model. |
| `license` | `string` | Project license identifier (e.g. `MIT`). |
| `publish` | `boolean` | Whether the project is intended for public publishing. Default `false`. |
| `apiSurface` | `string` | Public interface or API surface details. |
| `priorArt` | `string` | Existing codebases or inspiration notes. |
| `frontend` | `boolean` | Explicitly flag whether a frontend is involved. |
| `backend` | `boolean` | Explicitly flag whether a backend is involved. |
| `deps` | `string` | Preferred dependencies or package manager instructions. |

### Example

```json
/scaffold {
  "brief": "A CLI tool in Go for compressing files",
  "dir": "./gz-cli",
  "write": true,
  "verify": true,
  "attempts": 3,
  "debate": true
}
```

---

## Safe Execution Defaults

> [!IMPORTANT]
> By default, `verify` is set to `false`. This prevents the workflow from executing any of the newly generated code, package installers, or build commands. Set `verify: true` only when you trust the generated dependency definitions and build setup.
