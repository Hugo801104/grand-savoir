// Outils communs aux scripts d'agent (GitHub Actions). Seul service utilisé : GitHub, avec le jeton
// temporaire GITHUB_TOKEN du workflow. Aucune base de données externe.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from '../content/seed';

export function env(name: string, required = true): string {
  const v = process.env[name] ?? '';
  if (required && !v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

/** Sortie pour GitHub Actions (steps.<id>.outputs.<name>). */
export function setOutput(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}<<__FIN__\n${value}\n__FIN__\n`);
  else console.log(`[sortie] ${name}=${value}`);
}

export function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}
export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * Neutralise un texte venant d'un utilisateur avant de l'afficher ou de le donner à l'IA :
 * pas de mention @, pas de balises, longueur bornée, caractères de contrôle retirés.
 */
export function sanitize(s: unknown, max = 2000): string {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .replace(/@/g, '＠')
    .replace(/```/g, 'ˋˋˋ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .slice(0, max);
}

/** Même nettoyage, appliqué récursivement à un objet JSON (tableaux et objets bornés). */
export function sanitizeDeep(v: unknown, max = 2000, depth = 0): unknown {
  if (depth > 5) return null;
  if (typeof v === 'string') return sanitize(v, max);
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => sanitizeDeep(x, max, depth + 1));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [sanitize(k, 60), sanitizeDeep(x, max, depth + 1)]));
  }
  return typeof v === 'number' || typeof v === 'boolean' ? v : null;
}

// ---------------------------------------------------------------------------
// API GitHub
// ---------------------------------------------------------------------------

export const repo = () => env('GITHUB_REPOSITORY');
export const runUrl = () =>
  process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined;

