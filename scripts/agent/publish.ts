// Étape 3 : applique la décision de l'agent pour UN signalement, selon des règles fixes.
// Exécuté depuis une copie propre du dépôt : le code éventuellement modifié par l'IA n'est jamais exécuté ici.
//
// Usage : npx tsx scripts/agent/publish.ts <numéro de ticket>
//
// Contenu publié SANS validation humaine uniquement si : publication auto activée · verdict fondé/partiel ·
// aucun drapeau de risque · confiance ≥ seuil · tous les contrôles passent (structure, doublons, sources
// réellement vérifiées) · si la bonne réponse change : confiance ≥ 0,95 et au moins 2 sources vérifiées.
// Sinon : Pull Request « validation requise ». Code : toujours une Pull Request relue par un humain.
// Chaque modification est un commit : historique complet et retour arrière (« Revert ») sur GitHub.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { checkQuestion, checkReferences, findDuplicates } from '../../src/lib/quality';
import { CONTENT_DIR, loadCategories, loadPaths, loadSeedQuestions, upsertSeedQuestion } from '../content/seed';
import { applyPatch, checkCandidates, type CheckResult, type Decision, normalizeNewQuestion, validateShape } from './decision';
import {
  appendJournal, comment, env, gh, loadConfig, readExecutionCost, readJournal, repo, setIssueStatus, type StatusKey,
} from './lib';

const issueNumber = Number(process.argv[2]);
if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new Error('numéro de ticket invalide');
const dir = `.agent/out/${issueNumber}`;
const cfg = loadConfig();
const cost = readExecutionCost(`${dir}/execution.json`);
const branch = `agent/signalement-${issueNumber}`;

