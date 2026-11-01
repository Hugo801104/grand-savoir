import { describe, expect, it } from 'vitest';
import { applyPatch, normalizeNewQuestion, validateShape, type Decision } from '../scripts/agent/decision';
import { computeBudget, loadConfig, parseReportIssue, reportKind, sanitize, sanitizeDeep } from '../scripts/agent/lib';
import { issueUrl } from '../src/lib/github';
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

describe('signalements via GitHub', () => {
  it("le ticket pré-rempli par l'appli est relu correctement par l'agent", () => {
    const url = issueUrl(
      {
        id: '12345678-aaaa-4bbb-8ccc-1234567890ab', type: 'erreur_factuelle', comment: 'La date est 1515, pas 1516 @toi',
        questionId: 'hf-marignan', questionVersion: 2, snapshot: { enonce: 'En quelle année…' }, appVersion: '1.0.0',
        clientInfo: { ecran: '412x915' }, createdAt: '2026-11-01T10:00:00Z', status: 'nouveau', sent: false,
      },
      'Erreur factuelle',
    );
    const u = new URL(url);
    expect(u.searchParams.get('labels')).toBe('signalement');
    expect(u.searchParams.get('title')).toContain('ref-12345678');
    const parsed = parseReportIssue(u.searchParams.get('body'));
    expect(parsed.type).toBe('erreur_factuelle');
    expect(parsed.question_id).toBe('hf-marignan');
    expect(parsed.question_version).toBe(2);
    expect(parsed.comment).toBe('La date est 1515, pas 1516 ＠toi');
  });
  it('un ticket écrit à la main reste exploitable', () => {
    const p = parseReportIssue('Il y a une faute dans la question sur Waterloo');
    expect(p.type).toBe('autre');
    expect(p.comment).toMatch(/Waterloo/);
  });
});

describe('garde-fous de coûts', () => {
  const cfg = { ...loadConfig(), agent_enabled: true, max_runs_per_day: 2, monthly_budget_usd: 1 };
  const now = Date.parse('2026-11-15T12:00:00Z');
  it('bloque au-delà du plafond quotidien ou du budget mensuel', () => {
    expect(computeBudget(cfg, [], now).allowed).toBe(true);
    const runs = [
      { date: '2026-11-15T10:00:00Z', kind: 'signalement:contenu', status: 'succes' as const, cost_usd: 0.2 },
      { date: '2026-11-15T11:00:00Z', kind: 'signalement:contenu', status: 'succes' as const, cost_usd: 0.2 },
    ];
    expect(computeBudget(cfg, runs, now).allowed).toBe(false);
    const costly = [{ date: '2026-11-02T10:00:00Z', kind: 'x', status: 'succes' as const, cost_usd: 1.2 }];
    expect(computeBudget(cfg, costly, now).reason).toMatch(/budget/);
    expect(computeBudget({ ...cfg, agent_enabled: false }, [], now).allowed).toBe(false);
  });
});
