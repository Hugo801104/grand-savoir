// Répétition espacée.
//
// Principe : on ne stocke que le journal des réponses (AnswerEvent, append-only).
// L'état de chaque question (« carte ») est recalculé en rejouant ce journal.
// Avantages : pas de conflit de synchronisation entre appareils (on fusionne des
// journaux), pas de perte en cas d'absence (le temps qui passe ne remet rien à zéro :
// il fait seulement baisser la probabilité estimée de se souvenir).
//
// Modèle (inspiré de FSRS / SM-2, volontairement simple et lisible) :
//  - stability (jours) : durée au bout de laquelle on estime la probabilité de rappel à 90 %.
//  - Une bonne réponse augmente la stabilité, d'autant plus que l'on a attendu longtemps
//    (se souvenir après 3 semaines prouve plus que se souvenir après 3 minutes).
//  - Plusieurs bonnes réponses le même jour ne comptent pas comme plusieurs preuves.
//  - Une erreur fait chuter la stabilité et ramène la question rapidement.

import type { AnswerEvent } from './types';

export const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

export type MasteryLevel = 'nouveau' | 'fragile' | 'en_cours' | 'acquis' | 'maitrise';

export const MASTERY_LABELS: Record<MasteryLevel, string> = {
  nouveau: 'Jamais vue',
  fragile: 'Fragile',
  en_cours: "En cours d'apprentissage",
  acquis: 'Acquise',
  maitrise: 'Maîtrisée',
};

export interface CardState {
  questionId: string;
  reps: number;
  correctCount: number;
  lapses: number;
  /** jours */
  stability: number;
  /** facteur de croissance (1.3 … 2.8) */
  ease: number;
  lastAt: number;
  lastCorrect: boolean;
  due: number;
  /** jours calendaires distincts avec au moins une bonne réponse */
  correctDays: number;
  firstAt: number;
}

const dayKey = (t: number) => Math.floor(t / DAY);

/** Rejoue les réponses d'une question (triées par date) et calcule son état. */
export function buildCard(questionId: string, events: AnswerEvent[]): CardState | null {
  if (events.length === 0) return null;
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const card: CardState = {
    questionId,
    reps: 0,
    correctCount: 0,
    lapses: 0,
    stability: 0,
    ease: 2.3,
    lastAt: 0,
    lastCorrect: false,
    due: 0,
    correctDays: 0,
    firstAt: sorted[0].at,
  };
  const days = new Set<number>();
  let lastProofDay = -1;
  for (const e of sorted) applyAnswer(card, e, days, () => lastProofDay, (d) => (lastProofDay = d));
  card.correctDays = days.size;
  return card;
}

function applyAnswer(
  c: CardState,
  e: AnswerEvent,
  days: Set<number>,
  getLastProofDay: () => number,
  setLastProofDay: (d: number) => void,
) {
  const elapsedDays = c.lastAt ? (e.at - c.lastAt) / DAY : 0;
  c.reps++;
  if (e.correct) {
    c.correctCount++;
    days.add(dayKey(e.at));
    const sameDay = getLastProofDay() === dayKey(e.at);
    if (c.stability === 0) {
      // Première bonne réponse : on reverra la question dans un jour (plus si réponse rapide).
      c.stability = e.responseMs !== null && e.responseMs < 6000 ? 1.5 : 1;
    } else if (!sameDay) {
      // Bonus si l'on a attendu au moins la durée prévue (preuve de mémorisation durable).
      const ratio = c.stability > 0 ? elapsedDays / c.stability : 1;
      const bonus = Math.min(1.6, Math.max(0.6, 0.6 + ratio * 0.5));
      c.stability = Math.min(365, c.stability * c.ease * bonus);
      c.ease = Math.min(2.8, c.ease + 0.05);
    }
    setLastProofDay(dayKey(e.at));
    c.lastCorrect = true;
    c.due = e.at + c.stability * DAY;
  } else {
    c.lapses++;
    c.lastCorrect = false;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.stability = c.stability === 0 ? 0 : Math.max(0.5, c.stability * 0.3);
    // Une erreur ramène la question dans la même session (10 min) puis le lendemain.
    c.due = e.at + 10 * MIN;
  }
  c.lastAt = e.at;
}

/** Probabilité estimée de se souvenir à l'instant now (0..1). */
export function retrievability(c: CardState, now: number): number {
  if (c.stability <= 0) return c.lastCorrect ? 0.5 : 0.2;
  const elapsed = Math.max(0, (now - c.lastAt) / DAY);
  return Math.pow(0.9, elapsed / c.stability);
}

/**
 * Niveau de maîtrise. Une bonne réponse isolée ne suffit pas :
 * « acquis » exige des bonnes réponses sur au moins 2 jours distincts et une stabilité ≥ 7 jours.
 */
export function masteryLevel(c: CardState | null, now: number): MasteryLevel {
  if (!c) return 'nouveau';
  const r = retrievability(c, now);
  if (!c.lastCorrect || r < 0.6) return 'fragile';
  if (c.stability >= 30 && c.correctDays >= 3) return 'maitrise';
  if (c.stability >= 7 && c.correctDays >= 2) return 'acquis';
  return 'en_cours';
}

export const MASTERY_SCORE: Record<MasteryLevel, number> = {
  nouveau: 0,
  fragile: 0.15,
  en_cours: 0.45,
  acquis: 0.8,
  maitrise: 1,
};

export function isDue(c: CardState, now: number): boolean {
  return c.due <= now;
}

/** Regroupe le journal par question et calcule toutes les cartes. */
export function buildAllCards(events: AnswerEvent[]): Map<string, CardState> {
  const byQ = new Map<string, AnswerEvent[]>();
  for (const e of events) {
    const list = byQ.get(e.questionId);
    if (list) list.push(e);
    else byQ.set(e.questionId, [e]);
  }
  const cards = new Map<string, CardState>();
  for (const [id, list] of byQ) {
    const c = buildCard(id, list);
    if (c) cards.set(id, c);
  }
  return cards;
}

/** Fusionne deux journaux (synchro multi-appareils) sans doublon. */
export function mergeEvents(a: AnswerEvent[], b: AnswerEvent[]): AnswerEvent[] {
  const map = new Map<string, AnswerEvent>();
  for (const e of a) map.set(e.id, e);
  for (const e of b) {
    const prev = map.get(e.id);
    map.set(e.id, prev ? { ...e, synced: prev.synced || e.synced } : e);
  }
  return [...map.values()].sort((x, y) => x.at - y.at);
}
