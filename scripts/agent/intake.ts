// Étape 1 : choisit les signalements à traiter et prépare un fichier de tâche par signalement.
// Aucun appel IA ici. Déclenché par l'ouverture d'un ticket (ISSUE_NUMBER) ou par la tâche planifiée.
//
// Filtres anti-abus et anti-coûts : auteur autorisé uniquement, budget quotidien et mensuel,
// nombre de tentatives limité par signalement, une seule exécution à la fois (concurrency du workflow).

import { REPORT_TYPES } from '../../src/lib/types';
import { loadCategories, loadSeedQuestions } from '../content/seed';
import {
  comment, computeBudget, gh, type Issue, loadConfig, parseReportIssue, readJournal, repo, reportKind, setIssueStatus, setOutput, writeJson,
} from './lib';

const cfg = loadConfig();
const { entries } = await readJournal();
const budget = computeBudget(cfg, entries);
const aiConfigured = process.env.AI_CONFIGURED === 'true';
console.log(`Budget : ${budget.runsToday} exécution(s) sur 24 h, ${budget.costMonth.toFixed(2)} $ ce mois-ci.`);

const done = (why: string) => {
  console.log(why);
  setOutput('issues', '[]');
  process.exit(0);
};
if (!aiConfigured) done("ℹ️ Aucune clé IA configurée : les signalements restent en attente (statut « nouveau »).");
if (!budget.allowed) done(`⛔ ${budget.reason} : traitement reporté.`);

// Candidats : le ticket qui vient d'être ouvert, ou tous les signalements ouverts sans statut.
let candidates: Issue[];
const single = Number(process.env.ISSUE_NUMBER || 0);
if (single) {
  candidates = [await gh<Issue>('GET', `/repos/${repo()}/issues/${single}`)];
} else {
  const open = await gh<Issue[]>('GET', `/repos/${repo()}/issues?labels=signalement&state=open&per_page=50&sort=created&direction=asc`);
  candidates = open.filter((i) => !i.labels.some((l) => l.name.startsWith('statut:') && l.name !== 'statut:en-analyse'));
}

const allowed = new Set(cfg.allowed_reporters.map((x) => x.toLowerCase()));
const isAllowed = (i: Issue) => allowed.has((i.user?.login ?? '').toLowerCase()) || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(i.author_association);
const attempts = (n: number) => entries.filter((e) => e.issue === n && e.kind.startsWith('signalement') && e.status !== 'ignore').length;

const categories = loadCategories();
const existing = loadSeedQuestions();
const picked: number[] = [];
const quota = Math.min(cfg.reports_per_run, cfg.max_runs_per_day - budget.runsToday);

for (const issue of candidates) {
  if (picked.length >= quota) break;
  if (issue.state !== 'open' || !issue.labels.some((l) => l.name === 'signalement')) continue;
  if (!isAllowed(issue)) {
    // Protection contre le spam : les tickets de personnes non autorisées ne déclenchent aucune dépense.
    if (!issue.labels.some((l) => l.name === 'hors-perimetre')) {
      await gh('POST', `/repos/${repo()}/issues/${issue.number}/labels`, { labels: ['hors-perimetre'] });
      await comment(issue.number, 'Merci ! Ce signalement sera examiné manuellement (traitement automatique réservé aux signalements envoyés depuis l’application du propriétaire).');
    }
    continue;
  }
  if (attempts(issue.number) >= cfg.max_attempts_per_report) {
    await setIssueStatus(issue.number, 'echec_technique');
    await comment(issue.number, "L'analyse automatique n'a pas abouti après plusieurs tentatives ; le signalement sera examiné manuellement.");
    continue;
  }
  const report = parseReportIssue(issue.body);
  const kind = reportKind(report);
  const question = report.question_id ? (existing.find((q) => q.id === report.question_id) ?? null) : null;
  writeJson(`.agent/tasks/${issue.number}.json`, {
    issue_number: issue.number,
    report: { ...report, type_label: REPORT_TYPES.find((t) => t.id === report.type)?.label ?? report.type },
    kind,
    question,
    categories: categories.map((c) => ({ id: c.id, name: c.name, subcategories: c.subcategories })),
    existing,
  });
  await setIssueStatus(issue.number, 'en_analyse');
  picked.push(issue.number);
  console.log(`→ #${issue.number} (${report.type}, ${kind})`);
}

setOutput('issues', JSON.stringify(picked));
setOutput('model', cfg.model);
setOutput('max_turns', String(cfg.max_turns));
