// Lecture du contenu « graine » du dépôt (content/) et conversion vers le format complet.
//
// Format compact d'écriture (content/questions/*.json) — voir content/README.md :
//   id, sub, themes, diff, q (énoncé), fmt (qcm par défaut),
//   choices + correct (index, 0 par défaut : on écrit la bonne réponse en premier, l'appli mélange),
//   answer (vrai_faux : true/false), accepted (saisie), items + orderLabel (classement), pairs (association),
//   exp (explication), anec (anecdote), see (questions liées),
//   wiki: [["Titre de l'article Wikipédia FR", "terme à trouver", ...]], sources: [{title,url,checks}]

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Category, LearningPath, Question, Source } from '../../src/lib/types';

export const ROOT = join(import.meta.dirname, '..', '..');
export const CONTENT_DIR = join(ROOT, 'content');

export interface SeedQuestion {
  id: string;
  fmt?: Question['format'];
  sub: string;
  themes?: string[];
  diff: number;
  q: string;
  choices?: string[];
  correct?: number;
  answer?: boolean;
  accepted?: string[];
  items?: string[];
  orderLabel?: string;
  pairs?: [string, string][];
  exp: string;
  anec?: string;
  see?: string[];
  wiki?: string[][];
  sources?: Source[];
  status?: Question['status'];
  verified?: string;
  created?: string;
}

export interface SeedFile {
  category: string;
  created: string;
  verified: string;
  questions: SeedQuestion[];
}

export function wikiUrl(title: string): string {
  return 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')).replace(/%2C/g, ',').replace(/%27/g, "'");
}

export function expandSeed(file: SeedFile, s: SeedQuestion): Question {
  const format = s.fmt ?? 'qcm';
  const sources: Source[] = [
    ...(s.wiki ?? []).map(([title, ...checks]) => ({ title: `Wikipédia — ${title}`, url: wikiUrl(title), checks })),
    ...(s.sources ?? []),
  ];
  const q: Question = {
    id: s.id,
    version: 1,
    status: s.status ?? 'publie',
    format,
    category: file.category,
    subcategory: s.sub,
    themes: s.themes ?? [],
    difficulty: Math.min(5, Math.max(1, s.diff)) as Question['difficulty'],
    prompt: s.q,
    explanation: s.exp,
    anecdote: s.anec,
    seeAlso: s.see ?? [],
    sources,
    origin: 'seed',
    createdAt: s.created ?? file.created,
    verifiedAt: s.verified ?? file.verified,
  };
  if (format === 'qcm') {
    q.choices = s.choices;
    q.correct = s.correct ?? 0;
  } else if (format === 'vrai_faux') {
    q.choices = ['Vrai', 'Faux'];
    q.correct = s.answer === false ? 1 : 0;
  } else if (format === 'saisie') {
    q.accepted = s.accepted;
  } else if (format === 'classement') {
    q.items = s.items;
    q.orderLabel = s.orderLabel;
  } else if (format === 'association') {
    q.pairs = s.pairs;
  }
  return q;
}

export function loadCategories(): Category[] {
  return JSON.parse(readFileSync(join(CONTENT_DIR, 'categories.json'), 'utf8'));
}

export function loadPaths(): LearningPath[] {
  return JSON.parse(readFileSync(join(CONTENT_DIR, 'paths.json'), 'utf8'));
}

export function loadSeedQuestions(): Question[] {
  const dir = join(CONTENT_DIR, 'questions');
  const out: Question[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const file = JSON.parse(readFileSync(join(dir, f), 'utf8')) as SeedFile;
    for (const s of file.questions) out.push(expandSeed(file, s));
  }
  return out;
}
