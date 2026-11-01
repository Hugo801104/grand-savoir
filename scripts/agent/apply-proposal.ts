// Étape 3 de la chaîne : applique la décision de l'agent pour UN signalement, selon des règles fixes.
// Exécuté depuis une copie propre du dépôt (le code éventuellement modifié par l'IA n'est pas exécuté ici).
//
// Usage : npx tsx scripts/agent/apply-proposal.ts <reportId> [--dir=.agent/out/<id>] [--exec=<fichier>] [--pr=<url>] [--failed=<message>]
//
// Règles de publication d'un contenu SANS validation humaine (toutes requises) :
//   publication auto activée · verdict fondé/partiel · aucun drapeau de risque · confiance ≥ seuil ·
//   tous les contrôles passent (structure, doublons, sources réellement vérifiées) ·
//   si la bonne réponse change : confiance ≥ 0,95 et au moins 2 sources vérifiées.
// Sinon : proposition « en attente de validation » dans l'espace d'administration.

import { existsSync } from 'node:fs';
import { questionToRow, rowToQuestion, type QuestionRow } from '../../src/lib/rows';
import type { Category } from '../../src/lib/types';
import { applyPatch, checkCandidates, type CheckResult, type Decision, normalizeNewQuestion, validateShape } from './decision';
import { adminClient, budget, cfgBool, cfgNum, gh, must, readExecutionCost, readJson, repo } from './lib';

const reportId = process.argv[2];
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const dir = arg('dir') ?? `.agent/out/${reportId}`;
const prUrl = arg('pr');
const failed = arg('failed');
if (!reportId) throw new Error('usage : apply-proposal.ts <reportId>');

const db = adminClient();
const report = await must(db.from('reports').select('*').eq('id', reportId).single());
const run = await must(db.from('agent_runs').select('*').eq('report_id', reportId).order('started_at', { ascending: false }).limit(1).maybeSingle());
const b = await budget();
const cost = readExecutionCost(arg('exec'));

type Outcome = { status: string; resolution: string; final: boolean; details: string[] };

async function finish(o: Outcome, decision: Decision | null, checks: CheckResult | null, runStatus: 'succes' | 'echec') {
  await must(
    db.from('reports').update({
      status: o.status,
      resolution: o.resolution.slice(0, 2000),
      pr_url: prUrl ?? report.pr_url,
      analysis: decision ? { verdict: decision.verdict, confidence: decision.confidence, risk_flags: decision.risk_flags, checks: checks && { ok: checks.ok, errors: checks.errors, warnings: checks.warnings } } : null,
    }).eq('id', reportId),
  );
  if (run) {
    await must(
      db.from('agent_runs').update({
        status: runStatus,
        finished_at: new Date().toISOString(),
        cost_usd: cost.cost,
        input_tokens: cost.input,
        output_tokens: cost.output,
        summary: (decision?.summary ?? o.resolution).slice(0, 1000),
        error: runStatus === 'echec' ? o.details.join(' · ').slice(0, 2000) : null,
      }).eq('id', run.id),
    );
  }
  // Compte rendu sur le ticket GitHub.
  if (report.issue_number && process.env.GITHUB_TOKEN) {
    const lines = [
      `### Compte rendu de l'agent — ${o.status.replace(/_/g, ' ')}`,
      '',
      decision ? `**Verdict :** ${decision.verdict} · **confiance :** ${Math.round(decision.confidence * 100)} %${decision.risk_flags.length ? ` · **risques :** ${decision.risk_flags.join(', ')}` : ''}` : '',
      '',
      `**Résumé :** ${o.resolution}`,
      '',
      decision ? decision.analysis.slice(0, 50000) : '',
      checks ? `\n#### Contrôles automatiques\n- Sources vérifiées : ${checks.sourcesVerified}\n${checks.errors.map((e) => `- ❌ ${e}`).join('\n')}\n${checks.warnings.map((w) => `- ⚠️ ${w}`).join('\n')}` : '',
      o.details.length ? `\n#### Détails\n${o.details.map((d) => `- ${d}`).join('\n')}` : '',
      prUrl ? `\nPull Request : ${prUrl}` : '',
      cost.cost !== null ? `\n_Coût de l'analyse : ${cost.cost.toFixed(3)} $_` : '',
    ];
    await gh('POST', `/repos/${repo()}/issues/${report.issue_number}/comments`, { body: lines.join('\n').replace(/@/g, '＠') });
    if (o.final) await gh('PATCH', `/repos/${repo()}/issues/${report.issue_number}`, { state: 'closed', state_reason: o.status === 'rejete' ? 'not_planned' : 'completed' });
  }
  console.log(`${reportId} → ${o.status} : ${o.resolution}`);
}

// --- Échec technique de l'agent ---------------------------------------------------------------
const maxAttempts = cfgNum(b, 'agent_max_attempts_per_report', 2);
const decisionPath = `${dir}/decision.json`;
if (failed || !existsSync(decisionPath)) {
  const retry = report.attempts < maxAttempts;
  await finish(
    {
      status: retry ? 'nouveau' : 'echec_technique',
      resolution: retry ? 'Analyse interrompue ; une nouvelle tentative aura lieu automatiquement.' : "L'analyse automatique n'a pas abouti ; le signalement sera examiné manuellement.",
      final: false,
      details: [failed ?? 'aucune décision produite par l’agent'],
    },
    null,
    null,
    'echec',
  );
  process.exit(0);
}

