// Valide tout le contenu du dépôt (structure, cohérence, doublons, références).
// Sortie en erreur si un problème bloquant est trouvé : utilisé par la CI et par les agents.
import { checkQuestion, checkReferences, findDuplicates } from '../../src/lib/quality';
import { loadCategories, loadPaths, loadSeedQuestions } from './seed';

const categories = loadCategories();
const paths = loadPaths();
const questions = loadSeedQuestions();

const issues = [
  ...questions.flatMap((q) => checkQuestion(q, categories)),
  ...findDuplicates(questions),
  ...checkReferences(questions, paths.flatMap((p) => p.steps.flatMap((s) => s.questionIds))),
];
for (const p of paths) {
  if (!categories.some((c) => c.id === p.category)) issues.push({ id: p.id, severity: 'erreur', message: 'parcours : catégorie inconnue' });
}

const errors = issues.filter((i) => i.severity === 'erreur');
const warnings = issues.filter((i) => i.severity === 'alerte');
for (const i of issues) console.log(`${i.severity === 'erreur' ? '✖' : '⚠'} ${i.id} : ${i.message}`);

const byCat = new Map<string, number>();
for (const q of questions) byCat.set(q.category, (byCat.get(q.category) ?? 0) + 1);
const byFmt = new Map<string, number>();
for (const q of questions) byFmt.set(q.format, (byFmt.get(q.format) ?? 0) + 1);
console.log(`\n${questions.length} questions, ${categories.length} catégories, ${paths.length} parcours`);
console.log('Par catégorie :', Object.fromEntries(byCat));
console.log('Par format :', Object.fromEntries(byFmt));
console.log(`${errors.length} erreur(s), ${warnings.length} alerte(s)`);
process.exit(errors.length ? 1 : 0);
