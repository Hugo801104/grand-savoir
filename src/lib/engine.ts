// Moteur de quiz : choix des questions d'une partie, niveau estimé, correction des réponses.

import type { AnswerEvent, GameMode, Question } from './types';
import { DAY, type CardState, isDue, masteryLevel, retrievability } from './srs';

export interface SessionOptions {
  mode: GameMode;
  count: number;
  categories?: string[];
  subcategories?: string[];
  difficulties?: number[];
  formats?: string[];
  /** Mode découverte : ids imposés dans l'ordre */
  questionIds?: string[];
}

export interface EngineContext {
  questions: Question[];
  cards: Map<string, CardState>;
  events: AnswerEvent[];
  now: number;
  /** aléa injectable pour les tests */
  random?: () => number;
}

// ---------------------------------------------------------------------------
// Niveau estimé par catégorie (type Elo) : sert à proposer une difficulté adaptée.
// ---------------------------------------------------------------------------

const diffRating = (d: number) => 600 + d * 200; // 1 → 800 … 5 → 1600

export function estimateLevels(events: AnswerEvent[], byId: Map<string, Question>): Map<string, number> {
  const ratings = new Map<string, number>();
  const sorted = [...events].sort((a, b) => a.at - b.at);
  for (const e of sorted) {
    const q = byId.get(e.questionId);
    if (!q) continue;
    for (const key of [q.category, '*']) {
      const r = ratings.get(key) ?? 1000;
      const expected = 1 / (1 + Math.pow(10, (diffRating(q.difficulty) - r) / 400));
      const k = 40;
      ratings.set(key, r + k * ((e.correct ? 1 : 0) - expected));
    }
  }
  return ratings;
}

/** Convertit un niveau Elo en difficulté cible 1..5 */
export function targetDifficulty(rating: number): number {
  return Math.min(5, Math.max(1, Math.round((rating - 600) / 200)));
}

export function levelLabel(rating: number): string {
  if (rating < 900) return 'Débutant';
  if (rating < 1100) return 'Curieux';
  if (rating < 1300) return 'Connaisseur';
  if (rating < 1500) return 'Érudit';
  return 'Encyclopédie vivante';
}

// ---------------------------------------------------------------------------
// Construction d'une partie
// ---------------------------------------------------------------------------

function shuffle<T>(arr: T[], random: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Évite d'enchaîner deux questions de la même catégorie quand c'est possible. */
export function spreadCategories(qs: Question[]): Question[] {
  const result: Question[] = [];
  const pool = [...qs];
  while (pool.length) {
    const last = result[result.length - 1];
    const idx = pool.findIndex((q) => !last || q.category !== last.category);
    result.push(pool.splice(idx === -1 ? 0 : idx, 1)[0]);
  }
  return result;
}

function filterPool(qs: Question[], o: SessionOptions): Question[] {
  return qs.filter(
    (q) =>
      q.status === 'publie' &&
      (!o.categories?.length || o.categories.includes(q.category)) &&
      (!o.subcategories?.length || o.subcategories.includes(q.subcategory)) &&
      (!o.difficulties?.length || o.difficulties.includes(q.difficulty)) &&
      (!o.formats?.length || o.formats.includes(q.format)),
  );
}

export function buildSession(o: SessionOptions, ctx: EngineContext): Question[] {
  const random = ctx.random ?? Math.random;
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));

  if (o.mode === 'decouverte' && o.questionIds?.length) {
    return o.questionIds.map((id) => byId.get(id)).filter((q): q is Question => !!q && q.status === 'publie');
  }

  let pool = filterPool(ctx.questions, o);
  if (o.mode === 'defi') {
    const hard = pool.filter((q) => q.difficulty >= 4);
    pool = hard.length >= o.count ? hard : pool.filter((q) => q.difficulty >= 3);
  }

  const levels = estimateLevels(ctx.events, byId);
  // Questions vues très récemment : écartées (sauf si on en manque) pour éviter les répétitions.
  const recentCut = ctx.now - 6 * 60 * 60 * 1000;
  const seenRecently = (q: Question) => {
    const c = ctx.cards.get(q.id);
    return !!c && c.lastAt > recentCut && c.lastCorrect;
  };

  const due = pool
    .filter((q) => {
      const c = ctx.cards.get(q.id);
      return c && isDue(c, ctx.now);
    })
    .sort((a, b) => {
      const ca = ctx.cards.get(a.id)!;
      const cb = ctx.cards.get(b.id)!;
      return retrievability(ca, ctx.now) - retrievability(cb, ctx.now);
    });

  if (o.mode === 'revision') {
    const fragile = pool
      .filter((q) => !due.includes(q))
      .filter((q) => {
        const lvl = masteryLevel(ctx.cards.get(q.id) ?? null, ctx.now);
        return lvl === 'fragile' || lvl === 'en_cours';
      })
      .sort((a, b) => retrievability(ctx.cards.get(a.id)!, ctx.now) - retrievability(ctx.cards.get(b.id)!, ctx.now));
    return spreadCategories([...due, ...fragile].slice(0, o.count));
  }

  // Proportion de révisions dans une partie normale : jusqu'à 30 % (40 % en thématique).
  const reviewShare = o.mode === 'thematique' ? 0.4 : 0.3;
  const reviews = due.filter((q) => !seenRecently(q)).slice(0, Math.round(o.count * reviewShare));

  const unseen = pool.filter((q) => !ctx.cards.has(q.id));
  const weightFor = (q: Question) => {
    const rating = levels.get(q.category) ?? levels.get('*') ?? 1000;
    const target = o.mode === 'defi' ? 5 : targetDifficulty(rating);
    const dist = Math.abs(q.difficulty - target);
    return 1 / (1 + dist * dist) + random() * 0.35;
  };
  const freshPicked = shuffle(unseen, random)
    .map((q) => ({ q, w: weightFor(q) }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.q);

  const chosen: Question[] = [...reviews];
  const take = (list: Question[]) => {
    for (const q of list) {
      if (chosen.length >= o.count) break;
      if (!chosen.includes(q)) chosen.push(q);
    }
  };
  // En mode aléatoire on équilibre les catégories : une question par catégorie à tour de rôle.
  if (o.mode === 'aleatoire' && !o.categories?.length) {
    const byCat = new Map<string, Question[]>();
    for (const q of freshPicked) byCat.set(q.category, [...(byCat.get(q.category) ?? []), q]);
    const cats = shuffle([...byCat.keys()], random);
    let added = true;
    while (chosen.length < o.count && added) {
      added = false;
      for (const c of cats) {
        const next = byCat.get(c)!.shift();
        if (next && chosen.length < o.count) {
          chosen.push(next);
          added = true;
        }
      }
    }
  } else {
    take(freshPicked);
  }
  // Pas assez de nouveautés : questions déjà vues, en commençant par les moins sûres
  // et en évitant celles vues il y a quelques heures.
  if (chosen.length < o.count) {
    const seen = pool
      .filter((q) => ctx.cards.has(q.id) && !chosen.includes(q))
      .sort((a, b) => retrievability(ctx.cards.get(a.id)!, ctx.now) - retrievability(ctx.cards.get(b.id)!, ctx.now));
    take(seen.filter((q) => !seenRecently(q)));
    take(seen);
  }
  return spreadCategories(shuffle(chosen, random));
}

