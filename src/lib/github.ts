// Échanges avec GitHub, sans aucun jeton dans l'appli :
//  - envoi d'un signalement = ouverture d'un ticket pré-rempli (validé par l'utilisateur, connecté à GitHub) ;
//  - suivi = lecture de l'API publique (tickets, Pull Requests, historique, journal des agents).

import { GITHUB_REPO } from './config';
import type { Report, ReportStatus } from './types';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/** Marqueur placé dans le ticket pour relier un signalement local à son ticket. */
export const reportRef = (id: string) => `ref-${id.slice(0, 8)}`;

/** URL de création du ticket, avec titre, étiquette et contenu structuré. */
export function issueUrl(r: Report, typeLabel: string): string {
  const context = {
    id: r.id,
    type: r.type,
    question_id: r.questionId,
    question_version: r.questionVersion,
    affichage: r.snapshot,
    appli: r.appVersion,
    technique: r.clientInfo,
  };
  const body = [
    `**Type :** ${typeLabel}`,
    r.questionId ? `**Question :** \`${r.questionId}\` (v${r.questionVersion ?? 1})` : '**Question :** —',
    '',
    '### Commentaire',
    r.comment || '(aucun)',
    '',
    '<!-- Données techniques jointes automatiquement (ne pas modifier) -->',
    '```json',
    JSON.stringify(context, null, 1),
    '```',
  ].join('\n');
  const title = `[Signalement] ${typeLabel}${r.questionId ? ` — ${r.questionId}` : ''} (${reportRef(r.id)})`;
  const q = new URLSearchParams({ title: title.slice(0, 200), body: body.slice(0, 6000), labels: 'signalement' });
  return `https://github.com/${GITHUB_REPO}/issues/new?${q.toString()}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 403 || res.status === 429) throw new Error('Limite de consultation GitHub atteinte, réessaie dans quelques minutes.');
  if (!res.ok) throw new Error(`GitHub : ${res.status}`);
  return res.json() as Promise<T>;
}

export interface GhIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  state_reason: string | null;
  html_url: string;
  body: string | null;
  labels: { name: string }[];
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
  user: { login: string } | null;
}

export interface GhPull {
  number: number;
  title: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  html_url: string;
  head: { ref: string };
  labels: { name: string }[];
  created_at: string;
}

export interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } };
}

export interface AgentRun {
  date: string;
  kind: string;
  issue?: number;
  status: 'succes' | 'echec' | 'ignore';
  cost_usd?: number | null;
  summary?: string;
  error?: string;
  run_url?: string;
}

export const listReportIssues = () =>
  getJson<GhIssue[]>(`${API}/repos/${GITHUB_REPO}/issues?labels=signalement&state=all&per_page=100&sort=created&direction=desc`).then((l) =>
    l.filter((i) => !i.pull_request),
  );
export const listPulls = () => getJson<GhPull[]>(`${API}/repos/${GITHUB_REPO}/pulls?state=all&per_page=50&sort=created&direction=desc`);
export const listContentCommits = () => getJson<GhCommit[]>(`${API}/repos/${GITHUB_REPO}/commits?path=content&per_page=40`);

export async function readAgentJournal(): Promise<AgentRun[]> {
  const res = await fetch(`${RAW}/${GITHUB_REPO}/agent-journal/runs.jsonl`, { cache: 'no-cache' });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Journal : ${res.status}`);
  return (await res.text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as AgentRun;
      } catch {
        return null;
      }
    })
    .filter((x): x is AgentRun => !!x)
    .reverse();
}

export async function readAgentConfig(): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${RAW}/${GITHUB_REPO}/main/agent.config.json`, { cache: 'no-cache' });
  return res.ok ? res.json() : null;
}

/** Statut d'un signalement, déduit des étiquettes « statut:… » posées par l'agent sur le ticket. */
export function statusFromIssue(i: GhIssue): ReportStatus {
  const label = i.labels.map((l) => l.name).find((n) => n.startsWith('statut:'));
  const map: Record<string, ReportStatus> = {
    'statut:en-analyse': 'en_analyse',
    'statut:correction-proposee': 'correction_proposee',
    'statut:en-attente-validation': 'en_attente_validation',
    'statut:corrige': 'corrige',
    'statut:rejete': 'rejete',
    'statut:echec-technique': 'echec_technique',
  };
  if (label && map[label]) return map[label];
  if (i.state === 'closed') return i.state_reason === 'not_planned' ? 'rejete' : 'corrige';
  return 'nouveau';
}

/** Retrouve, pour chaque signalement local, son ticket GitHub (par la référence dans le titre). */
export function matchIssues(reports: Report[], issues: GhIssue[]): Map<string, GhIssue> {
  const out = new Map<string, GhIssue>();
  for (const r of reports) {
    const ref = reportRef(r.id);
    const issue = issues.find((i) => i.title.includes(ref) || i.body?.includes(r.id));
    if (issue) out.set(r.id, issue);
  }
  return out;
}
