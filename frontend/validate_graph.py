#!/usr/bin/env python3
"""validate_graph.py — stdlib Python port of src/schema.js validateGraph().

Validates a Rabbit Flow graph JSON ({meta?, nodes[], edges[]}) — e.g. a designer
export or any graph piped from non-Node tooling — against the same node-kind /
edge-type vocabularies and connection rules the canvas enforces.

Source of truth is frontend/src/schema.js; this is a hand-kept mirror (9 kinds, 4 edge
types — small and stable). `--selftest` re-runs the same rule/handle/validator checks as
test-schema.mjs; to confirm the two agree on real data, export the parsed workflow graphs
from Node and pipe each through this script (see docs/flow-schema.md "Validate / test").

Usage:
    python3 validate_graph.py graph.json        # validate a file
    cat graph.json | python3 validate_graph.py  # validate stdin
    python3 validate_graph.py --selftest        # run embedded checks
Exit 0 = valid, 1 = invalid / error.
"""
import json
import sys

# --- mirror of src/schema.js (keep in sync) --------------------------------
NODE_KINDS = ["trigger", "knob", "agent", "gate", "parallel", "loop", "phase", "skill", "lossy"]
EDGE_TYPES = ["flow", "loop", "skill", "data"]
MODELS = ["opus", "sonnet", "haiku"]

# CONNECTION_RULES[type] = (allowed source kinds, allowed target kinds)
CONNECTION_RULES = {
    "flow":  (["trigger", "agent", "gate", "parallel", "loop"],
              ["agent", "gate", "parallel", "loop", "phase", "lossy"]),
    "skill": (["skill"], ["agent", "gate"]),
    "data":  (["knob"], ["agent", "gate", "parallel", "loop"]),
    "loop":  (["agent", "gate", "loop"], ["agent", "gate", "loop", "phase"]),
}

# HANDLES[kind] = list of (id, type, pos[, hidden]) — connection points, mirroring nodes.js.
HANDLES = {
    "trigger":  [("s", "source", "Bottom")],
    "phase":    [("t", "target", "Top")],
    "agent":    [("t", "target", "Top"), ("s", "source", "Bottom")],
    "gate":     [("t", "target", "Top"), ("s", "source", "Bottom")],
    "lossy":    [("t", "target", "Top"), ("s", "source", "Bottom")],
    "knob":     [("s", "source", "Right"), ("t", "target", "Left", True)],
    "skill":    [("s", "source", "Right"), ("t", "target", "Left", True)],
    "parallel": [("t", "target", "Top", True), ("s", "source", "Bottom", True)],
    "loop":     [("t", "target", "Top", True), ("s", "source", "Bottom", True)],
}
# ---------------------------------------------------------------------------


def handle_count(kind):
    return len(HANDLES.get(kind, []))


def edge_type_for(source_kind, target_kind):
    """The edge type a (source -> target) connection should be, or None if illegal.
    skill/data win by distinctive source kind; else flow. 'loop' is not auto-assigned."""
    for t in ("skill", "data", "flow"):
        srcs, tgts = CONNECTION_RULES[t]
        if source_kind in srcs and target_kind in tgts:
            return t
    return None


def connection_allowed(source_kind, target_kind):
    return edge_type_for(source_kind, target_kind) is not None


