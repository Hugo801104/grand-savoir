import { describe, expect, it } from 'vitest';
import { checkQuestion, checkReferences, findDuplicates, similarity } from '../src/lib/quality';
import { questionToRow, rowToQuestion } from '../src/lib/rows';
import { loadCategories, loadPaths, loadSeedQuestions } from '../scripts/content/seed';

const categories = loadCategories();
const questions = loadSeedQuestions();

describe('bibliothèque de contenus', () => {
  it('toutes les questions passent les contrôles bloquants', () => {
    const errors = questions.flatMap((q) => checkQuestion(q, categories)).filter((i) => i.severity === 'erreur');
    expect(errors).toEqual([]);
  });
  it('aucun doublon ni référence cassée', () => {
    expect(findDuplicates(questions).filter((i) => i.severity === 'erreur')).toEqual([]);
    const pathIds = loadPaths().flatMap((p) => p.steps.flatMap((s) => s.questionIds));
    expect(checkReferences(questions, pathIds)).toEqual([]);
  });
  it('chaque question a au moins une source et une date de vérification', () => {
    for (const q of questions) {
      expect(q.sources.length).toBeGreaterThan(0);
      expect(q.verifiedAt).toBeTruthy();
    }
  });
  it('couvre toutes les catégories avec plusieurs difficultés', () => {
    for (const c of categories) {
      const qs = questions.filter((q) => q.category === c.id);
      expect(qs.length).toBeGreaterThanOrEqual(8);
      expect(new Set(qs.map((q) => q.difficulty)).size).toBeGreaterThanOrEqual(2);
    }
  });
  it('conversion base de données aller-retour sans perte', () => {
    for (const q of questions.slice(0, 40)) {
      const back = rowToQuestion({ ...questionToRow(q), updated_at: null });
      expect(back.prompt).toBe(q.prompt);
      expect(back.choices).toEqual(q.choices);
      expect(back.correct).toEqual(q.correct);
      expect(back.pairs).toEqual(q.pairs);
      expect(back.items).toEqual(q.items);
      expect(back.sources).toEqual(q.sources);
    }
  });
});

describe('contrôles qualité', () => {
  const base = questions.find((q) => q.format === 'qcm')!;
  it('détecte une explication de vrai/faux contradictoire', () => {
    const vf = questions.find((q) => q.format === 'vrai_faux')!;
    const broken = { ...vf, correct: vf.correct === 0 ? 1 : 0 };
    expect(checkQuestion(broken).some((i) => i.severity === 'erreur')).toBe(true);
  });
  it('détecte réponses en double, source absente, index invalide', () => {
    expect(checkQuestion({ ...base, choices: ['A', 'a', 'B', 'C'] }).some((i) => /double/.test(i.message))).toBe(true);
    expect(checkQuestion({ ...base, sources: [] }).some((i) => /source/.test(i.message))).toBe(true);
    expect(checkQuestion({ ...base, correct: 9 }).some((i) => /index/.test(i.message))).toBe(true);
  });
  it('signale les formulations qui se périment', () => {
    expect(checkQuestion({ ...base, prompt: 'Qui est actuellement président du Sénat ?' }).some((i) => i.severity === 'alerte')).toBe(true);
  });
  it('repère les questions quasi identiques', () => {
    expect(similarity('Qui a peint La Nuit étoilée en 1889 ?', 'Quel peintre a peint La Nuit étoilée (1889) ?')).toBeGreaterThan(0.7);
    const dup = { ...base, id: base.id + '-bis' };
    expect(findDuplicates([base, dup]).length).toBeGreaterThan(0);
  });
});
