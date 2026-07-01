# Eatahorse Workflows

The `eatahorse` ecosystem provides a two-phase system to decompose complex goals into trackable tasks on a Kanban board, and then execute those tasks unattended in a verification-gated loop.

## Overview

The system consists of three workflows:
1. **`eatahorse`**: The main orchestrator that plans first, then optionally executes the work.
2. **`eatahorse-plan`**: The planning phase that decomposes a goal into tasks on a Kanban board and gates the plan for soundness.
3. **`eatahorse-execute`**: The execution phase that works the board one card at a time in a Ralph-style loop, verifying each change.

All three workflows consume the **`eatahorse`** skill, which provides the CLI and Python backend utilities (`eatahorse.py`) to manage the Kanban board.

---

## `eatahorse`

Thin orchestrator workflow that sequentially runs the planning phase and (if requested) the execution phase.

### Args

| Key | Type | Meaning |
|---|---|---|
| `goal` | `string` | The objective to break down. Also accepts a bare string: `/eatahorse <goal>`. |
| `execute` | `boolean` | Default `false`. If `true`, runs the unattended Ralph loop to execute tasks. |
| `board` | `string` | Board directory path. Default `.eatahorse`. |
| `maxIterations` | `number` | Hard cap on the number of execution loop runs. Default `40`, max `200`. |
| `workerModel` | `string` | Model to use for execution workers. Default `sonnet`. |
| `scriptPath` | `string` | Path to `eatahorse.py`. Default: uses the bundled skill copy. |
| `constraints` | `string[]` | Project-wide constraints or board invariants to enforce. |
| `inventory` | `string` | Path to `map_codebase.py` JSON output for richer planning context. |

### Example

```json
/eatahorse {
  "goal": "Add OAuth login",
  "execute": true
}
```

---

## `eatahorse-plan`

Decomposes a goal into a Kanban board, seeds tasks, and gates the plan for soundness. It does not write code or perform edits.

### Args

| Key | Type | Meaning |
|---|---|---|
| `goal` | `string` (required) | The objective to break down. |
| `board` | `string` | Board directory path. Default `.eatahorse`. |
| `inventory` | `string` | Path to `map_codebase.py` JSON output. |
| `scriptPath` | `string` | Path to `eatahorse.py`. |
| `constraints` | `string[]` | Constraints to feed into the decomposer. |

### Example

```json
/eatahorse-plan {
  "goal": "Refactor error handling in src/pdf.rs",
  "inventory": "./inventory.json"
}
```

---

## `eatahorse-execute`

Works through an existing Eatahorse Kanban board. In each iteration, it selects the next active task, spawns a worker, applies changes, runs verification gates, and updates the board.

### Args

| Key | Type | Meaning |
|---|---|---|
| `board` | `string` (required) | Board directory path to run execution on (e.g. `.eatahorse`). |
| `maxIterations` | `number` | Loop iteration limit. Default `40`. |
| `workerModel` | `string` | Model for code-writing workers. Default `sonnet`. |
| `maxTokens` | `number` | Output token ceiling per run. |
| `budgetFloor` | `number` | Minimum remaining tokens required to continue. |
| `scriptPath` | `string` | Path to `eatahorse.py`. |
| `constraints` | `string[]` | Constraints to guide the workers. |

### Example

```json
/eatahorse-execute {
  "board": ".eatahorse",
  "maxIterations": 10
}
```
