import { describe, expect, it } from 'vitest';
import { buildCard, DAY, masteryLevel, mergeEvents, retrievability } from '../src/lib/srs';
import type { AnswerEvent } from '../src/lib/types';

let n = 0;
const ev = (at: number, correct: boolean, responseMs: number | null = 8000): AnswerEvent => ({
  id: `e${n++}`,
  questionId: 'q',
  questionVersion: 1,
  correct,
  responseMs,
  mode: 'aleatoire',
  at,
});
const T0 = Date.UTC(2026, 0, 1, 10);

describe('répétition espacée', () => {
  it("une bonne réponse isolée n'est pas une connaissance acquise", () => {
    const c = buildCard('q', [ev(T0, true)])!;
    expect(masteryLevel(c, T0 + 1000)).toBe('en_cours');
    expect(c.due).toBe(T0 + DAY);
  });

  it('plusieurs bonnes réponses le même jour ne valent pas plusieurs preuves', () => {
    const same = buildCard('q', [ev(T0, true), ev(T0 + 60_000, true), ev(T0 + 120_000, true)])!;
    expect(same.stability).toBe(1);
    expect(same.correctDays).toBe(1);
    expect(masteryLevel(same, T0 + 200_000)).toBe('en_cours');
  });

  it('des réussites espacées sur plusieurs jours mènent à acquise puis maîtrisée', () => {
    const events = [ev(T0, true), ev(T0 + 1 * DAY, true), ev(T0 + 4 * DAY, true), ev(T0 + 14 * DAY, true)];
    const c = buildCard('q', events)!;
    expect(c.stability).toBeGreaterThanOrEqual(7);
    expect(['acquis', 'maitrise']).toContain(masteryLevel(c, T0 + 14 * DAY + 1000));
    const more = buildCard('q', [...events, ev(T0 + 45 * DAY, true), ev(T0 + 120 * DAY, true)])!;
    expect(masteryLevel(more, T0 + 120 * DAY + 1000)).toBe('maitrise');
  });

  it('une erreur rend la notion fragile et la fait revenir vite', () => {
    const c = buildCard('q', [ev(T0, true), ev(T0 + 2 * DAY, true), ev(T0 + 6 * DAY, false)])!;
    expect(masteryLevel(c, T0 + 6 * DAY + 1000)).toBe('fragile');
    expect(c.due - (T0 + 6 * DAY)).toBe(10 * 60 * 1000);
    expect(c.lapses).toBe(1);
  });

  it("l'inactivité ne remet rien à zéro : seule la probabilité de rappel baisse", () => {
    const c = buildCard('q', [ev(T0, true), ev(T0 + 2 * DAY, true), ev(T0 + 9 * DAY, true)])!;
    const before = { ...c };
    const r1 = retrievability(c, T0 + 10 * DAY);
    const r2 = retrievability(c, T0 + 200 * DAY);
    expect(r2).toBeLessThan(r1);
    expect(c).toEqual(before);
    expect(c.correctCount).toBe(3);
  });

  it('la fusion de journaux (multi-appareils) déduplique par identifiant', () => {
    const a = [ev(T0, true), ev(T0 + 1, false)];
    const b = [a[1], ev(T0 + 2, true)];
    const m = mergeEvents(a, b);
    expect(m).toHaveLength(3);
    expect(m.map((e) => e.at)).toEqual([T0, T0 + 1, T0 + 2]);
  });
});
