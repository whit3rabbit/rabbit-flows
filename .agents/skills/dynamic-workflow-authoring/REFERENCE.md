# Dynamic workflows — runtime API reference

Full signatures for the script body. Sourced from the Workflow tool contract and the bundled
`/deep-research` script (see `references/deep-research.js`). SKILL.md has the quick start; this is
the lookup table plus the patterns worth copying.

## The `meta` block (required, first thing in the script)

```js
export const meta = {
  name: 'kebab-name',                  // becomes /kebab-name when saved
  description: 'One line shown in the approval dialog and workflow list.',
  whenToUse: 'Optional — shown in the workflow list.',
  phases: [{ title: 'Scope' }, { title: 'Verify', model: 'opus' }],   // optional
}
```

- MUST be a **pure literal**: no variables, function calls, spreads, or template interpolation.
- Required: `name`, `description`. Optional: `whenToUse`, `phases`, `model`.
- `phases` titles must match `phase()` calls exactly — that's how agents get grouped in the progress view.
  A `phase()` with no matching `meta.phases` entry still gets its own group box.

## Hooks

| Hook | Signature | Notes |
|---|---|---|
| `agent` | `agent(prompt, opts?) → Promise<any>` | With `schema` → validated object (model retries on mismatch). Without → final text string. `null` on user-skip or terminal error. |
| `parallel` | `parallel(thunks: (()=>Promise)[]) → Promise<any[]>` | **Barrier.** Awaits all. A throwing thunk → `null` in the array (never rejects). `.filter(Boolean)` after. |
| `pipeline` | `pipeline(items, ...stages) → Promise<any[]>` | **No barrier.** Each item flows through all stages independently. Stage cb gets `(prevResult, originalItem, index)`. A throwing stage drops that item to `null`. |
| `phase` | `phase(title: string) → void` | Starts a progress group for subsequent `agent()` calls. |
| `log` | `log(message: string) → void` | Narrator line above the progress tree. |
| `args` | global value | Passed verbatim at invocation. String / array / object / `undefined`. Call `.map`/`.filter` directly — it's real JSON, not a string. |
| `budget` | `{ total: number\|null, spent(): number, remaining(): number }` | `total` is the turn's token target (null if unset). HARD ceiling — `agent()` throws once `spent() >= total`. Shared pool across main loop + workflows. |
| `workflow` | `workflow(nameOrRef, args?) → Promise<any>` | Run another workflow inline (saved name, or `{scriptPath}`). One level only — nesting throws. Shares the run's caps + budget. |

## `agent` options

| Option | Type | Use |
|---|---|---|
| `label` | string | Display name in the progress view. |
| `phase` | string | Explicitly assign to a progress group. **Use this inside `pipeline`/`parallel` stages** so concurrent stages don't race the global `phase()` state. |
| `schema` | JSON Schema | Forces a StructuredOutput tool call; `agent()` returns the validated object. No parsing needed. |
| `model` | `'haiku'\|'sonnet'\|'opus'\|...` | Override per call. **Omit to inherit the session model** (the right default for decompose/gate/synthesize). |
| `effort` | `'low'..'max'` | Reasoning effort. `'low'` for mechanical stages; higher only for the hardest verify/judge. |
| `isolation` | `'worktree'` | Fresh git worktree. EXPENSIVE — only when agents mutate files in parallel and would conflict. |
| `agentType` | string | Use a registered subagent type instead of the default. Resolves ONLY session-registered agents (built-ins + `<plugin>:<name>`); composes with `schema`. |

## Limits, save, resume

- **Concurrency:** `min(16, cores-2)` agents at once; excess queues. **Total:** 1000 agents/run. **Per call:** ≤4096 items.
- **No mid-run user input.** Only agent permission prompts pause a run. For sign-off between stages, run each stage as its own workflow.
- **Save:** `/workflows` → select run → `s`. `.claude/workflows/` (repo, shared by clone) or `~/.claude/workflows/` (personal). Saved → runs as `/<name>`.
- **Invoke with input:** `Run /name on <args>` — Claude passes structured `args`. Or `Workflow({name, args})`.
- **Resume (same session only):** each invocation persists its script under the session dir and returns the path. Relaunch with `{scriptPath, resumeFromRunId}` — unchanged `agent()` calls return cached results; the first edited/new call and everything after runs live. Exiting Claude Code loses resumability.

