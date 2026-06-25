#!/usr/bin/env python3
"""Differential-testing harness for the eatahorse port pipeline (EH-PORT-14).

Drives a SOURCE implementation as an oracle and a TARGET (ported) implementation with identical
generated inputs, diffs their outputs, and emits a graded `equivalence` record (EH-PORT-13) as JSON
on stdout. This is the empirical `method:"differential"` rung of the evidence ladder — it produces
EVIDENCE of (in)equivalence over sampled inputs, NOT a proof. `smt`/`bounded-mc` (a real proof over a
closed numeric fragment, discharged with Z3 / a bounded model checker) are deliberately NOT implemented
here; a record with those methods must be produced by a different tool and labeled as such.

Contract: --source-cmd and --target-cmd are shell commands that READ one JSON value (a list of
positional args) from stdin and WRITE one JSON result to stdout. Same input -> compare outputs. A
subprocess that errors is a distinct, comparable outcome (so source erroring while target succeeds is a
counterexample; both erroring identically is agreement).

Scope (ponytail): generates only PRIMITIVE signatures (int/float/str/bool and list[prim]). A signature
with a type the generator does not know -> method:"manual", confidence:"low", cases:0 (the harness
refuses to fabricate coverage it does not have). Do NOT grow this into a universal fuzzer; richer types
are a manual or property-based job. Coverage is best-effort: pass --coverage <0..1> if the target
toolchain measured it, else it is null and confidence caps at "medium".

Stdlib only: `python3 diff_test.py --source-cmd ... --target-cmd ... --signature int,int`.
"""
from __future__ import annotations

import argparse
import json
import random
import string
import subprocess
import sys
from typing import Any, List, Optional, Tuple

PRIMITIVES = {"int", "float", "str", "bool"}


def gen_value(rng: random.Random, type_name: str) -> Any:
    t = type_name.strip()
    if t == "int":
        return rng.randint(-1000, 1000)
    if t == "float":
        # Include a few awkward magnitudes; avoid nan/inf (json + most targets choke, not the point here).
        return rng.choice([rng.uniform(-1e6, 1e6), 0.0, rng.uniform(-1.0, 1.0)])
    if t == "bool":
        return rng.choice([True, False])
    if t == "str":
        n = rng.randint(0, 12)
        return "".join(rng.choice(string.ascii_letters + string.digits + " ") for _ in range(n))
    if t.startswith("list[") and t.endswith("]"):
        inner = t[5:-1]
        if inner not in PRIMITIVES:
            raise ValueError(f"unsupported list element type: {inner}")
        return [gen_value(rng, inner) for _ in range(rng.randint(0, 6))]
    raise ValueError(f"unsupported type: {t}")


def supported(signature: List[str]) -> bool:
    for t in signature:
        t = t.strip()
        ok = t in PRIMITIVES or (t.startswith("list[") and t.endswith("]") and t[5:-1] in PRIMITIVES)
        if not ok:
            return False
    return True


