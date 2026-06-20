// starter — reference workflow showing the full spine: decompose -> workers -> gate -> synthesize.
// The gate is here on purpose: synthesis consumes the worker notes, so an unverified note would
// poison the answer. That is exactly the case the rules say needs an admission gate, so the
// canonical example models it rather than rationalizing it away. See workflow-guardrails.
// requires-skills: workflow-guardrails
// Run with /workflows, or copy via `npx @whit3rabbit/rabbit-flows`.
export const meta = {
  name: 'starter',
  description: 'Reference workflow: decompose a question, fan out workers, gate their notes, synthesize.',
  phases: [
    { title: 'Decompose' },
    { title: 'Workers' },
    { title: 'Gate' },
    { title: 'Synthesize' },
  ],
}

const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'where', 'evidence'],
        properties: {
          type: { enum: ['finding', 'failure', 'constraint'] },
          where: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const question = args?.question ?? 'What does this repository do and how is it structured?'

// 1. Decompose — strong model sets the trajectory.
phase('Decompose')
const plan = await agent(
  `Break this question into 2-4 independent sub-questions a worker can answer alone.\n` +
    `Return them as a JSON array of strings.\nQuestion: ${question}`,
  { label: 'decompose', schema: { type: 'object', required: ['subs'], properties: { subs: { type: 'array', items: { type: 'string' } } } } },
)

// 2. Workers — cheap model, parallel, compact notes only.
phase('Workers')
const results = await parallel(
  plan.subs.map((sub, i) => () =>
    agent(`Answer this sub-question with compact notes (no transcript): ${sub}`, {
      label: `worker:${i}`,
      phase: 'Workers',
      model: 'haiku',
      schema: NOTE_SCHEMA,
    }),
  ),
)
const notes = results.filter(Boolean).flatMap((r) => r.notes)

// 3. Admission gate — fresh context, strong model (no `model` opt → inherits the session model).
// Check each note against its own evidence; drop the unsupported ones before they reach synthesis.
phase('Gate')
const gated = await agent(
  `You are an admission gate. For each note below, decide whether its "evidence" actually ` +
    `supports its claim. Return ONLY the notes that pass, unchanged. Drop the rest.\n\n` +
    JSON.stringify(notes, null, 2),
  { label: 'gate', schema: NOTE_SCHEMA },
)
const admitted = gated?.notes ?? []

// 4. Synthesize — strong model, from admitted notes only.
phase('Synthesize')
const answer = await agent(
  `Synthesize a clear answer to "${question}" from these notes only. ` +
    `Cite the "where" of each note you rely on.\n\n${JSON.stringify(admitted, null, 2)}`,
  { label: 'synthesize' },
)

return { question, answer, noteCount: admitted.length, droppedByGate: notes.length - admitted.length }
