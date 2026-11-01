// Enrichissement contrôlé de la bibliothèque.
//   npx tsx scripts/agent/enrich.ts plan   → vérifie config + budget, calcule les lacunes, écrit .agent/tasks/enrich.json
//   npx tsx scripts/agent/enrich.ts apply [--exec=<fichier>] → contrôle chaque question proposée et l'enregistre
//     comme proposition (validation humaine), ou la publie si enrichment_auto_publish est activé et que tout passe.

import { existsSync } from 'node:fs';
import { questionToRow, rowToQuestion, type QuestionRow } from '../../src/lib/rows';
import type { Category, Question } from '../../src/lib/types';
import { checkCandidates, type Decision, normalizeNewQuestion, validateShape } from './decision';
import { adminClient, budget, cfgBool, cfgNum, must, readExecutionCost, readJson, runUrl, setOutput, writeJson } from './lib';

const db = adminClient();
const cmd = process.argv[2];
const b = await budget();
const categories = (await must(db.from('categories').select('*').order('position'))) as Category[];
const existing = ((await must(db.from('questions').select('*').neq('status', 'archive'))) as QuestionRow[]).map(rowToQuestion);

/** Lacunes : sous-catégories les moins fournies, et difficultés sous-représentées. */
export function computeGaps(cats: Category[], qs: Question[]) {
  const published = qs.filter((q) => q.status === 'publie');
  const cells = cats.flatMap((c) =>
    c.subcategories.map((s) => {
      const inSub = published.filter((q) => q.category === c.id && q.subcategory === s.id);
      const diffs = [1, 2, 3, 4, 5].map((d) => inSub.filter((q) => q.difficulty === d).length);
      const missingDifficulty = diffs.indexOf(Math.min(...diffs)) + 1;
      return { category: c.id, category_name: c.name, subcategory: s.id, subcategory_name: s.name, count: inSub.length, suggested_difficulty: missingDifficulty };
    }),
  );
  return cells.sort((a, b) => a.count - b.count);
}

if (cmd === 'plan') {
  const enabled = cfgBool(b, 'enrichment_enabled', false);
  if (!enabled || !b.allowed) {
    console.log(enabled ? '⛔ Budget atteint : enrichissement reporté.' : 'Enrichissement désactivé (system_config.enrichment_enabled).');
    setOutput('run', 'false');
    process.exit(0);
  }
  const count = Math.min(10, cfgNum(b, 'enrichment_batch_size', 5));
  const gaps = computeGaps(categories, existing);
  const run = await must(db.from('agent_runs').insert({ kind: 'enrichissement', run_url: runUrl() }).select('id').single());
  writeJson('.agent/tasks/enrich.json', {
    count,
    targets: gaps.slice(0, count * 2),
    categories: categories.map((c) => ({ id: c.id, name: c.name, subcategories: c.subcategories })),
    existing,
    agent_run_id: run!.id,
  });
  console.log(`Plan : ${count} question(s), lacunes prioritaires :`, gaps.slice(0, count).map((g) => `${g.category}/${g.subcategory} (${g.count})`).join(', '));
  setOutput('run', 'true');
} else if (cmd === 'apply') {
  const run = await must(db.from('agent_runs').select('*').eq('kind', 'enrichissement').order('started_at', { ascending: false }).limit(1).maybeSingle());
  const cost = readExecutionCost(process.argv.find((a) => a.startsWith('--exec='))?.slice(7));
  const path = '.agent/out/enrich/decision.json';
  const end = async (status: 'succes' | 'echec', summary: string, error?: string) => {
    if (run) await db.from('agent_runs').update({ status, summary, error: error ?? null, finished_at: new Date().toISOString(), cost_usd: cost.cost, input_tokens: cost.input, output_tokens: cost.output }).eq('id', run.id);
    console.log(summary, error ?? '');
  };
  if (!existsSync(path)) {
    await end('echec', 'Aucune proposition produite.', 'decision.json absent');
    process.exit(0);
  }
  const d = readJson<Decision>(path);
  const shape = validateShape(d);
  if (shape.length || !d.new_questions?.length) {
    await end('echec', 'Proposition invalide.', shape.join(' · ') || 'new_questions vide');
    process.exit(0);
  }
  const today = new Date().toISOString();
  const candidates = d.new_questions.slice(0, 10).map((p) => normalizeNewQuestion(p, today));
  const checks = await checkCandidates(candidates, { categories, existing });
  const auto = cfgBool(b, 'enrichment_auto_publish', false) && d.confidence >= cfgNum(b, 'auto_publish_min_confidence', 0.9) && d.risk_flags.length === 0;
  let published = 0;
  let pending = 0;
  for (const c of candidates) {
    const errs = checks.errors.filter((e) => e.startsWith(c.id + ' '));
    const row = questionToRow(c);
    const proposal = await must(
      db.from('ai_proposals').insert({
        kind: 'nouvelle_question', question_id: c.id, confidence: d.confidence, summary: `Enrichissement : ${c.prompt}`.slice(0, 500), risk_flags: d.risk_flags,
        payload: { id: row.id, format: row.format, category: row.category, subcategory: row.subcategory, themes: row.themes, difficulty: row.difficulty, prompt: row.prompt, data: row.data, explanation: row.explanation, anecdote: row.anecdote, see_also: row.see_also, sources: row.sources },
        checks: { ok: errs.length === 0, errors: errs, warnings: checks.warnings.filter((w) => w.startsWith(c.id + ' ')) }, agent_run_id: run?.id,
      }).select('id').single(),
    );
    if (auto && errs.length === 0) {
      await must(db.rpc('apply_proposal', { p_id: proposal!.id, p_actor: 'agent' }));
      published++;
    } else pending++;
  }
  await end('succes', `${candidates.length} question(s) proposée(s) : ${published} publiée(s), ${pending} en attente de validation.`);
}