def _is_number(v):
    # JSON has no separate int/float; bool is an int subclass, exclude it.
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_graph(graph):
    """Return (ok: bool, errors: list[(where, msg)]). Mirrors schema.js validateGraph."""
    errors = []

    def E(where, msg):
        errors.append((where, msg))

    if not isinstance(graph, dict):
        return False, [("graph", "not an object")]
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return False, [("graph.nodes", "missing or not an array")]
    edges = graph.get("edges") if isinstance(graph.get("edges"), list) else []

    ids = set()
    kind_by_id = {}
    for i, n in enumerate(nodes):
        at = "nodes[%d]" % i
        if not isinstance(n, dict):
            E(at, "node not an object")
            continue
        nid = n.get("id")
        if not isinstance(nid, str) or not nid:
            E(at, "id must be a non-empty string")
        elif nid in ids:
            E(at, "duplicate id '%s'" % nid)
        else:
            ids.add(nid)
        if n.get("kind") not in NODE_KINDS:
            E(at, "kind '%s' not in %s" % (n.get("kind"), "|".join(NODE_KINDS)))
        if not isinstance(n.get("label"), str):
            E(at, "label must be a string")
        for f in ("x", "y", "w", "h"):
            if not _is_number(n.get(f)):
                E(at, "%s must be a number" % f)
        model = n.get("model")
        if model is not None and model not in MODELS:
            E(at, "model '%s' not %s" % (model, "|".join(MODELS)))
        if isinstance(nid, str) and nid:
            kind_by_id[nid] = n.get("kind")

    for i, e in enumerate(edges):
        at = "edges[%d]" % i
        if not isinstance(e, dict):
            E(at, "edge not an object")
            continue
        if not isinstance(e.get("id"), str) or not e.get("id"):
            E(at, "id must be a non-empty string")
        etype = e.get("type")
        if etype not in EDGE_TYPES:
            E(at, "type '%s' not in %s" % (etype, "|".join(EDGE_TYPES)))
        if e.get("from") not in kind_by_id:
            E(at, "from '%s' references no node" % e.get("from"))
            continue
        if e.get("to") not in kind_by_id:
            E(at, "to '%s' references no node" % e.get("to"))
            continue
        rule = CONNECTION_RULES.get(etype)
        if rule:
            sk, tk = kind_by_id[e["from"]], kind_by_id[e["to"]]
            if sk not in rule[0]:
                E(at, "%s edge cannot start at a '%s' node" % (etype, sk))
            if tk not in rule[1]:
                E(at, "%s edge cannot end at a '%s' node" % (etype, tk))

    return len(errors) == 0, errors


def _selftest():
    fails = 0

    def check(cond, msg):
        nonlocal fails
        print(("PASS: " if cond else "FAIL: ") + msg)
        if not cond:
            fails += 1

    n = lambda i, k: {"id": i, "kind": k, "label": "x", "model": None, "schema": None,
                      "phase": None, "detail": None, "body": None, "x": 0, "y": 0, "w": 1, "h": 1}

    # handle counts (the "number of node points")
    check(handle_count("agent") == 2, "agent has 2 handles")
    check(handle_count("trigger") == 1, "trigger has 1 handle")
    check(handle_count("phase") == 1, "phase has 1 handle")

    # connection rules — legal accepted, illegal rejected
    check(edge_type_for("agent", "gate") == "flow", "agent -> gate is flow")
    check(edge_type_for("skill", "agent") == "skill", "skill -> agent is skill")
    check(edge_type_for("knob", "gate") == "data", "knob -> gate is data")
    check(not connection_allowed("agent", "trigger"), "agent -> trigger rejected")
    check(not connection_allowed("phase", "agent"), "phase -> agent rejected")

    # validate_graph is not a rubber stamp
    ok, _ = validate_graph({"nodes": [dict(n("a", "bogus"))], "edges": []})
    check(not ok, "unknown node kind rejected")
    ok, _ = validate_graph({"nodes": [n("a", "agent"), n("b", "agent")],
                            "edges": [{"id": "e", "from": "a", "to": "b", "type": "skill"}]})
    check(not ok, "skill edge between two agents rejected")
    ok, _ = validate_graph({"nodes": [n("a", "agent")],
                            "edges": [{"id": "e", "from": "a", "to": "z", "type": "flow"}]})
    check(not ok, "edge to a missing node rejected")
    ok, errs = validate_graph({"nodes": [n("a", "agent")],
                               "edges": [{"id": "e", "from": "a", "to": "a", "type": "loop"}]})
    check(ok, "well-formed graph (with a loop self-edge) accepted: %s" % errs)

    print("\nAll checks passed." if not fails else "\n%d FAILURE(S)" % fails)
    return 0 if not fails else 1


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    src = argv[1] if len(argv) > 1 and not argv[1].startswith("-") else None
    try:
        raw = open(src, encoding="utf-8").read() if src else sys.stdin.read()
        graph = json.loads(raw)
    except (OSError, ValueError) as ex:
        print("error: could not read/parse graph JSON: %s" % ex, file=sys.stderr)
        return 1
    ok, errors = validate_graph(graph)
    if ok:
        print("ok: graph conforms (%d nodes, %d edges)"
              % (len(graph.get("nodes", [])), len(graph.get("edges", []))))
        return 0
    for where, msg in errors:
        print("%s: %s" % (where, msg), file=sys.stderr)
    print("invalid: %d error(s)" % len(errors), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