## Patterns worth copying (from deep-research)

### pipeline() with in-stage dedup, no barrier
Stage 1 searches; stage 2 dedups against shared closure state and fans out fetches. The dedup is
**plain code inside a stage**, not an agent — item A can be fetching while item B is still searching.

```js
const seen = new Map(); let slots = MAX_FETCH
const results = await pipeline(
  angles,
  angle => agent(SEARCH(angle), { label:`search:${angle.label}`, phase:'Search', schema:SEARCH_SCHEMA }),
  search => {                                   // dedup is code, not an agent; mutate closure state
    const novel = search.results.filter(r => {
      const k = normURL(r.url)
      if (seen.has(k) || slots <= 0) return false
      seen.set(k, true); slots--; return true
    })
    return parallel(novel.map(src => () =>      // nested fan-out inside the stage
      agent(FETCH(src), { label:`fetch:${host(src)}`, phase:'Fetch', schema:EXTRACT_SCHEMA })))
  }
)
const sources = results.flat().filter(Boolean)
```

### Adversarial N-vote verify (the quality gate)
Spawn N skeptics per claim, each prompted to REFUTE; kill on a quorum of refutations. Diversity is
the point — give voters distinct lenses for richer coverage.

```js
const voted = (await parallel(claims.map(claim => () =>
  parallel(Array.from({ length: VOTES }, (_, v) => () =>
    agent(VERIFY(claim, v), { label:`v${v}`, phase:'Verify', schema:VERDICT })))
  .then(verdicts => {
    const valid = verdicts.filter(Boolean)     // a vote can be null → abstain
    const refuted = valid.filter(v => v.refuted).length
    // survive only if actually adjudicated: quorum of valid votes AND under the refute threshold.
    // all-abstain must NOT pass (refuted=0 would falsely survive).
    const survives = valid.length >= REQUIRED && refuted < REQUIRED
    return { ...claim, survives }
  })))).filter(Boolean)
```

### Defensive returns — salvage at every failure point
deep-research never throws away a run. Each stage that can come back empty returns a structured
result instead: no question → error; no claims → fetched-but-empty summary; all refuted → inconclusive;
synthesis skipped → return the verified claims raw. Mirror this: a workflow's worst output is a crash
that discards completed work.

### Other habits from the canonical script
- **Tunable constants at the top** (`VOTES_PER_CLAIM`, `MAX_FETCH`, `MAX_VERIFY_CLAIMS`) — easy to tune, easy to test on a small slice.
- **Schemas as named consts** up top, reused across prompts; set `additionalProperties:false`.
- **Rank then slice** before an expensive stage (`.sort(...).slice(0, MAX)`) to bound cost.
- **`log()` the drops** — dupes filtered, budget-dropped, abstentions. Silent truncation reads as "covered everything" when it didn't.
- **Comment WHERE a barrier is intentional** — e.g. "claim pool must be fully assembled before ranking", so the one `parallel()` among `pipeline()`s reads as a choice.

## Gotchas (verified)

- No `Date.now()` / `Math.random()` / argless `new Date()` — they throw. Pass time via `args`; vary by index.
- No filesystem/shell from the script — only agents. Write durable knowledge back via a finalize-stage agent.
- Plain JS, not TS. Top-level `await`/`return` are legal (runtime wraps in async fn); `node --check` "illegal return" warning is expected.
- `agentType` and `skills`: no `skills` option exists; `agentType` resolves only already-registered agents. Put the worker's full contract inline in its prompt.
- Verify a new/unfamiliar API signature with a 1-agent probe workflow before building several on top of it.
