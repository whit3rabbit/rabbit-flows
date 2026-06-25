#!/usr/bin/env python3
"""Self-checks for the deterministic inventory Kahn pass (EH-PORT-17). Stdlib only."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_inventory as bi  # noqa: E402


def test_chain_topo_and_layers():
    # c depends on b depends on a  ->  topo a,b,c ; layers a=0,b=1,c=2 ; no cycles.
    r = bi.compute({"a": [], "b": ["a"], "c": ["b"]})
    assert r["topoOrder"] == ["a", "b", "c"], r["topoOrder"]
    assert r["layers"] == {"a": 0, "b": 1, "c": 2}, r["layers"]
    assert r["cycles"] == [], r["cycles"]


def test_leaf_is_layer_zero_and_stable():
    # Two leaves + a join. Stable (sorted) Kahn order. d depends on both leaves -> layer 1.
    r = bi.compute({"a": [], "b": [], "d": ["a", "b"]})
    assert r["topoOrder"] == ["a", "b", "d"], r["topoOrder"]
    assert r["layers"]["d"] == 1 and r["layers"]["a"] == 0


def test_external_deps_ignored():
    # A dep on a path NOT in the unit set (external pkg) must not affect ordering or layer.
    r = bi.compute({"a": ["numpy"], "b": ["a", "os.path"]})
    assert r["layers"] == {"a": 0, "b": 1}, r["layers"]
    assert r["cycles"] == []


def test_cycle_flagged_as_scc():
    # b<->c is a 2-node SCC; a is acyclic. Cyclic nodes still appear in topoOrder (flagged, not dropped).
    r = bi.compute({"a": [], "b": ["c"], "c": ["b"], "a2": ["a"]})
    assert ["b", "c"] in r["cycles"], r["cycles"]
    assert set(r["topoOrder"]) == {"a", "a2", "b", "c"}, "every unit appears in topoOrder"


def test_self_loop_is_cycle():
    r = bi.compute({"x": ["x"], "y": ["x"]})
    assert ["x"] in r["cycles"], r["cycles"]


def test_fold_only_bumps_affected_layers():
    # Incremental property: folding a new leaf's dependent recomputes deterministically; unrelated layers
    # stay byte-identical. Here adding `e` (depends on a) leaves the b/c/d chain's layers untouched.
    before = bi.compute({"a": [], "b": ["a"], "c": ["b"]})
    after = bi.compute({"a": [], "b": ["a"], "c": ["b"], "e": ["a"]})
    for n in ("a", "b", "c"):
        assert before["layers"][n] == after["layers"][n], f"unrelated layer moved for {n}"
    assert after["layers"]["e"] == 1


def test_downstream_of_cycle_layers_monotonic():
    # Nodes merely DOWNSTREAM of a cycle (not in it) must get real, monotonic layers, not the old flat
    # len(nodes) fallback that collapsed them onto the cycle's band. b<->c is the cycle; d depends on it; e
    # depends on d. d and e are NOT cycles (only [b,c] is flagged), and e.layer must exceed d.layer.
    r = bi.compute({"b": ["c"], "c": ["b"], "d": ["b"], "e": ["d"]})
    assert ["b", "c"] in r["cycles"] and len(r["cycles"]) == 1, r["cycles"]
    L = r["layers"]
    assert L["d"] == L["b"] + 1, f"d sits one layer past the cycle band: {L}"
    assert L["e"] == L["d"] + 1, f"e (downstream of d) is strictly deeper than d: {L}"
    assert L["b"] == L["c"], "both cycle members share one band"


def test_duplicate_unit_path_merges_deps():
    # A repeated path in the units list must UNION its deps, not last-wins (silent edge loss).
    inv = {"units": [{"path": "a", "deps": ["x"]}, {"path": "a", "deps": ["y"]}]}
    assert set(bi.to_dep_map(inv)["a"]) == {"x", "y"}, "duplicate path must merge, not drop, deps"


def test_inventory_units_shape():
    # Accepts the real inventory {units:[{path,deps}]} shape, not just a bare map.
    inv = {"units": [{"path": "a", "deps": []}, {"path": "b", "deps": ["a"]}]}
    r = bi.compute(bi.to_dep_map(inv))
    assert r["topoOrder"] == ["a", "b"]


def main():
    tests = [
        test_chain_topo_and_layers,
        test_leaf_is_layer_zero_and_stable,
        test_external_deps_ignored,
        test_cycle_flagged_as_scc,
        test_self_loop_is_cycle,
        test_fold_only_bumps_affected_layers,
        test_downstream_of_cycle_layers_monotonic,
        test_duplicate_unit_path_merges_deps,
        test_inventory_units_shape,
    ]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    main()
