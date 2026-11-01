// Enrichissement contrôlé de la bibliothèque (désactivé par défaut : agent.config.json → enrichment_enabled).
//   npx tsx scripts/agent/enrich.ts plan   → réglages + budget, calcule les lacunes, écrit .agent/tasks/enrich.json
//   npx tsx scripts/agent/enrich.ts apply  → contrôle chaque question proposée, puis Pull Request
//     (validation humaine, ou fusion automatique si enrichment_auto_publish et que tout passe).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { Category, Question } from '../../src/lib/types';
import { CONTENT_DIR, loadCategories, loadSeedQuestions, upsertSeedQuestion } from '../content/seed';
import { checkCandidates, type Decision, normalizeNewQuestion, validateShape } from './decision';
import { appendJournal, computeBudget, env, gh, loadConfig, readExecutionCost, readJournal, repo, setOutput, writeJson } from './lib';

/** Lacunes : sous-catégories les moins fournies, avec la difficulté la moins représentée. */
export function computeGaps(cats: Category[], qs: Question[]) {
  const published = qs.filter((q) => q.status === 'publie');
  return cats
    .flatMap((c) =>
      c.subcategories.map((s) => {
        const inSub = published.filter((q) => q.category === c.id && q.subcategory === s.id);
        const diffs = [1, 2, 3, 4, 5].map((d) => inSub.filter((q) => q.difficulty === d).length);
        return { category: c.id, category_name: c.name, subcategory: s.id, subcategory_name: s.name, count: inSub.length, suggested_difficulty: diffs.indexOf(Math.min(...diffs)) + 1 };
      }),
    )
    .sort((a, b) => a.count - b.count);
}

if (process.argv[1]?.endsWith('enrich.ts')) {
  const cmd = process.argv[2];
  const cfg = loadConfig();
  const categories = loadCategories();
  const existing = loadSeedQuestions();

  if (cmd === 'plan') {
    const { entries } = await readJournal();
    const budget = computeBudget(cfg, entries);
    const why = process.env.AI_CONFIGURED !== 'true' ? 'aucune clé IA configurée' : !cfg.enrichment_enabled ? 'enrichissement désactivé (agent.config.json)' : budget.reason;
    if (why) {
      console.log(`Enrichissement non lancé : ${why}.`);
      setOutput('run', 'false');
      process.exit(0);
    }
    const count = Math.min(10, cfg.enrichment_batch_size);
    const gaps = computeGaps(categories, existing);
    writeJson('.agent/tasks/enrich.json', { count, targets: gaps.slice(0, count * 2), categories, existing });
    console.log('Lacunes prioritaires :', gaps.slice(0, count).map((g) => `${g.category}/${g.subcategory} (${g.count})`).join(', '));
    setOutput('run', 'true');
    setOutput('model', cfg.model);
  } else if (cmd === 'apply') {
    const cost = readExecutionCost('.agent/out/enrich/execution.json');
    const journal = (status: 'succes' | 'echec', summary: string, error?: string) =>
      appendJournal({ kind: 'enrichissement', status, summary, error, cost_usd: cost.cost, input_tokens: cost.input, output_tokens: cost.output });
    const path = '.agent/out/enrich/decision.json';
    if (!existsSync(path)) {
      await journal('echec', 'Aucune proposition produite.', 'decision.json absent');
      process.exit(0);
    }
    const d = JSON.parse(readFileSync(path, 'utf8')) as Decision;
    const shape = validateShape(d);
    if (shape.length || !d.new_questions?.length) {
      await journal('echec', 'Proposition invalide.', shape.join(' · ') || 'new_questions vide');
      process.exit(0);
    }
    const today = new Date().toISOString();
    const candidates = d.new_questions.slice(0, 10).map((p) => ({ ...normalizeNewQuestion(p, today), status: 'publie' as const }));
    const checks = await checkCandidates(candidates, { categories, existing });
    const valid = candidates.filter((c) => !checks.errors.some((e) => e.startsWith(c.id + ' ')));
    if (!valid.length) {
      await journal('succes', `${candidates.length} question(s) proposée(s), toutes rejetées par les contrôles.`, checks.errors.join(' · ').slice(0, 1000));
      process.exit(0);
    }
    for (const c of valid) upsertSeedQuestion(c, CONTENT_DIR);
    const branch = `agent/enrichissement-${today.slice(0, 10)}`;
    const git = (args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' });
    const auth = Buffer.from(`x-access-token:${env('GITHUB_TOKEN')}`).toString('base64');
    git(['checkout', '-B', branch]);
    git(['add', 'content']);
    git(['-c', 'user.name=grand-savoir-agent', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', `Enrichissement : ${valid.length} nouvelle(s) question(s)`]);
    git(['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, 'push', '--force', 'origin', `HEAD:refs/heads/${branch}`]);
    const auto = cfg.enrichment_auto_publish && d.confidence >= cfg.auto_publish_min_confidence && d.risk_flags.length === 0;
    const pr = await gh<{ number: number; html_url: string }>('POST', `/repos/${repo()}/pulls`, {
      title: `Enrichissement : ${valid.length} nouvelle(s) question(s)`,
      head: branch,
      base: 'main',
      body: [
        valid.map((c) => `- **${c.id}** (${c.category}/${c.subcategory}, ★${c.difficulty}) — ${c.prompt}`).join('\n'), '',
        `Sources vérifiées en ligne : ${checks.sourcesVerified}. Rejetées par les contrôles : ${candidates.length - valid.length}.`,
        checks.errors.length ? `\n${checks.errors.map((e) => `- ❌ ${e}`).join('\n')}` : '', '',
        '### Analyse de l’agent', d.analysis.slice(0, 20000),
      ].join('\n'),
    });
    await gh('POST', `/repos/${repo()}/issues/${pr.number}/labels`, { labels: ['enrichissement', auto ? 'publication-auto' : 'validation-requise'] });
    if (auto) {
      await gh('PUT', `/repos/${repo()}/pulls/${pr.number}/merge`, { merge_method: 'squash' });
      await gh('POST', `/repos/${repo()}/actions/workflows/deploy.yml/dispatches`, { ref: 'main' });
    }
    await journal('succes', `${valid.length} question(s) ${auto ? 'publiée(s)' : 'proposée(s) en validation'} : ${pr.html_url}`);
  }
}