const decision = readJson<Decision>(decisionPath);
const shapeErrors = validateShape(decision);
if (shapeErrors.length) {
  await finish({ status: report.attempts < maxAttempts ? 'nouveau' : 'echec_technique', resolution: 'La réponse de l’agent était invalide.', final: false, details: shapeErrors }, null, null, 'echec');
  process.exit(0);
}

// --- Modification du code : la PR a été créée par le workflow ----------------------------------
if (decision.kind === 'code') {
  await finish(
    prUrl
      ? { status: 'correction_proposee', resolution: `Une modification de l'application est proposée et attend une relecture humaine avant mise en ligne. ${decision.summary}`, final: false, details: [] }
      : { status: 'en_attente_validation', resolution: decision.summary, final: false, details: ['aucune modification de code exploitable'] },
    decision,
    null,
    'succes',
  );
  process.exit(0);
}

// --- Contenu --------------------------------------------------------------------------------------
const categories = (await must(db.from('categories').select('*'))) as Category[];
const allRows = (await must(db.from('questions').select('*').neq('status', 'archive'))) as QuestionRow[];
const existing = allRows.map(rowToQuestion);
const minConf = cfgNum(b, 'auto_publish_min_confidence', 0.9);
const autoOn = cfgBool(b, 'auto_publish_enabled', false);
const flags = decision.risk_flags.filter(Boolean);
const today = new Date().toISOString();

if (decision.kind === 'contenu' && decision.question_patch && report.question_id) {
  const current = existing.find((q) => q.id === report.question_id);
  if (!current) {
    await finish({ status: 'en_attente_validation', resolution: decision.summary, final: false, details: ['question introuvable en base'] }, decision, null, 'succes');
    process.exit(0);
  }
  const candidate = applyPatch(current, decision.question_patch);
  const checks = await checkCandidates([candidate], { categories, existing, replacing: current.id });
  const row = questionToRow(candidate);
  const payload = {
    prompt: row.prompt, data: row.data, explanation: row.explanation, anecdote: row.anecdote, sources: row.sources,
    difficulty: row.difficulty, themes: row.themes, subcategory: row.subcategory,
  };
  const proposal = await must(
    db.from('ai_proposals').insert({
      kind: 'correction', report_id: reportId, question_id: current.id, payload, confidence: decision.confidence,
      summary: decision.summary, risk_flags: flags, checks: { ok: checks.ok, errors: checks.errors, warnings: checks.warnings, answerChanged: checks.answerChanged }, agent_run_id: run?.id,
    }).select('id').single(),
  );
  const reasons: string[] = [];
  if (!autoOn) reasons.push('publication automatique désactivée');
  if (!['fonde', 'partiel'].includes(decision.verdict)) reasons.push(`verdict « ${decision.verdict} »`);
  if (flags.length) reasons.push(`drapeaux de risque : ${flags.join(', ')}`);
  if (decision.confidence < minConf) reasons.push(`confiance ${decision.confidence} < ${minConf}`);
  if (!checks.ok) reasons.push('contrôles automatiques en échec');
  if (checks.answerChanged && (decision.confidence < 0.95 || checks.sourcesVerified < 2)) reasons.push('la bonne réponse change : confiance ≥ 0,95 et 2 sources vérifiées exigées');

  if (reasons.length === 0) {
    await must(db.rpc('apply_proposal', { p_id: proposal!.id, p_actor: 'agent' }));
    await finish({ status: 'corrige', resolution: decision.summary, final: true, details: ['publié automatiquement (tous les contrôles sont passés)'] }, decision, checks, 'succes');
  } else {
    await finish(
      { status: 'en_attente_validation', resolution: `Correction proposée, en attente de validation : ${decision.summary}`, final: false, details: reasons },
      decision, checks, 'succes',
    );
  }
  process.exit(0);
}

if (decision.kind === 'contenu' && decision.new_questions?.length) {
  const candidates = decision.new_questions.slice(0, 5).map((p) => normalizeNewQuestion(p, today));
  const checks = await checkCandidates(candidates, { categories, existing });
  for (const c of candidates) {
    const row = questionToRow(c);
    await must(
      db.from('ai_proposals').insert({
        kind: 'nouvelle_question', report_id: reportId, question_id: c.id,
        payload: { id: row.id, format: row.format, category: row.category, subcategory: row.subcategory, themes: row.themes, difficulty: row.difficulty, prompt: row.prompt, data: row.data, explanation: row.explanation, anecdote: row.anecdote, see_also: row.see_also, sources: row.sources },
        confidence: decision.confidence, summary: decision.summary, risk_flags: flags,
        checks: { ok: checks.ok, errors: checks.errors.filter((e) => e.startsWith(c.id)), warnings: checks.warnings.filter((w) => w.startsWith(c.id)) }, agent_run_id: run?.id,
      }),
    );
  }
  // Les nouvelles questions suggérées par un utilisateur passent toujours par une validation humaine.
  await finish(
    { status: 'en_attente_validation', resolution: `Merci ! ${candidates.length} nouvelle(s) question(s) rédigée(s), en attente de validation. ${decision.summary}`, final: false, details: [] },
    decision, checks, 'succes',
  );
  process.exit(0);
}

// --- Pas de modification proposée ------------------------------------------------------------------
if (decision.verdict === 'non_fonde' && decision.confidence >= 0.8 && !flags.includes('incertitude')) {
  await finish({ status: 'rejete', resolution: decision.summary, final: true, details: ['signalement jugé non fondé après vérification'] }, decision, null, 'succes');
} else {
  await finish({ status: 'en_attente_validation', resolution: decision.summary, final: false, details: ['aucune correction automatique : examen humain nécessaire'] }, decision, null, 'succes');
}
