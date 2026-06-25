#!/usr/bin/env python3
"""Self-checks for the differential equivalence harness (EH-PORT-14). Stdlib only."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import diff_test as dt  # noqa: E402

# Two tiny "implementations" that read a JSON args list on stdin and print a JSON result. Same contract
# the harness drives a real source/target with — here both are python one-liners so the test is hermetic.
ADD = "python3 -c \"import sys,json; a=json.load(sys.stdin); print(json.dumps(a[0]+a[1]))\""
ADD_WRONG = "python3 -c \"import sys,json; a=json.load(sys.stdin); print(json.dumps(a[0]+a[1]+1))\""
# A target that errors on negative first arg, exposing an error-channel divergence.
ADD_RAISES = "python3 -c \"import sys,json; a=json.load(sys.stdin); assert a[0]>=0; print(json.dumps(a[0]+a[1]))\""


def test_identical_impls_zero_counterexamples():
    rec = dt.differential(ADD, ADD, ["int", "int"], cases=1000, seed=1, timeout=10.0, coverage=None)
    assert rec["counterexamples"] == 0, f"identical impls must agree: {rec}"
    assert rec["cases"] == 1000, rec
    assert rec["method"] == "differential"
    assert rec["confidence"] == "medium", "no coverage -> caps at medium even with 0 counterexamples"


def test_identical_with_coverage_is_high():
    rec = dt.differential(ADD, ADD, ["int", "int"], cases=1000, seed=1, timeout=10.0, coverage=0.95)
    assert rec["confidence"] == "high", f"0 cx + high coverage + >=1000 cases -> high: {rec}"


def test_wrong_target_produces_counterexample():
    rec = dt.differential(ADD, ADD_WRONG, ["int", "int"], cases=50, seed=2, timeout=10.0, coverage=None)
    assert rec["counterexamples"] >= 1, f"a wrong port must diverge: {rec}"
    cx = rec["counterexample_samples"][0]
    assert isinstance(cx["input"], list) and len(cx["input"]) == 2, f"concrete diverging input recorded: {cx}"
    assert rec["confidence"] == "low", "refuted equivalence is low confidence"


def test_error_channel_divergence_is_counterexample():
    # ADD never errors; ADD_RAISES errors on a negative first arg -> at least one sampled input diverges.
    rec = dt.differential(ADD, ADD_RAISES, ["int", "int"], cases=300, seed=7, timeout=10.0, coverage=None)
    assert rec["counterexamples"] >= 1, f"error-vs-ok must count as divergence: {rec}"


def test_unsupported_signature_is_manual_low():
    rc = dt.main(["--source-cmd", ADD, "--target-cmd", ADD, "--signature", "MyStruct,int"])
    assert rc == 0, "unsupported signature is not a divergence, just unproven"
    assert not dt.supported(["MyStruct"]) and dt.supported(["int", "list[str]"])


def test_cli_exit_code_reflects_divergence():
    assert dt.main(["--source-cmd", ADD, "--target-cmd", ADD, "--signature", "int,int", "--cases", "20"]) == 0
    assert dt.main(["--source-cmd", ADD, "--target-cmd", ADD_WRONG, "--signature", "int,int", "--cases", "20"]) == 1


# A target that returns the same value as a FLOAT instead of an int (the classic cross-language port shape).
ADD_FLOAT = "python3 -c \"import sys,json; a=json.load(sys.stdin); print(json.dumps(float(a[0]+a[1])))\""


def test_int_vs_float_is_not_a_false_divergence():
    # Source prints int 3, target prints 3.0 — same value, different formatting. normalize compares the
    # PARSED value, so 3 == 3.0 and this must NOT be a counterexample (the bug was a false divergence here).
    rec = dt.differential(ADD, ADD_FLOAT, ["int", "int"], cases=200, seed=3, timeout=10.0, coverage=None)
    assert rec["counterexamples"] == 0, f"int vs equal-valued float must agree: {rec}"


def test_zero_run_is_unproven_not_equivalent():
    # 0 cases against a KNOWN-WRONG target must NOT report medium-confidence equivalence: confidence is
    # forced low because nothing was actually tested.
    rec = dt.differential(ADD, ADD_WRONG, ["int", "int"], cases=0, seed=1, timeout=10.0, coverage=None)
    assert rec["cases"] == 0 and rec["counterexamples"] == 0
    assert rec["confidence"] == "low", f"zero-run must cap confidence at low: {rec}"


def main():
    tests = [
        test_identical_impls_zero_counterexamples,
        test_identical_with_coverage_is_high,
        test_wrong_target_produces_counterexample,
        test_error_channel_divergence_is_counterexample,
        test_unsupported_signature_is_manual_low,
        test_cli_exit_code_reflects_divergence,
        test_int_vs_float_is_not_a_false_divergence,
        test_zero_run_is_unproven_not_equivalent,
    ]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    main()
