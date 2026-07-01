# Security Audit Workflow

The `security-audit` workflow provides automated, evidence-backed defensive code reviews. It maps the project attack surface, runs parallel audit lanes, filters results to drop false positives, and generates a structured finding report with remediation guidance.

## Overview

The workflow processes code using a defensive model pipeline:
1. **Recon Indexing**: Builds a symbol, call graph, and entry point map using `recon.py`.
2. **Attack Surface Mapping**: Prioritizes key focus areas.
3. **Parallel Audit Lanes**: Fans out cheap workers (e.g. Claude 3 Haiku) to scan partitions or themes.
4. **Admission Gate**: Runs a strong model (e.g. Claude 3.5 Sonnet) in a clean context to verify findings and discard false positives.
5. **Report & Baseline**: Writes confirmed findings to a baseline markdown file to avoid reporting already reviewed items on subsequent runs.

Associated skills:
- **`audit-codebase`** (Front-door skill): Conversational intake that gathers scopes and focus areas.
- **`secure-review`** (Specialist dependency): Code-level auditor used during the lane and gate phases.

---

## `security-audit`

### Args

| Key | Type | Meaning |
|---|---|---|
| `scope` | `string` | Path or folder to audit. Also accepts a bare string: `/security-audit <path>`. Default `.`. |
| `focus` | `string[]` | Vulnerability classes to prioritize (e.g. `["authz", "ssrf"]`). |
| `maxLanes` | `number` | Maximum parallel audit lanes. Default `8`, hard cap `16`. |
| `mode` | `'paths' \| 'diff'` | Default `paths` (audit all code in scope). `diff` audits only files changed since `since`. |
| `since` | `string` | Git ref for diff mode. Default `HEAD~1`. |
| `partitionThreshold` | `number` | File count limit above which to switch from thematic to file-partition coverage. Default `40`. |
| `workerModel` | `string` | Model for audit lane workers. Default `haiku`. |
| `gateModel` | `string` | Model for the per-finding gate. Default `sonnet`. |
| `planModel` | `string` | Model for the map stage. Default `opus`. |
| `reportModel` | `string` | Model for the final report. Default `opus`. |
| `baselinePath` | `string` | File path to read/write accepted findings. Default `.security-audit/baseline.md`. |
| `writeBaseline` | `boolean` | Default `true`. Set to `false` to avoid saving found vulnerabilities to the baseline. |
| `reconScript` | `string` | Path to `recon.py`. Default: uses the bundled skill copy. |
| `reconOut` | `string` | Path for the temporary JSON index. Default `.security-audit/recon.json`. |

### Example

```json
/security-audit {
  "scope": "src",
  "focus": ["authz", "ssrf"],
  "mode": "diff",
  "since": "main"
}
```

---

## Security Invariant

> [!WARNING]
> This workflow is strictly defensive. It identifies security weaknesses and specifies exact remediation patterns. It will never output exploit scripts, proof-of-concept payloads, or code snippets designed to demonstrate exploitability.
