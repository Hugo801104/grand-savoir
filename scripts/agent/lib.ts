// Outils communs aux scripts d'agent (exécutés dans GitHub Actions, JAMAIS dans l'appli).
// La clé service_role n'est fournie qu'aux étapes qui n'exécutent pas de code produit par l'IA.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function env(name: string, required = true): string {
  const v = process.env[name] ?? '';
  if (required && !v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  admin ??= createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

/** Sortie pour GitHub Actions (steps.<id>.outputs.<name>). */
export function setOutput(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}<<__EOF__\n${value}\n__EOF__\n`);
  else console.log(`[output] ${name}=${value}`);
}

export function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}
export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * Neutralise un texte venant d'un utilisateur avant de l'afficher dans un ticket ou de le donner à l'IA :
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

/** Même nettoyage, appliqué récursivement à un objet JSON (tableaux limités à 30 éléments). */
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
// GitHub (API REST, jeton GITHUB_TOKEN du workflow)
// ---------------------------------------------------------------------------

export async function gh<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
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
  if (!res.ok) throw new Error(`GitHub ${method} ${path} : ${res.status} ${await res.text()}`);
  return (res.status === 204 ? null : await res.json()) as T;
}
export const repo = () => env('GITHUB_REPOSITORY');
export const runUrl = () =>
  process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

// ---------------------------------------------------------------------------
// Budget et configuration
// ---------------------------------------------------------------------------

export interface Budget {
  config: Record<string, unknown>;
  runs_today: number;
  cost_month_usd: number;
  allowed: boolean;
}
export async function budget(): Promise<Budget> {
  return must(adminClient().rpc('agent_budget_status')) as Promise<Budget>;
}
export const cfgNum = (b: Budget, k: string, d: number) => (typeof b.config[k] === 'number' ? (b.config[k] as number) : d);
export const cfgBool = (b: Budget, k: string, d: boolean) => (typeof b.config[k] === 'boolean' ? (b.config[k] as boolean) : d);

/** Coût et jetons lus dans le fichier d'exécution de claude-code-action (si disponible). */
export function readExecutionCost(path: string | undefined): { cost: number | null; input: number | null; output: number | null } {
  try {
    if (!path) return { cost: null, input: null, output: null };
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const items: Record<string, unknown>[] = Array.isArray(data) ? data : [data];
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

/** Types de signalement traités comme du contenu (le reste : code / interface). */
export const CONTENT_TYPES = ['erreur_factuelle', 'mauvaise_reponse', 'ambigue', 'explication', 'anecdote', 'source', 'nouvelle_question'];
export function reportKind(r: { type: string; question_id: string | null }): 'contenu' | 'code' {
  if (CONTENT_TYPES.includes(r.type)) return 'contenu';
  if (r.type === 'bug') return 'code';
  // amélioration / autre : contenu si une question est concernée, sinon code
  return r.question_id ? 'contenu' : 'code';
}
