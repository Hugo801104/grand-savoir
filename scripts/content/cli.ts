// Gestion de la bibliothèque en base (nécessite SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY).
//   npm run content -- import-seed    importe catégories, parcours et questions du dépôt (n'écrase JAMAIS une question existante)
//   npm run content -- stats          volumes par catégorie et statut
//   npm run content -- show <id>      affiche une question et son historique
//   npm run content -- stale [jours]  questions dont la vérification est ancienne (défaut 365 j)

import { findStale } from '../../src/lib/quality';
import { questionToRow, rowToQuestion, type QuestionRow } from '../../src/lib/rows';
import { adminClient, must } from '../agent/lib';
import { loadCategories, loadPaths, loadSeedQuestions } from './seed';

const db = adminClient();
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'import-seed') {
  const categories = loadCategories();
  const paths = loadPaths();
  const questions = loadSeedQuestions();
  await must(db.from('categories').upsert(categories));
  const existingIds = new Set(((await must(db.from('questions').select('id'))) as { id: string }[]).map((r) => r.id));
  const fresh = questions.filter((q) => !existingIds.has(q.id));
  for (let i = 0; i < fresh.length; i += 200) {
    const rows = fresh.slice(i, i + 200).map((q) => {
      const { version: _v, ...row } = questionToRow(q);
      return { ...row, updated_by: 'import', change_reason: 'import initial depuis le dépôt' };
    });
    await must(db.from('questions').insert(rows));
  }
  // Parcours après les questions (ils y font référence).
  await must(db.from('paths').upsert(paths.map((p) => ({ ...p, status: 'publie' }))));
  console.log(`Import : ${categories.length} catégories, ${paths.length} parcours, ${fresh.length} nouvelle(s) question(s) (${questions.length - fresh.length} déjà présentes, non modifiées).`);
} else if (cmd === 'stats') {
  const rows = (await must(db.from('questions').select('category,status'))) as { category: string; status: string }[];
  const table: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    table[r.category] ??= {};
    table[r.category][r.status] = (table[r.category][r.status] ?? 0) + 1;
  }
  console.table(table);
} else if (cmd === 'show' && arg) {
  const row = await must(db.from('questions').select('*').eq('id', arg).maybeSingle());
  if (!row) {
    console.log('Introuvable.');
    process.exit(1);
  }
  console.log(JSON.stringify(rowToQuestion(row as QuestionRow), null, 2));
  const hist = await must(db.from('question_history').select('version,changed_at,changed_by,reason').eq('question_id', arg).order('version'));
  console.table(hist);
} else if (cmd === 'stale') {
  const rows = (await must(db.from('questions').select('*').eq('status', 'publie'))) as QuestionRow[];
  const issues = findStale(rows.map(rowToQuestion), Date.now(), Number(arg) || 365);
  for (const i of issues) console.log(`⚠ ${i.id} : ${i.message}`);
  console.log(`${issues.length} question(s) à revérifier.`);
} else {
  console.log('Commandes : import-seed | stats | show <id> | stale [jours]');
}
