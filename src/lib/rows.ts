// Conversion entre le format base de données (snake_case) et le format appli.
// Partagé par l'appli, les scripts de contenu et les agents.
import type { Category, LearningPath, Question } from './types';

export interface QuestionRow {
  id: string;
  version: number;
  status: Question['status'];
  format: Question['format'];
  category: string;
  subcategory: string;
  themes: string[];
  difficulty: number;
  prompt: string;
  data: Record<string, unknown>;
  explanation: string;
  anecdote: string | null;
  see_also: string[];
  sources: Question['sources'];
  origin: string | null;
  created_at: string;
  verified_at: string | null;
  updated_at?: string | null;
}

export function questionToRow(q: Question): QuestionRow {
  const data: Record<string, unknown> = {};
  for (const k of ['choices', 'correct', 'accepted', 'items', 'orderLabel', 'pairs'] as const) {
    if (q[k] !== undefined) data[k] = q[k];
  }
  return {
    id: q.id,
    version: q.version,
    status: q.status,
    format: q.format,
    category: q.category,
    subcategory: q.subcategory,
    themes: q.themes,
    difficulty: q.difficulty,
    prompt: q.prompt,
    data,
    explanation: q.explanation,
    anecdote: q.anecdote ?? null,
    see_also: q.seeAlso ?? [],
    sources: q.sources,
    origin: q.origin ?? null,
    created_at: q.createdAt,
    verified_at: q.verifiedAt ?? null,
  };
}

export function rowToQuestion(r: QuestionRow): Question {
  const d = r.data ?? {};
  return {
    id: r.id,
    version: r.version,
    status: r.status,
    format: r.format,
    category: r.category,
    subcategory: r.subcategory,
    themes: r.themes ?? [],
    difficulty: Math.min(5, Math.max(1, r.difficulty)) as Question['difficulty'],
    prompt: r.prompt,
    choices: d.choices as string[] | undefined,
    correct: d.correct as number | undefined,
    accepted: d.accepted as string[] | undefined,
    items: d.items as string[] | undefined,
    orderLabel: d.orderLabel as string | undefined,
    pairs: d.pairs as [string, string][] | undefined,
    explanation: r.explanation,
    anecdote: r.anecdote ?? undefined,
    seeAlso: r.see_also ?? [],
    sources: r.sources ?? [],
    origin: (r.origin ?? undefined) as Question['origin'],
    createdAt: r.created_at,
    verifiedAt: r.verified_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
  };
}

export interface CategoryRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  position: number;
  subcategories: Category['subcategories'];
}

export interface PathRow {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  steps: LearningPath['steps'];
  status: string;
}
