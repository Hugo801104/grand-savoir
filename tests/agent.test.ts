import { describe, expect, it } from 'vitest';
import { applyPatch, normalizeNewQuestion, validateShape, type Decision } from '../scripts/agent/decision';
import { reportKind, sanitize, sanitizeDeep } from '../scripts/agent/lib';
import { decrypt, encrypt } from '../scripts/backup';
import { loadSeedQuestions } from '../scripts/content/seed';
import { checkQuestion } from '../src/lib/quality';

const base: Decision = {
  kind: 'contenu',
  verdict: 'fonde',
  summary: 'La date était erronée, elle a été corrigée.',
  analysis: 'Analyse détaillée suffisamment longue pour passer le contrôle.',
  confidence: 0.9,
  risk_flags: [],
};

describe('agents : sécurité des entrées', () => {
  it('neutralise mentions, balises, blocs de code et caractères de contrôle', () => {
    const s = sanitize('Salut @admin <script>alert(1)</script> ```rm -rf``` ‮texte\u0007');
    expect(s).not.toContain('@');
    expect(s).not.toContain('<script>');
    expect(s).not.toContain('```');
    expect(s).not.toContain('‮');
    expect(sanitize('x'.repeat(5000)).length).toBe(2000);
  });
  it('nettoie récursivement un objet et borne sa taille', () => {
    const v = sanitizeDeep({ a: '@x', b: [1, 2, '<b>y</b>'], c: { d: true } }) as Record<string, unknown>;
    expect(v).toEqual({ a: '＠x', b: [1, 2, 'y'], c: { d: true } });
  });
  it('oriente les signalements vers contenu ou code', () => {
    expect(reportKind({ type: 'erreur_factuelle', question_id: 'q' })).toBe('contenu');
    expect(reportKind({ type: 'bug', question_id: 'q' })).toBe('code');
    expect(reportKind({ type: 'amelioration', question_id: null })).toBe('code');
    expect(reportKind({ type: 'amelioration', question_id: 'q' })).toBe('contenu');
  });
});

describe('agents : décisions', () => {
  it('valide la forme et refuse les champs non modifiables', () => {
    expect(validateShape(base)).toEqual([]);
    expect(validateShape({ ...base, confidence: 3 })).not.toEqual([]);
    expect(validateShape({ ...base, question_patch: { id: 'pirate' } as never })).toContain('champ non modifiable : id');
    expect(validateShape(null)).not.toEqual([]);
  });
  it("applique un correctif sans toucher à l'identité de la question", () => {
    const q = loadSeedQuestions()[0];
    const next = applyPatch(q, { explanation: 'Nouvelle explication, plus complète et plus précise que la précédente.' });
    expect(next.id).toBe(q.id);
    expect(next.prompt).toBe(q.prompt);
    expect(next.explanation).toMatch(/Nouvelle/);
  });
  it('une nouvelle question proposée sans source est bloquée', () => {
    const q = normalizeNewQuestion(
      { id: 'test-sans-source', category: 'sciences', subcategory: 'physique', prompt: 'Question de test sans source ?', choices: ['a', 'b', 'c', 'd'], explanation: 'x'.repeat(40) },
      '2026-11-01',
    );
    expect(q.status).toBe('a_verifier');
    expect(checkQuestion(q).some((i) => i.severity === 'erreur' && /source/.test(i.message))).toBe(true);
  });
});

describe('sauvegardes', () => {
  it('chiffre, déchiffre et refuse une mauvaise phrase secrète', () => {
    const data = Buffer.from(JSON.stringify({ hello: 'monde', n: [1, 2, 3] }));
    const enc = encrypt(data, 'phrase secrète');
    expect(enc.includes(Buffer.from('monde'))).toBe(false);
    expect(decrypt(enc, 'phrase secrète').toString()).toBe(data.toString());
    expect(() => decrypt(enc, 'mauvaise')).toThrow();
  });
});
