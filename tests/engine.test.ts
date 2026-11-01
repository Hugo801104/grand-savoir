import { describe, expect, it } from 'vitest';
import { buildSession, checkAnswer, checkFreeText, normalizeAnswer, spreadCategories } from '../src/lib/engine';
import { buildAllCards, DAY } from '../src/lib/srs';
import type { AnswerEvent, Question } from '../src/lib/types';

function q(id: string, category: string, difficulty: 1 | 2 | 3 | 4 | 5, extra: Partial<Question> = {}): Question {
  return {
    id,
    version: 1,
    status: 'publie',
    format: 'qcm',
    category,
    subcategory: 's',
    themes: [],
    difficulty,
    prompt: `Question ${id} ?`,
    choices: ['a', 'b', 'c', 'd'],
    correct: 0,
    explanation: 'x'.repeat(40),
    sources: [{ title: 't', url: 'https://example.org' }],
    createdAt: '2026-01-01',
    ...extra,
  };
}
const seeded = (seed = 42) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const NOW = Date.UTC(2026, 5, 1);

const pool: Question[] = [];
for (const cat of ['a', 'b', 'c']) for (let i = 0; i < 12; i++) pool.push(q(`${cat}${i}`, cat, ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5));

describe('construction des parties', () => {
  it('produit le nombre demandé de questions distinctes, publiées seulement', () => {
    const withDraft = [...pool, q('draft', 'a', 1, { status: 'brouillon' })];
    const s = buildSession({ mode: 'aleatoire', count: 10 }, { questions: withDraft, cards: new Map(), events: [], now: NOW, random: seeded() });
    expect(s).toHaveLength(10);
    expect(new Set(s.map((x) => x.id)).size).toBe(10);
    expect(s.some((x) => x.id === 'draft')).toBe(false);
  });

  it('mélange les catégories en mode aléatoire', () => {
    const s = buildSession({ mode: 'aleatoire', count: 9 }, { questions: pool, cards: new Map(), events: [], now: NOW, random: seeded(7) });
    expect(new Set(s.map((x) => x.category)).size).toBe(3);
    for (let i = 1; i < s.length; i++) expect(s[i].category === s[i - 1].category).toBe(false);
  });

  it('filtre par catégorie en mode thématique', () => {
    const s = buildSession({ mode: 'thematique', count: 5, categories: ['b'] }, { questions: pool, cards: new Map(), events: [], now: NOW, random: seeded() });
    expect(s.every((x) => x.category === 'b')).toBe(true);
  });

  it('le mode défi privilégie les questions difficiles', () => {
    const s = buildSession({ mode: 'defi', count: 6 }, { questions: pool, cards: new Map(), events: [], now: NOW, random: seeded() });
    expect(s.every((x) => x.difficulty >= 4)).toBe(true);
  });

  it('le mode révision propose les questions dues et fragiles, rien si tout est à jour', () => {
    const events: AnswerEvent[] = [
      { id: '1', questionId: 'a1', questionVersion: 1, correct: false, responseMs: 5000, mode: 'aleatoire', at: NOW - 2 * DAY },
      { id: '2', questionId: 'b2', questionVersion: 1, correct: true, responseMs: 5000, mode: 'aleatoire', at: NOW - 1000 },
    ];
    const cards = buildAllCards(events);
    const s = buildSession({ mode: 'revision', count: 10 }, { questions: pool, cards, events, now: NOW, random: seeded() });
    expect(s.map((x) => x.id)).toContain('a1');
    const none = buildSession({ mode: 'revision', count: 10 }, { questions: pool, cards: new Map(), events: [], now: NOW });
    expect(none).toHaveLength(0);
  });

  it('évite de reproposer une question réussie il y a quelques minutes', () => {
    const events: AnswerEvent[] = pool.slice(0, 30).map((x, i) => ({
      id: String(i),
      questionId: x.id,
      questionVersion: 1,
      correct: true,
      responseMs: 3000,
      mode: 'aleatoire' as const,
      at: NOW - 60_000,
    }));
    const s = buildSession({ mode: 'aleatoire', count: 6 }, { questions: pool, cards: buildAllCards(events), events, now: NOW, random: seeded() });
    expect(s.every((x) => !events.some((e) => e.questionId === x.id))).toBe(true);
  });

  it('répartit les catégories sans répétition consécutive quand possible', () => {
    const r = spreadCategories([q('1', 'a', 1), q('2', 'a', 1), q('3', 'b', 1), q('4', 'b', 1)]);
    for (let i = 1; i < r.length; i++) expect(r[i].category).not.toBe(r[i - 1].category);
  });
});

describe('correction des réponses', () => {
  it('normalise accents, articles et casse', () => {
    expect(normalizeAnswer("  L'Étranger ")).toBe('etranger');
  });
  it('tolère les fautes de frappe mais pas les nombres faux', () => {
    expect(checkFreeText('Albert Camu', ['Albert Camus'])).toBe(true);
    expect(checkFreeText('everest', ['Everest'])).toBe(true);
    expect(checkFreeText('1816', ['1815'])).toBe(false);
    expect(checkFreeText('Sartre', ['Albert Camus', 'Camus'])).toBe(false);
    expect(checkFreeText('', ['x'])).toBe(false);
  });
  it('corrige classement et association', () => {
    const c = q('c', 'a', 1, { format: 'classement', items: ['x', 'y', 'z'] });
    expect(checkAnswer(c, { kind: 'order', items: ['x', 'y', 'z'] })).toBe(true);
    expect(checkAnswer(c, { kind: 'order', items: ['y', 'x', 'z'] })).toBe(false);
    const a = q('as', 'a', 1, { format: 'association', pairs: [['1', 'un'], ['2', 'deux'], ['3', 'trois']] });
    expect(checkAnswer(a, { kind: 'pairs', pairs: [['2', 'deux'], ['1', 'un'], ['3', 'trois']] })).toBe(true);
    expect(checkAnswer(a, { kind: 'pairs', pairs: [['1', 'deux'], ['2', 'un'], ['3', 'trois']] })).toBe(false);
  });
  it('un délai écoulé compte comme une erreur', () => {
    expect(checkAnswer(q('t', 'a', 1), { kind: 'timeout' })).toBe(false);
  });
});
