#!/usr/bin/env python3
"""Deterministic topo/layer/cycle pass for the eatahorse port inventory (EH-PORT-17).

The v1 Graph phase had an AGENT compute topoOrder by judgment. This is the deterministic upgrade the
workflow log named: given each unit's intra-repo dependencies, a Kahn pass computes a stable topoOrder
(prerequisites before dependents), per-unit layers (0 = leaf), and flags dependency CYCLES as SCCs. It
runs in O(V+E), so re-running it after each comprehension lands is cheap — that is the "incremental
inventory updater": fold the new unit into the map, re-run, the whole inventory is recomputed.

Input (JSON, from a file arg or stdin): either an inventory `{units:[{path, deps:[...]}]}` or a plain
adjacency map `{path: [dep_path, ...]}`. A dep that is not itself a unit (an external package, or a path
outside the set) is IGNORED for ordering — only intra-set edges order the port.

Output (JSON on stdout): `{topoOrder, layers, cycles}` where cycles is a list of SCC node-lists (each a
real dependency cycle: an SCC with >1 node, or a self-loop). Cyclic nodes still appear in topoOrder (in a
stable position) so the sequential loop can port them in their slot; they are flagged, not dropped.

ponytail: full recompute per fold (O(V+E) is nothing at these sizes); switch to a true incremental
layer-bump only if a tree is large enough to measure. Stdlib only.
"""
from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional


def to_dep_map(data: Any) -> Dict[str, List[str]]:
    if isinstance(data, dict) and "units" in data:
        units = data.get("units") or []
        # MERGE (union) deps when a path repeats, rather than last-wins: a duplicated unit in a malformed
        # or merged inventory must not silently drop the earlier unit's edges.
        dep_map: Dict[str, List[str]] = {}
        for u in units:
            path = u.get("path")
            if not path:
                continue
            dep_map.setdefault(path, []).extend(u.get("deps") or [])
        return dep_map
    if isinstance(data, dict):
        return {k: list(v or []) for k, v in data.items()}
    raise ValueError("input must be an inventory {units:[...]} or an adjacency map {path:[deps]}")


def compute(dep_map: Dict[str, List[str]]) -> Dict[str, Any]:
    nodes = list(dep_map.keys())
    nodeset = set(nodes)
    # Keep only intra-set prerequisites; external deps don't order the port. Dedupe, drop self-edges here
    # so a genuine self-loop is still caught below (a self-loop is a 1-node SCC flagged via the dep list).
    prereqs = {n: [d for d in dict.fromkeys(dep_map[n]) if d in nodeset and d != n] for n in nodes}
    self_loops = {n for n in nodes if n in dep_map[n]}

    indeg = {n: len(prereqs[n]) for n in nodes}
    dependents: Dict[str, List[str]] = {n: [] for n in nodes}
    for n in nodes:
        for d in prereqs[n]:
            dependents[d].append(n)

    # Kahn, processing ready nodes in stable (sorted) order so the same graph always yields the same order.
    layer = {n: 0 for n in nodes}
    ready = sorted(n for n in nodes if indeg[n] == 0)
    topo: List[str] = []
    while ready:
        n = ready.pop(0)
        topo.append(n)
        for m in sorted(dependents[n]):
            layer[m] = max(layer[m], layer[n] + 1)
            indeg[m] -= 1
            if indeg[m] == 0:
                ready.append(m)
        ready.sort()

    emitted = set(topo)
    # Nodes Kahn never emitted are BLOCKED: either inside a multi-node cycle OR merely downstream of one.
    # Only the former are real cycles; the latter must still get a correct (non-degenerate) layer.
    blocked = [n for n in nodes if n not in emitted]
    cycles = tarjan_sccs(prereqs, blocked)
    scc_of = {n: i for i, grp in enumerate(cycles) for n in grp}
    # Self-loops are real 1-node cycles even though Kahn (which we strip self-edges from) emitted them;
    # surface any not already inside a multi-node SCC.
    for n in sorted(self_loops):
        if n not in scc_of:
            cycles.append([n])

    # Layer the blocked nodes by LONGEST PATH, ignoring intra-SCC back-edges (those never converge). The
    # condensation (each SCC collapsed to a point) is a DAG, so this relaxation terminates. A node merely
    # downstream of a cycle now gets a real layer (1 + max prereq layer), not the old flat len(nodes) fallback
    # that collapsed every post-cycle node onto the cycle's band and broke layer monotonicity.
    for _ in range(len(blocked) + 1):
        changed = False
        for n in blocked:
            best = layer[n]
            ni = scc_of.get(n)
            for d in prereqs[n]:
                if ni is not None and scc_of.get(d) == ni:
                    continue  # same SCC: skip the back-edge so layering can converge
                cand = layer[d] + 1
                if cand > best:
                    best = cand
            if best != layer[n]:
                layer[n] = best
                changed = True
        if not changed:
            break
    # All members of one multi-node SCC share that SCC's max layer, so a cycle reads as a single band.
    for grp in cycles:
        if len(grp) > 1:
            band = max(layer[n] for n in grp)
            for n in grp:
                layer[n] = band

    # Append blocked nodes in dependency order (layer, then name) so topoOrder still covers every unit and
    # respects the computed layers; cyclic nodes are flagged in `cycles`, never dropped.
    for n in sorted(blocked, key=lambda x: (layer[x], x)):
        topo.append(n)

    return {"topoOrder": topo, "layers": layer, "cycles": cycles}


def tarjan_sccs(prereqs: Dict[str, List[str]], subset: List[str]) -> List[List[str]]:
    """SCCs (size>1) among `subset`, using only edges within subset. Iterative to avoid recursion limits."""
    sub = set(subset)
    index: Dict[str, int] = {}
    low: Dict[str, int] = {}
    on_stack: Dict[str, bool] = {}
    stack: List[str] = []
    counter = [0]
    sccs: List[List[str]] = []

    def strongconnect(root: str) -> None:
        work = [(root, 0)]
        while work:
            node, pi = work[-1]
            if pi == 0:
                index[node] = low[node] = counter[0]
                counter[0] += 1
                stack.append(node)
                on_stack[node] = True
            successors = [d for d in prereqs[node] if d in sub]
            if pi < len(successors):
                work[-1] = (node, pi + 1)
                nxt = successors[pi]
                if nxt not in index:
                    work.append((nxt, 0))
                elif on_stack.get(nxt):
                    low[node] = min(low[node], index[nxt])
            else:
                if low[node] == index[node]:
                    comp = []
                    while True:
                        w = stack.pop()
                        on_stack[w] = False
                        comp.append(w)
                        if w == node:
                            break
                    if len(comp) > 1:
                        sccs.append(sorted(comp))
                work.pop()
                if work:
                    parent = work[-1][0]
                    low[parent] = min(low[parent], low[node])

    for n in sorted(sub):
        if n not in index:
            strongconnect(n)
    return sccs


def main(argv: Optional[List[str]] = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv:
        data = json.loads(open(argv[0], encoding="utf-8").read())
    else:
        data = json.loads(sys.stdin.read())
    result = compute(to_dep_map(data))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