function git(args: string[], cwd = process.cwd()) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function pushBranch(cwd: string) {
  const auth = Buffer.from(`x-access-token:${env('GITHUB_TOKEN')}`).toString('base64');
  git(['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, 'push', '--force', 'origin', `HEAD:refs/heads/${branch}`], cwd);
}
function commitAll(cwd: string, title: string) {
  git(['add', '-A', 'content', 'src', 'tests'], cwd);
  git(['-c', 'user.name=grand-savoir-agent', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', title, '-m', `Signalement #${issueNumber} — proposition automatique.`], cwd);
}

async function openPr(title: string, body: string, labels: string[]): Promise<{ number: number; html_url: string }> {
  const existing = await gh<{ number: number; html_url: string }[]>('GET', `/repos/${repo()}/pulls?head=${repo().split('/')[0]}:${branch}&state=open`);
  const pr = existing[0] ?? (await gh<{ number: number; html_url: string }>('POST', `/repos/${repo()}/pulls`, { title, body, head: branch, base: 'main' }));
  await gh('POST', `/repos/${repo()}/issues/${pr.number}/labels`, { labels });
  return pr;
}

async function finish(status: StatusKey, userSummary: string, details: string[], d: Decision | null, checks: CheckResult | null, prUrl?: string, journalStatus: 'succes' | 'echec' = 'succes') {
  const close = status === 'corrige' ? 'completed' : status === 'rejete' ? 'not_planned' : undefined;
  const body = [
    `### Compte rendu de l'agent — ${status.replace(/_/g, ' ')}`,
    '',
    d ? `**Verdict :** ${d.verdict} · **confiance :** ${Math.round(d.confidence * 100)} %${d.risk_flags.length ? ` · **risques :** ${d.risk_flags.join(', ')}` : ''}` : '',
    '',
    `**Résumé :** ${userSummary}`,
    '',
    d?.analysis.slice(0, 40000) ?? '',
    checks ? `\n#### Contrôles automatiques\n- Sources vérifiées en ligne : ${checks.sourcesVerified}\n${checks.errors.map((e) => `- ❌ ${e}`).join('\n')}\n${checks.warnings.map((w) => `- ⚠️ ${w}`).join('\n')}` : '',
    details.length ? `\n#### Décision\n${details.map((x) => `- ${x}`).join('\n')}` : '',
    prUrl ? `\n**Pull Request :** ${prUrl}` : '',
    cost.cost !== null ? `\n_Coût de l'analyse : ${cost.cost.toFixed(3)} $_` : '',
  ].join('\n');
  await comment(issueNumber, body);
  await setIssueStatus(issueNumber, status, close);
  await appendJournal({
    kind: `signalement:${d?.kind ?? 'inconnu'}`, issue: issueNumber, status: journalStatus,
    cost_usd: cost.cost, input_tokens: cost.input, output_tokens: cost.output,
    summary: userSummary.slice(0, 500), error: journalStatus === 'echec' ? details.join(' · ').slice(0, 1000) : undefined,
  });
  console.log(`#${issueNumber} → ${status} : ${userSummary}`);
}

// --- Échec de l'agent : nouvelle tentative au prochain passage, puis échec technique -------------
async function failure(reason: string) {
  const { entries } = await readJournal();
  const tries = entries.filter((e) => e.issue === issueNumber && e.kind.startsWith('signalement') && e.status !== 'ignore').length + 1;
  await appendJournal({ kind: 'signalement:inconnu', issue: issueNumber, status: 'echec', cost_usd: cost.cost, input_tokens: cost.input, output_tokens: cost.output, error: reason });
  if (tries >= cfg.max_attempts_per_report) {
    await comment(issueNumber, `L'analyse automatique n'a pas abouti (${reason}). Le signalement sera examiné manuellement.`);
    await setIssueStatus(issueNumber, 'echec_technique');
  } else {
    // Retrait du statut : le signalement sera repris au prochain passage planifié.
    await gh('DELETE', `/repos/${repo()}/issues/${issueNumber}/labels/${encodeURIComponent('statut:en-analyse')}`, undefined, true);
  }
  console.log(`#${issueNumber} : échec (${reason}), tentative ${tries}/${cfg.max_attempts_per_report}`);
  process.exit(0);
}

if (!existsSync(`${dir}/decision.json`)) await failure(process.env.ANALYSE_RESULT ? `analyse : ${process.env.ANALYSE_RESULT}` : 'aucune décision produite');
let decision: Decision;
try {
  decision = JSON.parse(readFileSync(`${dir}/decision.json`, 'utf8'));
} catch {
  await failure('décision illisible');
  process.exit(0);
}
const shape = validateShape(decision);
if (shape.length) await failure(`décision invalide : ${shape.join(', ')}`);
const d = decision;
const flags = d.risk_flags.filter(Boolean);

// --- Modification du code : Pull Request, jamais fusionnée automatiquement ---------------------------
if (d.kind === 'code') {
  const patchPath = join(process.cwd(), dir, 'patch.diff');
  const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  const files = [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].flatMap((m) => [m[1], m[2]]);
  const forbidden = [...new Set(files.filter((f) => !/^(src|tests)\//.test(f) || f.includes('..')))];
  if (!patch.trim() || forbidden.length || patch.length > 200_000) {
    await finish('en_attente_validation', d.summary, [
      !patch.trim() ? 'aucune modification de code exploitable' : forbidden.length ? `correctif refusé : fichiers non autorisés (${forbidden.join(', ')})` : 'correctif trop volumineux',
    ], d, null);
    process.exit(0);
  }
  const wt = join(process.cwd(), '..', `pr-${issueNumber}`);
  rmSync(wt, { recursive: true, force: true });
  git(['worktree', 'add', '-B', branch, wt, 'HEAD']);
  git(['apply', '--whitespace=nowarn', patchPath], wt);
  const title = `[Agent] ${(d.code_change?.title || d.summary).slice(0, 90)}`;
  commitAll(wt, title);
  pushBranch(wt);
  const tests = existsSync(`${dir}/tests.txt`) ? readFileSync(`${dir}/tests.txt`, 'utf8') : 'non exécutés';
  const pr = await openPr(
    title,
    [
      `Proposition de l'agent pour le signalement #${issueNumber}.`, '', d.code_change?.description ?? d.summary, '',
      `### Vérifications automatiques ${/^OK/.test(tests) ? '✅' : '❌'}`, '```text', tests.slice(0, 5000), '```', '',
      `Fichiers : ${[...new Set(files)].map((f) => '`' + f + '`').join(', ')}`, '',
      '> ⚠️ Modification générée automatiquement : **relecture humaine obligatoire**. Rien n’est mis en ligne avant la fusion.',
    ].join('\n'),
    ['code', 'validation-requise'],
  );
  await finish('correction_proposee', `Une modification de l'application est proposée et attend une relecture avant mise en ligne. ${d.summary}`, ['Pull Request de code (fusion manuelle obligatoire)'], d, null, pr.html_url);
  process.exit(0);
}

// --- Contenu ----------------------------------------------------------------------------------------
const today = new Date().toISOString();
const categories = loadCategories();
const existing = loadSeedQuestions();
const task = existsSync(`.agent/tasks/${issueNumber}.json`) ? JSON.parse(readFileSync(`.agent/tasks/${issueNumber}.json`, 'utf8')) : {};
const questionId: string | null = task.question?.id ?? null;

let candidates: (typeof existing)[number][] = [];
let replacing: string | undefined;
if (d.kind === 'contenu' && d.question_patch && questionId) {
  const current = existing.find((q) => q.id === questionId);
  if (current) {
    const next = applyPatch(current, d.question_patch);
    next.version = current.version + 1;
    next.verifiedAt = today;
    candidates = [next];
    replacing = current.id;
  }
} else if (d.kind === 'contenu' && d.new_questions?.length) {
  candidates = d.new_questions.slice(0, 5).map((p) => ({ ...normalizeNewQuestion(p, today), status: 'publie' as const }));
}

if (!candidates.length) {
  if (d.verdict === 'non_fonde' && d.confidence >= 0.8 && !flags.length) {
    await finish('rejete', d.summary, ['signalement jugé non fondé après vérification'], d, null);
  } else {
    await finish('en_attente_validation', d.summary, ['aucune correction automatique : examen humain nécessaire'], d, null);
  }
  process.exit(0);
}

const checks = await checkCandidates(candidates, { categories, existing, replacing });
if (!checks.ok) {
  await finish(
    'en_attente_validation',
    `Correction envisagée mais non publiée : les vérifications automatiques ont échoué. ${d.summary}`,
    ['contrôles en échec : la proposition (ci-dessous) doit être revue', '```json\n' + JSON.stringify(d.question_patch ?? d.new_questions, null, 1).slice(0, 8000) + '\n```'],
    d, checks,
  );
  process.exit(0);
}

// Écriture dans la bibliothèque (fichiers JSON) puis contrôle complet de la bibliothèque modifiée.
for (const c of candidates) upsertSeedQuestion(c, CONTENT_DIR);
const after = loadSeedQuestions();
const libraryErrors = [
  ...after.flatMap((q) => checkQuestion(q, categories)),
  ...findDuplicates(after),
  ...checkReferences(after, loadPaths().flatMap((p) => p.steps.flatMap((s) => s.questionIds))),
].filter((i) => i.severity === 'erreur');
if (libraryErrors.length) {
  git(['checkout', '--', 'content']);
  await finish('en_attente_validation', d.summary, libraryErrors.map((i) => `${i.id} : ${i.message}`), d, checks);
  process.exit(0);
}

const isNew = !replacing;
const reasons: string[] = [];
if (isNew) reasons.push('nouvelle question : validation humaine systématique');
if (!cfg.auto_publish_enabled) reasons.push('publication automatique désactivée');
if (!['fonde', 'partiel'].includes(d.verdict)) reasons.push(`verdict « ${d.verdict} »`);
if (flags.length) reasons.push(`drapeaux de risque : ${flags.join(', ')}`);
if (d.confidence < cfg.auto_publish_min_confidence) reasons.push(`confiance ${d.confidence} < ${cfg.auto_publish_min_confidence}`);
if (checks.answerChanged && (d.confidence < 0.95 || checks.sourcesVerified < 2)) reasons.push('la bonne réponse change : confiance ≥ 0,95 et 2 sources vérifiées exigées');
const auto = reasons.length === 0;

git(['checkout', '-B', branch]);
const title = isNew ? `Nouvelle(s) question(s) : ${candidates.map((c) => c.id).join(', ')}` : `Correction de ${replacing} (v${candidates[0].version})`;
commitAll(process.cwd(), title.slice(0, 120));
pushBranch(process.cwd());
const pr = await openPr(
  title.slice(0, 120),
  [
    `Signalement #${issueNumber}. ${d.summary}`, '',
    `**Verdict :** ${d.verdict} · **confiance :** ${Math.round(d.confidence * 100)} % · **sources vérifiées :** ${checks.sourcesVerified}`, '',
    auto ? '✅ Tous les critères de publication automatique sont remplis.' : `⏸️ Validation humaine requise : ${reasons.join(' ; ')}.`, '',
    '### Analyse de l’agent', d.analysis.slice(0, 30000),
  ].join('\n'),
  ['contenu', auto ? 'publication-auto' : 'validation-requise'],
);

if (auto) {
  await gh('PUT', `/repos/${repo()}/pulls/${pr.number}/merge`, { merge_method: 'squash', commit_title: `${title} (#${pr.number})`.slice(0, 200) });
  // Une fusion faite avec le jeton du workflow ne relance pas les autres workflows : on demande la mise en ligne.
  await gh('POST', `/repos/${repo()}/actions/workflows/deploy.yml/dispatches`, { ref: 'main' });
  await finish('corrige', d.summary, ['publié automatiquement (tous les contrôles sont passés) ; retour arrière possible via « Revert » sur la Pull Request'], d, checks, pr.html_url);
} else {
  await finish('en_attente_validation', `Correction proposée, en attente de validation : ${d.summary}`, reasons, d, checks, pr.html_url);
}