/** Nombre de questions à réviser maintenant. */
export function countDue(cards: Map<string, CardState>, published: Set<string>, now: number): number {
  let n = 0;
  for (const c of cards.values()) if (published.has(c.questionId) && isDue(c, now)) n++;
  return n;
}

/** Les cartes dont la révision arrive dans les prochains jours (pour l'affichage). */
export function upcomingReviews(cards: Map<string, CardState>, now: number, days = 7): number[] {
  const buckets = Array.from({ length: days }, () => 0);
  for (const c of cards.values()) {
    const d = Math.floor((c.due - now) / DAY);
    if (d >= 0 && d < days) buckets[d]++;
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Correction des réponses
// ---------------------------------------------------------------------------

/** Normalise une saisie : minuscules, sans accents, sans articles ni ponctuation. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''`´]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(le|la|les|l|un|une|des|du|de|d|the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Saisie libre : tolère les fautes de frappe (1 faute jusqu'à 7 lettres, 2 au-delà). Les nombres doivent être exacts. */
export function checkFreeText(input: string, accepted: string[]): boolean {
  const n = normalizeAnswer(input);
  if (!n) return false;
  return accepted.some((a) => {
    const t = normalizeAnswer(a);
    if (n === t) return true;
    if (/\d/.test(t)) return false;
    const tolerance = t.length <= 4 ? 0 : t.length <= 7 ? 1 : 2;
    return levenshtein(n, t) <= tolerance;
  });
}

export type GivenAnswer =
  | { kind: 'choice'; index: number }
  | { kind: 'text'; value: string }
  | { kind: 'order'; items: string[] }
  | { kind: 'pairs'; pairs: [string, string][] }
  | { kind: 'timeout' };

export function checkAnswer(q: Question, given: GivenAnswer): boolean {
  switch (q.format) {
    case 'qcm':
    case 'vrai_faux':
      return given.kind === 'choice' && given.index === q.correct;
    case 'saisie':
      return given.kind === 'text' && checkFreeText(given.value, q.accepted ?? []);
    case 'classement':
      return given.kind === 'order' && JSON.stringify(given.items) === JSON.stringify(q.items);
    case 'association': {
      if (given.kind !== 'pairs' || !q.pairs) return false;
      const ok = new Map(q.pairs.map(([l, r]) => [l, r]));
      return given.pairs.length === q.pairs.length && given.pairs.every(([l, r]) => ok.get(l) === r);
    }
  }
}

/** Texte de la bonne réponse, pour l'affichage après coup. */
export function correctAnswerText(q: Question): string {
  switch (q.format) {
    case 'qcm':
    case 'vrai_faux':
      return q.choices?.[q.correct ?? 0] ?? '';
    case 'saisie':
      return q.accepted?.[0] ?? '';
    case 'classement':
      return (q.items ?? []).join(' → ');
    case 'association':
      return (q.pairs ?? []).map(([l, r]) => `${l} : ${r}`).join(' · ');
  }
}

/** Mélange les réponses d'un QCM en gardant la trace de la bonne. */
export function shuffledChoices(q: Question, random: () => number = Math.random): { labels: string[]; map: number[] } {
  const idx = (q.choices ?? []).map((_, i) => i);
  // Vrai/Faux : ordre fixe, plus naturel.
  const order = q.format === 'vrai_faux' ? idx : shuffle(idx, random);
  return { labels: order.map((i) => q.choices![i]), map: order };
}

export { shuffle };
