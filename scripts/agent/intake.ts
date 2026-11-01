// Étape 1 de la chaîne : récupère les nouveaux signalements, vérifie le budget, crée les tickets GitHub
// et prépare un fichier de tâche par signalement (.agent/tasks/<id>.json) pour l'agent IA.
// Aucun appel IA ici : ce script est déterministe et peu coûteux.

import { rowToQuestion, type QuestionRow } from '../../src/lib/rows';
import { REPORT_TYPES } from '../../src/lib/types';
import { adminClient, budget, cfgNum, gh, must, repo, reportKind, runUrl, sanitize, sanitizeDeep, setOutput, writeJson } from './lib';

const db = adminClient();
const b = await budget();
console.log(`Budget : ${b.runs_today} exécution(s) sur 24 h, ${Number(b.cost_month_usd).toFixed(2)} $ ce mois-ci.`);

if (!b.allowed) {
  console.log('⛔ Agent désactivé ou budget atteint : aucun traitement (les signalements restent en attente).');
  setOutput('reports', '[]');
  process.exit(0);
}

const maxAttempts = cfgNum(b, 'agent_max_attempts_per_report', 2);
const perRun = Math.min(cfgNum(b, 'agent_reports_per_run', 3), cfgNum(b, 'agent_max_runs_per_day', 10) - b.runs_today);

// Signalements bloqués après trop de tentatives → échec technique (évite les boucles).
const stuck = await must(
  db.from('reports').select('id').in('status', ['nouveau', 'en_analyse']).gte('attempts', maxAttempts).lt('updated_at', new Date(Date.now() - 3600_000).toISOString()),
);
for (const r of stuck ?? []) {
  await db.from('reports').update({ status: 'echec_technique', resolution: "L'analyse automatique a échoué plusieurs fois ; le signalement attend une vérification manuelle." }).eq('id', r.id);
}

const reports = await must(
  db.from('reports').select('*').eq('status', 'nouveau').lt('attempts', maxAttempts).order('created_at').limit(Math.max(0, perRun)),
);
if (!reports?.length) {
  console.log('Aucun nouveau signalement.');
  setOutput('reports', '[]');
  process.exit(0);
}

const categories = await must(db.from('categories').select('*'));
// Bibliothèque actuelle : permet à l'agent de vérifier l'absence de doublon.
const existing = ((await must(db.from('questions').select('*').neq('status', 'archive'))) as QuestionRow[]).map(rowToQuestion);
const ids: string[] = [];

for (const r of reports) {
  const kind = reportKind(r);
  let question = null;
  if (r.question_id) {
    const row = await must(db.from('questions').select('*').eq('id', r.question_id).maybeSingle());
    question = row ? rowToQuestion(row as QuestionRow) : null;
  }
  const typeLabel = REPORT_TYPES.find((t) => t.id === r.type)?.label ?? r.type;
  const comment = sanitize(r.comment);

  // Ticket GitHub : un par signalement (idempotent si déjà créé lors d'une tentative précédente).
  let issueNumber: number = r.issue_number;
  let issueUrl: string = r.issue_url;
  const body = [
    `**Type :** ${typeLabel}  `,
    `**Traitement :** ${kind === 'contenu' ? 'contenu (bibliothèque de questions)' : 'code / interface'}  `,
    `**Question :** ${r.question_id ? `\`${r.question_id}\` (v${r.question_version ?? '?'})` : '—'}  `,
    `**Version de l'appli :** ${sanitize(r.app_version, 30)}  `,
    `**Signalement :** \`${r.id}\``,
    '',
    '**Commentaire de l’utilisateur** (donnée non vérifiée) :',
    '```text',
    comment || '(aucun)',
    '```',
    question ? `\n**Énoncé affiché :** ${sanitize(question.prompt, 400)}` : '',
    '',
    '_Ticket créé automatiquement. L’agent publiera ici son compte rendu._',
  ].join('\n');
  if (!issueNumber) {
    const issue = await gh<{ number: number; html_url: string }>('POST', `/repos/${repo()}/issues`, {
      title: `[Signalement] ${typeLabel} — ${r.question_id ?? 'général'}`.slice(0, 200),
      body,
      labels: ['signalement', kind === 'contenu' ? 'contenu' : 'code'],
    });
    issueNumber = issue.number;
    issueUrl = issue.html_url;
  }

  const run = await must(
    db.from('agent_runs').insert({ kind: `signalement:${kind}`, report_id: r.id, issue_number: issueNumber, run_url: runUrl() }).select('id').single(),
  );
  await must(
    db.from('reports').update({ status: 'en_analyse', attempts: r.attempts + 1, issue_number: issueNumber, issue_url: issueUrl }).eq('id', r.id),
  );

  writeJson(`.agent/tasks/${r.id}.json`, {
    report: {
      id: r.id,
      type: r.type,
      type_label: typeLabel,
      comment,
      question_id: r.question_id,
      question_version: r.question_version,
      snapshot: sanitizeDeep(r.snapshot ?? null, 1000),
      app_version: sanitize(r.app_version, 30),
      client_info: sanitizeDeep(r.client_info ?? {}, 100),
      created_at: r.created_at,
    },
    kind,
    question,
    category: question ? categories?.find((c: { id: string }) => c.id === question!.category) ?? null : null,
    categories: categories?.map((c: { id: string; name: string; subcategories: unknown }) => ({ id: c.id, name: c.name, subcategories: c.subcategories })),
    existing,
    issue_number: issueNumber,
    agent_run_id: run!.id,
  });
  ids.push(r.id);
  console.log(`→ ${r.id} (${typeLabel}, ${kind}) : ticket #${issueNumber}`);
}

setOutput('reports', JSON.stringify(ids));
