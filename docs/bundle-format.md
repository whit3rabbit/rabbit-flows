# Bundle format (`format: 1`)

A **bundle** is a `.zip` that packages one workflow plus the skills and agents it depends on, so a
finished workflow can be shared as a single file. The Visual Designer exports one; the CLI imports
one into a user-local catalog (`~/.rabbit-flows/`) so it appears in the install menu alongside the
built-in workflows.

## Archive layout

```
bundle.json
workflows/<name>.js
skills/<name>/...            # full skill dir tree (minus .venv/__pycache__/node_modules/.git)
agents/<name>.md             # only if the workflow declares agents
```

`bundle.json`:

```json
{
  "format": 1,
  "workflows": [
    { "name": "<name>", "file": "workflows/<name>.js", "description": "...", "skills": ["..."], "agents": ["..."] }
  ],
  "skills": ["<name>"],
  "agents": ["<name>"]
}
```

Rules:

- **Names** match `^[a-z0-9][a-z0-9-]*$` everywhere (workflow, skills, agents).
- **One workflow per bundle** in v1 (the `workflows` array stays single-element; the array shape
  leaves room for multi-workflow bundles later).
- The workflow's `// requires-skills:` / `// requires-agents:` header **must** set-match the
  declared `skills`/`agents`. This is the same contract `npx … --check` enforces on built-ins.
- Each declared skill must include `skills/<name>/SKILL.md`; each declared agent
  `agents/<name>.md`.
- The importer **recomputes** `file` from `name` and never trusts the stored path.

## Export (Visual Designer)

`GET /api/bundle/:name` (`frontend/src/server/bundle.js`) reads the saved workflow from
`.claude/workflows/`, resolves its header-declared skills from the skill roots and agents from the
plugin agents dir, strips local build/venv noise, and streams a `.zip`. It is a read-tier,
same-origin endpoint (no mutation token): it only reads files already exposed by
`GET /api/workflows/:name` and `GET /api/skills` and builds the zip in-process.

In the SPA: open the generated-code panel, **Save to repo**, then **Download bundle**.

## Import (CLI)

`rabbit-flows import <bundle.zip>` (`bin/bundle.mjs` + `bin/registry.mjs`):

1. Reject the archive if it exceeds the size cap, then decompress in memory (`fflate.unzipSync` — no
   disk extraction).
2. Validate `bundle.json` strictly: `format`, name grammar, recomputed `file`, header⇄manifest
   set-match, every declared skill/agent file present. Any deviation rejects the whole bundle.
3. Refuse to **shadow a built-in** workflow name (no `--force` override). Refuse a name already in
   the catalog unless `--force`.
4. Show provenance (sha256 + contents) and **every executable script the bundle ships**, then
   require consent (`y` at the prompt, or `--yes`/`--force` non-interactively).
5. Write only the **declared** files — at paths computed from validated names — into
   `~/.rabbit-flows/bundles/<bundle>/`, and record the bundle in `~/.rabbit-flows/registry.json`.

The merged catalog (built-ins + imported) drives `--list` and the install menu; imported entries are
tagged `(imported)`. Installing an imported workflow copies it into the chosen `.claude` scope
exactly like a built-in, with the same receipt/uninstall behavior. `import --remove <name>` drops a
bundle from the catalog; already-installed copies are separate (remove them with `uninstall`).

## Security model

The archive never drives a filesystem write: entries are read in memory and only the declared paths
(recomputed from `^[a-z0-9-]+$` names) are written, into the store dir, with a confinement check.
That neutralizes path traversal and symlink/device escape. Size/entry/total caps bound zip bombs.

What import **cannot** protect against: a bundle is third-party executable code. Skill `scripts/*`
and the workflow `.js` run with the user's full permissions when the workflow later runs in Claude
Code — there is no sandbox. Import validates structure and provenance, not intent. The mitigation is
the consent gate (it lists what will run) plus the recorded sha256 for out-of-band verification.
**No signing in v1**; the `format` field leaves room for a `signature` field later.
