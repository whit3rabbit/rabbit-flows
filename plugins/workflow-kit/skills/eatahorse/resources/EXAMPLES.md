# Eatahorse examples

## Start a new board

```bash
python scripts/eatahorse.py init "API Hardening" --goal "Reduce auth and input-validation risk before launch"
```

## Add a security task

```bash
python scripts/eatahorse.py add "Add fail-closed auth middleware" \
  --status ready \
  --priority P1 \
  --tag security \
  --bite "Trace current unauthenticated request path" \
  --bite "Add middleware skeleton" \
  --bite "Add negative-path tests" \
  --accept "Unauthenticated protected routes return 401" \
  --accept "Existing public routes still work"
```

## Work one bite

```bash
python scripts/eatahorse.py move EH-0001 doing
python scripts/eatahorse.py bite EH-0001 1 --done
python scripts/eatahorse.py next
```

## Add a bite after discovering more work

```bash
python scripts/eatahorse.py add-bite EH-0001 "Add regression test for missing bearer prefix"
```

## Sync after editing markdown manually

```bash
python scripts/eatahorse.py sync
```

## Drop a task without losing history

```bash
python scripts/eatahorse.py remove EH-0001
```

## Purge a task entirely

```bash
python scripts/eatahorse.py remove EH-0001 --purge
```

## Read board status

```bash
python scripts/eatahorse.py report
python scripts/eatahorse.py list --status doing
cat .eatahorse/board.md
```

## Port a codebase (comprehend → grounded execute)

A port is two workflow runs sharing the board substrate — no `eatahorse-port` workflow. Stage 1 builds a
cross-file `inventory.json`; stage 2 reads it and seeds one port card per source unit in dependency order.

```text
# Stage 1 — comprehend (read-only). extract:'port' adds a structured JSON block to each card's
# Notes and a Graph phase that writes inventory.json (api surface, dep edges, topoOrder, cycles).
Workflow({ name: "eatahorse-research", args: {
  root: "src", extract: "port",
  out: "port-study.md", inventory: "port-study.inventory.json",
  board: ".eatahorse-port-study"
}})

# Stage 2 — grounded execute. grounding=<inventory.json>. Decompose reads it and seeds port cards
# (priority = topo band P00=leaf, ported first; each linked to its source via --external-id source:<path>).
# execute:true makes UNATTENDED edits — confirm before launching.
Workflow({ name: "eatahorse", args: {
  goal: "Port src to Rust",
  grounding: "port-study.inventory.json",
  targetLang: "Rust", targetDir: "rust/src",
  preserveApi: "the public functions in src/api.py",
  testCmd: "cargo test",          // behavior-parity acceptance + auto run-constraint (kept green)
  execute: true,
  board: ".eatahorse-port-rust"
}})
```

Each port card's acceptance names a real evidence surface: the project compiles, the public API matches the
inventory, and `cargo test` passes. The completion gate re-runs those before a card stays done; a forced
compile/test failure reopens it. Without a `testCmd`, behavior parity is only locally checkable per card.

Resume: re-point stage 2 at an existing `inventory.json` (skip stage 1) and/or an in-progress `board`.