export async function gh<T = unknown>(method: string, path: string, body?: unknown, allow404 = false): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'grand-savoir-agent',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (allow404 && res.status === 404) return null as T;
  if (!res.ok) throw new Error(`GitHub ${method} ${path} : ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  author_association: string;
  user: { login: string } | null;
  labels: { name: string }[];
}

export const STATUS_LABELS = {
  en_analyse: 'statut:en-analyse',
  correction_proposee: 'statut:correction-proposee',
  en_attente_validation: 'statut:en-attente-validation',
  corrige: 'statut:corrige',
  rejete: 'statut:rejete',
  echec_technique: 'statut:echec-technique',
} as const;
export type StatusKey = keyof typeof STATUS_LABELS;

/** Remplace l'étiquette de statut d'un ticket (relue par l'appli pour afficher l'avancement). */
export async function setIssueStatus(issue: number, status: StatusKey, close?: 'completed' | 'not_planned') {
  const current = await gh<{ name: string }[]>('GET', `/repos/${repo()}/issues/${issue}/labels`);
  for (const l of current.filter((x) => x.name.startsWith('statut:') && x.name !== STATUS_LABELS[status])) {
    await gh('DELETE', `/repos/${repo()}/issues/${issue}/labels/${encodeURIComponent(l.name)}`, undefined, true);
  }
  await gh('POST', `/repos/${repo()}/issues/${issue}/labels`, { labels: [STATUS_LABELS[status]] });
  if (close) await gh('PATCH', `/repos/${repo()}/issues/${issue}`, { state: 'closed', state_reason: close });
}

export async function comment(issue: number, body: string) {
  await gh('POST', `/repos/${repo()}/issues/${issue}/comments`, { body: body.replace(/@/g, '＠').slice(0, 60000) });
}

// ---------------------------------------------------------------------------
// Réglages (agent.config.json, versionné dans le dépôt)
// ---------------------------------------------------------------------------

export interface AgentConfig {
  agent_enabled: boolean;
  model: string;
  max_turns: number;
  max_runs_per_day: number;
  monthly_budget_usd: number;
  max_attempts_per_report: number;
  reports_per_run: number;
  allowed_reporters: string[];
  auto_publish_enabled: boolean;
  auto_publish_min_confidence: number;
  enrichment_enabled: boolean;
  enrichment_batch_size: number;
  enrichment_auto_publish: boolean;
}

export function loadConfig(root = ROOT): AgentConfig {
  const defaults: AgentConfig = {
    agent_enabled: false, model: 'claude-opus-5-5', max_turns: 40, max_runs_per_day: 10, monthly_budget_usd: 10,
    max_attempts_per_report: 2, reports_per_run: 3, allowed_reporters: [], auto_publish_enabled: false,
    auto_publish_min_confidence: 0.9, enrichment_enabled: false, enrichment_batch_size: 5, enrichment_auto_publish: false,
  };
  const path = join(root, 'agent.config.json');
  return existsSync(path) ? { ...defaults, ...readJson<Partial<AgentConfig>>(path) } : defaults;
}

// ---------------------------------------------------------------------------
// Journal des exécutions : fichier runs.jsonl dans la branche « agent-journal » du dépôt
// (pas de base de données ; l'appli le lit pour afficher coûts et erreurs).
// ---------------------------------------------------------------------------

export interface RunEntry {
  date: string;
  kind: string;
  issue?: number;
  status: 'succes' | 'echec' | 'ignore';
  cost_usd?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  summary?: string;
  error?: string;
  run_url?: string;
}

const JOURNAL_BRANCH = 'agent-journal';
const JOURNAL_FILE = 'runs.jsonl';

export async function readJournal(): Promise<{ entries: RunEntry[]; sha: string | null }> {
  const f = await gh<{ content: string; sha: string } | null>('GET', `/repos/${repo()}/contents/${JOURNAL_FILE}?ref=${JOURNAL_BRANCH}`, undefined, true);
  if (!f) return { entries: [], sha: null };
  const text = Buffer.from(f.content, 'base64').toString('utf8');
  const entries = text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as RunEntry);
  return { entries, sha: f.sha };
}

async function ensureJournalBranch() {
  const ref = await gh('GET', `/repos/${repo()}/git/ref/heads/${JOURNAL_BRANCH}`, undefined, true);
  if (ref) return;
  // Branche orpheline (sans lien avec le code) contenant uniquement le journal.
  const blob = await gh<{ sha: string }>('POST', `/repos/${repo()}/git/blobs`, { content: '', encoding: 'utf-8' });
  const tree = await gh<{ sha: string }>('POST', `/repos/${repo()}/git/trees`, { tree: [{ path: JOURNAL_FILE, mode: '100644', type: 'blob', sha: blob.sha }] });
  const commit = await gh<{ sha: string }>('POST', `/repos/${repo()}/git/commits`, { message: 'Journal des agents', tree: tree.sha, parents: [] });
  await gh('POST', `/repos/${repo()}/git/refs`, { ref: `refs/heads/${JOURNAL_BRANCH}`, sha: commit.sha });
}

export async function appendJournal(entry: Omit<RunEntry, 'date' | 'run_url'>) {
  const full: RunEntry = { date: new Date().toISOString(), run_url: runUrl(), ...entry };
  await ensureJournalBranch();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { entries, sha } = await readJournal();
    const text = [...entries, full].map((e) => JSON.stringify(e)).join('\n') + '\n';
    try {
      await gh('PUT', `/repos/${repo()}/contents/${JOURNAL_FILE}`, {
        message: `journal : ${full.kind} ${full.status}`,
        content: Buffer.from(text).toString('base64'),
        branch: JOURNAL_BRANCH,
        ...(sha ? { sha } : {}),
      });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

export interface Budget {
  allowed: boolean;
  reason: string;
  runsToday: number;
  costMonth: number;
}

export function computeBudget(cfg: AgentConfig, entries: RunEntry[], now = Date.now()): Budget {
  const dayAgo = now - 86400_000;
  const month = new Date(now).toISOString().slice(0, 7);
  const runsToday = entries.filter((e) => e.status !== 'ignore' && Date.parse(e.date) > dayAgo).length;
  const costMonth = entries.filter((e) => e.date.startsWith(month)).reduce((a, e) => a + (e.cost_usd ?? 0), 0);
  let reason = '';
  if (!cfg.agent_enabled) reason = 'agent désactivé (agent.config.json)';
  else if (runsToday >= cfg.max_runs_per_day) reason = `plafond quotidien atteint (${runsToday}/${cfg.max_runs_per_day})`;
  else if (costMonth >= cfg.monthly_budget_usd) reason = `budget mensuel atteint (${costMonth.toFixed(2)} $ / ${cfg.monthly_budget_usd} $)`;
  return { allowed: !reason, reason, runsToday, costMonth };
}

/** Coût et jetons lus dans le fichier d'exécution de claude-code-action (si disponible). */
export function readExecutionCost(path: string | undefined): { cost: number | null; input: number | null; output: number | null } {
  try {
    if (!path || !existsSync(path)) return { cost: null, input: null, output: null };
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const items: Record<string, unknown>[] = Array.isArray(data) ? [...data] : [data];
    const result = items.reverse().find((x) => x?.type === 'result') as
      | { total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
      | undefined;
    if (!result) return { cost: null, input: null, output: null };
    const u = result.usage ?? {};
    return {
      cost: result.total_cost_usd ?? null,
      input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      output: u.output_tokens ?? null,
    };
  } catch {
    return { cost: null, input: null, output: null };
  }
}

// ---------------------------------------------------------------------------
// Signalements
// ---------------------------------------------------------------------------

/** Types de signalement traités comme du contenu (le reste : code / interface). */
export const CONTENT_TYPES = ['erreur_factuelle', 'mauvaise_reponse', 'ambigue', 'explication', 'anecdote', 'source', 'nouvelle_question'];
export function reportKind(r: { type: string; question_id: string | null }): 'contenu' | 'code' {
  if (CONTENT_TYPES.includes(r.type)) return 'contenu';
  if (r.type === 'bug') return 'code';
  return r.question_id ? 'contenu' : 'code';
}

export interface ParsedReport {
  id: string | null;
  type: string;
  question_id: string | null;
  question_version: number | null;
  comment: string;
  snapshot: unknown;
  app_version: string;
}

/** Lit le contenu structuré d'un ticket de signalement créé par l'appli (ou écrit à la main). */
export function parseReportIssue(body: string | null): ParsedReport {
  const text = body ?? '';
  let ctx: Record<string, unknown> = {};
  const m = text.match(/```json\s*([\s\S]*?)```/);
  if (m) {
    try {
      ctx = JSON.parse(m[1]);
    } catch {
      ctx = {};
    }
  }
  const commentMatch = text.match(/### Commentaire\s*\n([\s\S]*?)(\n<!--|\n```|$)/);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id: str(ctx.id),
    type: str(ctx.type) ?? 'autre',
    question_id: str(ctx.question_id),
    question_version: typeof ctx.question_version === 'number' ? ctx.question_version : null,
    comment: sanitize((commentMatch?.[1] ?? text).trim(), 2000),
    snapshot: sanitizeDeep(ctx.affichage ?? null, 1000),
    app_version: sanitize(ctx.appli ?? '', 30),
  };
}
