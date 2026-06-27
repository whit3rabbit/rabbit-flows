# Rabbit Flow graph schema

The data contract the Visual Workflow Designer (`frontend/`) uses to represent a
`.claude/workflows/*.js` script as a ReactFlow graph. One canonical source — `frontend/src/schema.js` —
owns the vocabularies, the per-kind connection points, the connection rules, a Draft-07 JSON Schema,
and a dependency-free `validateGraph()`. The renderer (`visual.js`/`nodes.js`), the parser
(`parser.js`), and the code generator (`codegen.js`) all conform to it. `node frontend/test-schema.mjs`
proves every committed workflow parses to a conformant graph.

This doc is generated knowledge, not a second source of truth — when it disagrees with
`schema.js`, the code wins. Regenerate the tables from `schema.js` if you change it.

## Two shapes, one graph

The designer carries the graph in a compact **internal shape** and projects it to the
**ReactFlow shape** for rendering (`graph.js` `toRFNodes`/`toRFEdges`). The internal shape is what
the parser emits, the library stores, and `validateGraph()` checks; the projection is mechanical.

```
internal node  {id, kind, label, model, schema, phase, detail, body, x, y, w, h}
        │  toRFNodes (graph.js)
        ▼
ReactFlow node {id, type:<kind>, position:{x,y}, style:{width,height},
                connectable, zIndex, data:{kind,label,model,schema,phase,detail,body}}

internal edge  {id, from, to, type}
        │  toRFEdges (graph.js)
        ▼
ReactFlow edge {id, source:<from>, target:<to>, type, animated, style, markerEnd, data:{kind:<type>}}
```

"Populating data for easy editing" = the `data` object. Every editable field (label, model,
schema name, phase, detail/body text) lives there; the inspector reads and patches `data`, and
`position`/`style` carry placement. Nothing the editor needs is stored outside `data` +
`position` + `style`, so a node round-trips through import/export without loss of editability.

## Node kinds

Nine kinds. `agent`/`gate`/`parallel` are what the parser produces from real workflow source;
the rest (`trigger`, `knob`, `loop`, `phase`, `skill`) are palette nodes for hand-authoring, and
`lossy` is the placeholder for a construct the parser could not read. Default size is `DIMS[kind]`.

| kind | role | color | default w×h | handles (points) | direction |
|---|---|---|---|---|---|
| `trigger` | entry / slash command | `#f472b6` | 196×48 | 1 | source only (Bottom) |
| `agent` | one `agent()` worker | `#5b9dff` | 234×84 | 2 | target Top + source Bottom |
| `gate` | verifier / admission `agent()` | `#f5a524` | 234×84 | 2 | target Top + source Bottom |
| `parallel` | `parallel()` fan-out box | `#a855f7` | 300×180 | 2 (hidden) | flow threads through the box |
| `loop` | loop / Ralph container | `#2dd4bf` | 320×226 | 2 (hidden) | flow threads through the box |
| `phase` | `phase()` group marker | `#94a3b8` | 240×44 | 1 | target only (Top) |
| `skill` | a `requires-skills` skill | `#34d399` | 184×60 | 2 | side source (Right) + hidden target (Left) |
| `knob` | an `args.*` config value | `#38bdf8` | 200×96 | 2 | side source (Right) + hidden target (Left) |
| `lossy` | unparsed section | `#f5a524` | 280×60 | 2 | target Top + source Bottom |

"Number of node points" = the **handles** column. Containers (`parallel`/`loop`) are
`connectable:false` interactively, but the parser still threads a flow edge through the box
(`prev → container → lane`), so they are modeled with two hidden handles. `trigger` and `phase`
are intentionally one-directional: a trigger cannot be a target, a phase cannot be a source.

## Edge types

| type | meaning | style |
|---|---|---|
| `flow` | execution order (the spine), and container ↔ lane fan-out | solid, animated, `#5b6675` |
| `loop` | back-edge from a later step to an earlier one inside a loop | curved, animated, `#2dd4bf` |
| `skill` | a skill node attaches to the agent/gate that invokes it | dashed, `#34d399` |
| `data` | a knob feeds a config value into an agent/gate/container | dashed, `#38bdf8` |

## Connection rules (which kind → which kind)

An edge is legal iff its **source kind** is in the type's `sources` and its **target kind** is in
its `targets` (`CONNECTION_RULES` in `schema.js`). The canvas enforces this two ways:
`isValidConnection` rejects an illegal drag, and `onConnect` picks the edge type from the endpoint
kinds (`edgeTypeFor`): a `skill` source → skill edge, a `knob` source → data edge, otherwise flow.

| edge type | allowed sources | allowed targets |
|---|---|---|
| `flow` | trigger, agent, gate, parallel, loop | agent, gate, parallel, loop, phase, lossy |
| `skill` | skill | agent, gate |
| `data` | knob | agent, gate, parallel, loop |
| `loop` | agent, gate, loop | agent, gate, loop, phase |

`loop` is not auto-assigned when drawing (it shares endpoint kinds with `flow` and can't be told
apart from kinds alone); loop-back edges are created deliberately by the parser / a loop container.
`validateGraph()` still accepts a `loop` edge if one is present.

## JSON Schema

`GRAPH_JSON_SCHEMA` in `schema.js` is the Draft-07 document (for external tooling). Shape:

```jsonc
{
  "type": "object",
  "required": ["nodes", "edges"],
  "properties": {
    "meta":  { "name": "string|null", "description": "string|null", "phases": "string[]" },
    "nodes": [ {
      "id": "string",                 // required, unique
      "kind": "trigger|knob|agent|gate|parallel|loop|phase|skill|lossy",
      "label": "string",
      "model": "opus|sonnet|haiku|null",
      "schema": "string|null",        // SCREAMING_CASE schema const name
      "phase": "string|null",         // phase() group this node belongs to
      "detail": "string|null", "body": "string|null",
      "x": 0, "y": 0, "w": 234, "h": 84   // numbers, required
    } ],
    "edges": [ { "id": "string", "from": "<nodeId>", "to": "<nodeId>", "type": "flow|loop|skill|data" } ]
  }
}
```

`validateGraph(graph)` checks all of the above plus the connection rules and that every edge
endpoint references an existing node. It returns `{ ok, errors: [{where, msg}] }` and is the runtime
gate the tests use. It is hand-rolled (no ajv) because the frontend ships zero runtime dependencies.

## Commonalities across the 10 workflows

Parsing every `.claude/workflows/*.js` (the `validateGraph` test corpus) shows how little of the
vocabulary real workflows actually use, and confirms the shared spine:

| workflow | phases | nodes | agent | gate | parallel | lossy |
|---|---|---|---|---|---|---|
| starter | 4 | 5 | 3 | 1 | 1 | 0 |
| eatahorse | 8 | 11 | 9 | 1 | 1 | 0 |
| eatahorse-research | 8 | 13 | 10 | 1 | 2 | 0 |
| eatahorse-port-pipeline | 2 | 3 | 2 | 0 | 1 | 0 |
| scaffold | 12 | 12 | 10 | 0 | 2 | 2 |
| security-audit | 8 | 17 | 11 | 1 | 5 | 0 |
| docs-create | 6 | 10 | 8 | 1 | 1 | 0 |
| docs-from-code | 14 | 27 | 22 | 2 | 3 | 0 |
| docs-migrate | 7 | 11 | 9 | 2 | 0 | 0 |
| docs-scrape | 4 | 9 | 7 | 2 | 0 | 0 |

Totals across the corpus: **91 agent, 16 parallel, 11 gate** nodes; **108 flow edges**; zero
`loop`/`skill`/`data`/`trigger`/`knob`/`phase` nodes or edges. Findings:

- **The parser uses a 3-kind / 1-edge-type subset.** Real workflows decompose to `agent()` workers,
  `parallel()` fan-outs, and `agent()`s whose label matches `/gate/i` (→ `gate`), wired by sequential
  `flow` edges. That subset is the reusable core every workflow shares — it is the spine from
  `CLAUDE.md` (decompose → parallel workers → admission gate → synthesize) made concrete.
- **`phase` is an attribute, not a node.** `meta.phases[]` and each node's `phase` field carry the
  grouping; the parser does not emit standalone phase nodes (the palette `phase` node is for
  hand-authoring only). Every workflow declares phases; they are the natural swim-lane grouping.
- **Loops don't round-trip.** `scaffold.js`'s two `lossy` entries are `parallel(...)` calls with no
  literal `agent()` lane the heuristic parser can see (dynamic/Ralph-style construction). This is a
  parser limitation, documented in `frontend/CLAUDE.md` "Parse limitations" — not a workflow defect,
  so no workflow was changed. A loop container in the designer regenerates a `while` scaffold
  (`codegen.js`), but parsing that loop back is lossy.
- **Models cluster by stage**, matching `model-routing.md`: haiku for fan-out workers, opus for
  decompose/gate/synthesis, sonnet for the workhorse middle. Stored per node in `data.model`.

No workflow needed editing to fit the schema: all 10 already conform. The schema was fit to the
workflows, not the other way around.

## Validate / test

```bash
cd frontend
node test-parser.mjs    # parser self-checks (27 assertions)
node test-schema.mjs    # schema self-checks: all 10 workflows conform + rule/handle/validator checks
npm test                # runs both
npm run lint            # eslint (browser src vs node split)

python3 validate_graph.py --selftest   # stdlib Python mirror of validateGraph() — same rule/handle checks
python3 validate_graph.py graph.json   # validate a designer-export graph JSON (or pipe via stdin)
```

`test-schema.mjs` is the JS validation gate: it parses every committed workflow and asserts
`validateGraph()` passes, then exercises the handle counts, the connection rules (legal pairs
accepted, illegal rejected), and that the validator rejects malformed graphs.

`validate_graph.py` is a dependency-free Python port of `validateGraph()` for CI / non-Node tooling
(the Dockerfile already ships python3). To confirm the two implementations agree on real data, export
the parsed graphs from Node and pipe each through the script:

```bash
cd frontend
node -e 'import("./parser.js").then(async ({parseWorkflow})=>{const{readFileSync,readdirSync,writeFileSync,mkdirSync}=await import("node:fs");mkdirSync("/tmp/graphs",{recursive:true});for(const f of readdirSync("../.claude/workflows").filter(f=>f.endsWith(".js"))){const g=parseWorkflow(readFileSync(`../.claude/workflows/${f}`,"utf8"));writeFileSync(`/tmp/graphs/${f}.json`,JSON.stringify({meta:g.meta,nodes:g.nodes,edges:g.edges}));}})'
for j in /tmp/graphs/*.json; do python3 validate_graph.py "$j"; done   # all 10 -> ok
```
