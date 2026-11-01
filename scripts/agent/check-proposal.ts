// Outil d'auto-vérification pour l'agent IA (aucun secret requis) :
//   npx tsx scripts/agent/check-proposal.ts .agent/out/<id>/decision.json .agent/tasks/<id>.json
// Affiche les erreurs bloquantes et alertes que l'étape de publication appliquera.

import type { Category, Question } from '../../src/lib/types';
import { applyPatch, checkCandidates, type Decision, normalizeNewQuestion, validateShape } from './decision';
import { readJson } from './lib';

const [decisionPath, taskPath] = process.argv.slice(2);
if (!decisionPath || !taskPath) {
  console.log('usage : check-proposal.ts <decision.json> <tâche.json>');
  process.exit(2);
}
const d = readJson<Decision>(decisionPath);
const task = readJson<{ question: Question | null; categories: Category[]; existing: Question[] }>(taskPath);

const shape = validateShape(d);
if (shape.length) {
  console.log(JSON.stringify({ ok: false, errors: shape }, null, 1));
  process.exit(1);
}
let candidates: Question[] = [];
if (d.question_patch && task.question) candidates = [applyPatch(task.question, d.question_patch)];
else if (d.new_questions?.length) candidates = d.new_questions.map((p) => normalizeNewQuestion(p, new Date().toISOString()));

if (!candidates.length) {
  console.log(JSON.stringify({ ok: true, note: 'aucune modification de contenu à contrôler' }, null, 1));
  process.exit(0);
}
const r = await checkCandidates(candidates, { categories: task.categories, existing: task.existing ?? [], replacing: task.question?.id });
console.log(JSON.stringify({ ok: r.ok, errors: r.errors, warnings: r.warnings, sourcesVerified: r.sourcesVerified, answerChanged: r.answerChanged }, null, 1));
process.exit(r.ok ? 0 : 1);