def run_impl(cmd: str, args: List[Any], timeout: float) -> Tuple[str, Any]:
    """Return (kind, payload). kind is 'ok' (payload=parsed/normalized stdout) or 'err' (payload=reason)."""
    try:
        proc = subprocess.run(
            cmd, shell=True, input=json.dumps(args), capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        return ("err", "timeout")
    if proc.returncode != 0:
        # The error CHANNEL is comparable, but the message text is not (paths/line numbers differ across
        # languages), so we compare only on "errored" + return code, not stderr text.
        return ("err", f"exit:{proc.returncode}")
    return ("ok", normalize(proc.stdout))


def normalize(out: str) -> Any:
    # Compare the PARSED structural value, not a re-dumped string: across languages a port may print int
    # `3` where the oracle prints float `3.0`, or a raw string `hello` where the other JSON-quotes `"hello"`.
    # json.loads makes 3 == 3.0 (Python numeric equality) and unquotes the string, so those PRESENTATION
    # differences stop registering as false counterexamples; genuinely different values/floats still diverge.
    # Non-JSON output falls back to the raw stripped text (a raw `hello` then equals the unquoted `"hello"`).
    out = out.strip()
    try:
        return json.loads(out)
    except Exception:
        return out


def differential(
    source_cmd: str,
    target_cmd: str,
    signature: List[str],
    cases: int,
    seed: int,
    timeout: float,
    coverage: Optional[float],
    max_counterexamples: int = 10,
) -> dict:
    rng = random.Random(seed)
    counterexamples: List[dict] = []
    run = 0
    for _ in range(cases):
        try:
            inputs = [gen_value(rng, t) for t in signature]
        except ValueError:
            break
        run += 1
        src_kind, src_val = run_impl(source_cmd, inputs, timeout)
        tgt_kind, tgt_val = run_impl(target_cmd, inputs, timeout)
        if (src_kind, src_val) != (tgt_kind, tgt_val):
            if len(counterexamples) < max_counterexamples:
                counterexamples.append({
                    "input": inputs,
                    "src": f"{src_kind}:{src_val}",
                    "tgt": f"{tgt_kind}:{tgt_val}",
                })
    n_cx = len(counterexamples)
    if run == 0:
        # ZERO inputs were actually tested (cases=0, or gen_value broke on case 1). Never let an empty run
        # masquerade as agreement: 0 counterexamples over 0 cases is "unproven", not "equivalent".
        confidence = "low"
    elif n_cx > 0:
        confidence = "low"  # refuted: the two impls demonstrably diverge
    elif coverage is None:
        confidence = "medium"  # agreed on every sampled input, but coverage unknown
    elif coverage >= 0.9 and run >= 1000:
        confidence = "high"
    else:
        confidence = "medium"
    caveats = ["differential over sampled inputs, not a proof"]
    if run == 0:
        caveats.append("0 inputs generated — nothing was tested (unproven, not equivalent)")
    if coverage is None:
        caveats.append("branch coverage not measured (pass --coverage to raise confidence)")
    caveats.append("IO / global state / side effects not exercised")
    return {
        "method": "differential",
        "cases": run,
        "counterexamples": n_cx,
        "counterexample_samples": counterexamples,
        "coverage": coverage,
        "confidence": confidence,
        "caveats": caveats,
    }


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Differential equivalence harness (source-oracle vs target).")
    p.add_argument("--source-cmd", required=True, help="Shell cmd: reads JSON args list on stdin, writes JSON result")
    p.add_argument("--target-cmd", required=True, help="Shell cmd: same contract as --source-cmd")
    p.add_argument("--signature", required=True, help="Comma-separated arg types, e.g. int,str,list[int]")
    p.add_argument("--cases", type=int, default=1000)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--timeout", type=float, default=10.0, help="Per-subprocess timeout (s)")
    p.add_argument("--coverage", type=float, default=None, help="Target branch coverage 0..1 if measured, else omit")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    signature = [t for t in args.signature.split(",") if t.strip()]
    if not supported(signature):
        # Refuse to fabricate evidence for types we cannot generate. Emit a manual/low record so the caller
        # (and synthesis) treats this unit as UNPROVEN rather than silently equivalent.
        record = {
            "method": "manual",
            "cases": 0,
            "counterexamples": 0,
            "counterexample_samples": [],
            "coverage": None,
            "confidence": "low",
            "caveats": [f"signature '{args.signature}' has a type the differential generator cannot build; "
                        "verify by hand or property-based test"],
        }
        print(json.dumps(record, indent=2, sort_keys=True))
        return 0
    record = differential(
        args.source_cmd, args.target_cmd, signature, args.cases, args.seed, args.timeout, args.coverage
    )
    print(json.dumps(record, indent=2, sort_keys=True))
    # Nonzero exit when the two impls diverge, so a caller can branch on the process result, not just parse.
    return 1 if record["counterexamples"] > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
