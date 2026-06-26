---
name: eatahorse-port
description: Front door for pipelining a code port from one language to another. Use when the user wants to port/translate/rewrite a source tree into another language and overlap comprehension with porting, says "port this codebase to <lang>", "pipeline a port", "translate this repo to rust/go/typescript", "rewrite this in <lang>", or "/eatahorse-port". Runs a short discussion (source folder, target language, target dir, test command) then launches the `eatahorse-port-pipeline` workflow with the answers. NOT for documenting a codebase (use document-codebase) and NOT for a one-file translation.
---

# Eatahorse port (discussion → port-pipeline workflow launch)

Conversational front door to the `eatahorse-port-pipeline` workflow. The workflow runs in the
background with no way to ask the user anything mid-run, so the discussion happens HERE first; the
answers are passed to the workflow as an `args` OBJECT (never a string — a stringified or
comma-separated blob makes the workflow bail with "root, targetLang, and targetDir are required").

This is the most expensive, most speculative workflow in the kit. Validate on a TINY slice before
trusting a full-tree run, and say so to the user.

Artifacts: the port board (`.eatahorse-port`), comprehend board (`.eatahorse-comprehend`), and
`<root>.inventory.json` can be git ignored unless the user wants them tracked.

## Steps

1. **Get the source + target.** Take what you can from the invocation. If missing, ask plainly.

2. **Run the discussion.** Use `AskUserQuestion` for the choice fields (batch them — max 4 per call);
   ask the free-text ones plainly. Offer defaults so the user can skip. Do NOT interrogate.

   Required (the workflow bails without all three):
   - **root**: source folder to port (free-text, e.g. `bs4` or `src/`).
   - **targetLang**: `AskUserQuestion` — Rust · Go · TypeScript · Python · (Other = free text).
   - **targetDir**: where ported files go (free-text, e.g. `rust-port`). Must not collide with `root`.

   Optional (omit if the user skips — the workflow defaults them):
   - **testCmd**: a proving command passed through as a port constraint (e.g. `cargo test`). Free-text.
   - **workerModel**: `AskUserQuestion` — sonnet (default) · haiku (cheaper) · opus (hardest ports).

   Leave `board` / `researchBoard` / `inventory` / `question` / `maxRounds` / `maxTokens` /
   `budgetFloor` / `scriptPath` to the workflow defaults unless the user explicitly asks.

3. **Preview, then STOP for confirmation, then launch.** Show a compact preview of the `args` you are
   about to pass (at least `root`, `targetLang`, `targetDir`) so a wrong `targetDir` or `root` is
   caught before a heavy, filesystem-writing run starts. Then STOP and wait for an explicit "yes". Do
   NOT call `Workflow` in the same turn as the preview. Only after the user confirms, call the
   `Workflow` tool with `name: "eatahorse-port-pipeline"` and an `args` OBJECT built from the answers.
   Pass only what was gathered; omit the rest.

   ```
   Workflow({ name: "eatahorse-port-pipeline", args: {
     root, targetLang, targetDir,
     testCmd, workerModel,   // omit either if not gathered
     // optional knobs the user may set:
     // board (port board, default .eatahorse-port),
     // researchBoard (comprehend board, default .eatahorse-comprehend),
     // inventory (default <root>.inventory.json),
     // maxRounds (scheduler round cap, default 60),
     // maxTokens (per-run output-token ceiling, default none),
     // budgetFloor (stop opening rounds below this many remaining tokens, default 50000)
   }})
   ```

4. **Hand back** the workflow's result (ported count, what remains active, the inventory path) AND the
   equivalence reminder below.

## Equivalence is NOT verified here

The pipeline ports files but does NOT prove behavioral parity. After it finishes, tell the user to run
a separate equivalence pass against the cleared port board:

```
eatahorse grounding="<root>.inventory.json" verifyEquivalence:true verifyOnly:true
```

(`verifyOnly` skips the 0-active bail so it runs against the cleared board.)

## Notes

- This file is the portable, marketplace-shipped copy of the front-door role. It pairs with the
  `eatahorse-port-pipeline` workflow in `.claude/workflows/eatahorse-port-pipeline.js`.
- The skill name and the workflow `meta.name` are independent registries; they need not match.
