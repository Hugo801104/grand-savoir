// Lecture du contenu « graine » du dépôt (content/) et conversion vers le format complet.
//
// Format compact d'écriture (content/questions/*.json) — voir content/README.md :
//   id, sub, themes, diff, q (énoncé), fmt (qcm par défaut),
//   choices + correct (index, 0 par défaut : on écrit la bonne réponse en premier, l'appli mélange),
//   answer (vrai_faux : true/false), accepted (saisie), items + orderLabel (classement), pairs (association),
//   exp (explication), anec (anecdote), see (questions liées),
//   wiki: [["Titre de l'article Wikipédia FR", "terme à trouver", ...]], sources: [{title,url,checks}]

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  version?: number;
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
    version: s.version ?? 1,
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

export function loadCategories(contentDir = CONTENT_DIR): Category[] {
  return JSON.parse(readFileSync(join(contentDir, 'categories.json'), 'utf8'));
}

export function loadPaths(contentDir = CONTENT_DIR): LearningPath[] {
  return JSON.parse(readFileSync(join(contentDir, 'paths.json'), 'utf8'));
}

export function loadSeedQuestions(contentDir = CONTENT_DIR): Question[] {
  const dir = join(contentDir, 'questions');
  const out: Question[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const file = JSON.parse(readFileSync(join(dir, f), 'utf8')) as SeedFile;
    for (const s of file.questions) out.push(expandSeed(file, s));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Écriture : la bibliothèque est la source de vérité, versionnée par Git (historique + retour arrière).
// ---------------------------------------------------------------------------

const WIKI_PREFIX = 'https://fr.wikipedia.org/wiki/';

/** Convertit une question complète vers le format compact des fichiers. */
export function toSeed(q: Question): SeedQuestion {
  const wiki: string[][] = [];
  const sources: Source[] = [];
  for (const s of q.sources) {
    if (s.url.startsWith(WIKI_PREFIX) && s.title.startsWith('Wikipédia — ')) {
      wiki.push([s.title.slice('Wikipédia — '.length), ...(s.checks ?? [])]);
    } else sources.push(s);
  }
  const out: SeedQuestion = {
    id: q.id,
    ...(q.format !== 'qcm' ? { fmt: q.format } : {}),
    sub: q.subcategory,
    diff: q.difficulty,
    themes: q.themes,
    q: q.prompt,
    exp: q.explanation,
  };
  if (q.format === 'qcm') {
    out.choices = q.choices;
    if (q.correct) out.correct = q.correct;
  } else if (q.format === 'vrai_faux') out.answer = q.correct === 0;
  else if (q.format === 'saisie') out.accepted = q.accepted;
  else if (q.format === 'classement') {
    out.items = q.items;
    if (q.orderLabel) out.orderLabel = q.orderLabel;
  } else if (q.format === 'association') out.pairs = q.pairs;
  if (q.anecdote) out.anec = q.anecdote;
  if (q.seeAlso?.length) out.see = q.seeAlso;
  if (wiki.length) out.wiki = wiki;
  if (sources.length) out.sources = sources;
  if (q.status !== 'publie') out.status = q.status;
  if (q.version > 1) out.version = q.version;
  out.created = q.createdAt.slice(0, 10);
  if (q.verifiedAt) out.verified = q.verifiedAt.slice(0, 10);
  return out;
}

function categoryFile(contentDir: string, category: string) {
  return join(contentDir, 'questions', `${category}.json`);
}

/** Remplace (ou ajoute) une question dans le fichier de sa catégorie. */
export function upsertSeedQuestion(q: Question, contentDir = CONTENT_DIR): 'modifiee' | 'ajoutee' {
  const path = categoryFile(contentDir, q.category);
  const today = new Date().toISOString().slice(0, 10);
  const file: SeedFile = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { category: q.category, created: today, verified: today, questions: [] };
  const seed = toSeed(q);
  const i = file.questions.findIndex((x) => x.id === q.id);
  if (i >= 0) file.questions[i] = seed;
  else file.questions.push(seed);
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
  return i >= 0 ? 'modifiee' : 'ajoutee';
}
