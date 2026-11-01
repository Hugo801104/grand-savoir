// Statistiques de progression dérivées du journal de réponses.
import type { AnswerEvent, Category, Question } from './types';
import { type CardState, DAY, MASTERY_SCORE, type MasteryLevel, masteryLevel } from './srs';

export interface CategoryProgress {
  category: Category;
  total: number;
  seen: number;
  /** 0..1 : moyenne de maîtrise sur toutes les questions publiées de la catégorie */
  mastery: number;
  levels: Record<MasteryLevel, number>;
  accuracy: number | null;
}

const emptyLevels = (): Record<MasteryLevel, number> => ({ nouveau: 0, fragile: 0, en_cours: 0, acquis: 0, maitrise: 0 });

export function categoryProgress(
  categories: Category[],
  questions: Question[],
  cards: Map<string, CardState>,
  now: number,
): CategoryProgress[] {
  return categories.map((category) => {
    const qs = questions.filter((q) => q.category === category.id && q.status === 'publie');
    const levels = emptyLevels();
    let score = 0;
    let correct = 0;
    let reps = 0;
    for (const q of qs) {
      const c = cards.get(q.id) ?? null;
      const lvl = masteryLevel(c, now);
      levels[lvl]++;
      score += MASTERY_SCORE[lvl];
      if (c) {
        correct += c.correctCount;
        reps += c.reps;
      }
    }
    return {
      category,
      total: qs.length,
      seen: qs.length - levels.nouveau,
      mastery: qs.length ? score / qs.length : 0,
      levels,
      accuracy: reps ? correct / reps : null,
    };
  });
}

export function globalLevels(questions: Question[], cards: Map<string, CardState>, now: number) {
  const levels = emptyLevels();
  for (const q of questions) if (q.status === 'publie') levels[masteryLevel(cards.get(q.id) ?? null, now)]++;
  return levels;
}

/** Réponses par jour sur les n derniers jours (pour un petit histogramme). */
export function dailyActivity(events: AnswerEvent[], now: number, days = 14) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime() - (days - 1) * DAY;
  const out = Array.from({ length: days }, (_, i) => ({ day: new Date(t0 + i * DAY), correct: 0, wrong: 0 }));
  for (const e of events) {
    const i = Math.floor((e.at - t0) / DAY);
    if (i >= 0 && i < days) e.correct ? out[i].correct++ : out[i].wrong++;
  }
  return out;
}

/** Dernières découvertes : questions récemment réussies pour la première fois, avec leur anecdote. */
export function recentDiscoveries(events: AnswerEvent[], byId: Map<string, Question>, limit = 4): Question[] {
  const seen = new Set<string>();
  const out: Question[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = events[i];
    if (seen.has(e.questionId)) continue;
    seen.add(e.questionId);
    const q = byId.get(e.questionId);
    if (q && (q.anecdote || q.explanation)) out.push(q);
  }
  return out;
}

export const MASTERY_COLORS: Record<MasteryLevel, string> = {
  nouveau: 'rgba(255,255,255,0.08)',
  fragile: '#ff5b6e',
  en_cours: '#ffb547',
  acquis: '#7c6cff',
  maitrise: '#2fd38a',
};
