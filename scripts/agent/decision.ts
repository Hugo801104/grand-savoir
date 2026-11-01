// Format de la décision rendue par l'agent IA, et contrôles déterministes appliqués AVANT toute publication.
// Ces contrôles n'ont besoin d'aucun secret : l'agent peut les lancer lui-même pour se corriger
//   npx tsx scripts/agent/check-proposal.ts <fichier decision.json> <fichier tâche>

import { correctAnswerText } from '../../src/lib/engine';
import { checkQuestion, findDuplicates, type Issue } from '../../src/lib/quality';
import type { Category, Question } from '../../src/lib/types';
import { verifyQuestions } from '../content/verify-sources';

export const RISK_FLAGS = ['controverse', 'sensible', 'fait_evolutif', 'source_unique', 'incertitude', 'hors_sujet', 'malveillant'] as const;

export type QuestionPatch = Partial<
  Pick<Question, 'prompt' | 'choices' | 'correct' | 'accepted' | 'items' | 'orderLabel' | 'pairs' | 'explanation' | 'anecdote' | 'sources' | 'difficulty' | 'themes' | 'subcategory'>
>;

export interface Decision {
  report_id?: string;
  /** contenu : correction ou nouvelle question ; code : modification du code ; aucune_action */
  kind: 'contenu' | 'code' | 'aucune_action';
  /** Le signalement est-il fondé ? */
  verdict: 'fonde' | 'partiel' | 'non_fonde' | 'incertain';
  /** 1 à 3 phrases, en français, lisibles par l'utilisateur dans l'appli */
  summary: string;
  /** Compte rendu détaillé en Markdown (problème, sources consultées, correction, vérifications) */
  analysis: string;
  /** 0..1 : confiance dans la correction proposée */
  confidence: number;
  risk_flags: string[];
  question_patch?: QuestionPatch | null;
  new_questions?: Partial<Question>[] | null;
  code_change?: { title: string; description: string } | null;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  sourcesVerified: number;
  answerChanged: boolean;
  questions: Question[];
}

const PATCH_KEYS = ['prompt', 'choices', 'correct', 'accepted', 'items', 'orderLabel', 'pairs', 'explanation', 'anecdote', 'sources', 'difficulty', 'themes', 'subcategory'];

export function validateShape(d: unknown): string[] {
  const e: string[] = [];
  const x = d as Decision;
  if (!x || typeof x !== 'object') return ['décision absente ou invalide'];
  if (!['contenu', 'code', 'aucune_action'].includes(x.kind)) e.push('kind invalide');
  if (!['fonde', 'partiel', 'non_fonde', 'incertain'].includes(x.verdict)) e.push('verdict invalide');
  if (typeof x.summary !== 'string' || x.summary.length < 10 || x.summary.length > 600) e.push('summary : 10 à 600 caractères');
  if (typeof x.analysis !== 'string' || x.analysis.length < 30) e.push('analysis trop courte');
  if (typeof x.confidence !== 'number' || x.confidence < 0 || x.confidence > 1) e.push('confidence doit être entre 0 et 1');
  if (!Array.isArray(x.risk_flags)) e.push('risk_flags doit être un tableau');
  if (x.question_patch) {
    for (const k of Object.keys(x.question_patch)) if (!PATCH_KEYS.includes(k)) e.push(`champ non modifiable : ${k}`);
  }
  return e;
}

/** Construit la question corrigée (format appli) à partir de l'existante et du correctif. */
export function applyPatch(current: Question, patch: QuestionPatch): Question {
  const next: Question = { ...current, ...patch } as Question;
  next.sources = (patch.sources ?? current.sources).map((s) => ({ title: s.title, url: s.url, checks: s.checks ?? [] }));
  return next;
}

/** Contrôles complets d'une ou plusieurs questions : structure, doublons, sources réellement vérifiées. */
export async function checkCandidates(
  candidates: Question[],
  context: { categories: Category[]; existing: Question[]; replacing?: string },
): Promise<CheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fmt = (i: Issue) => `${i.id} : ${i.message}`;
  for (const q of candidates) {
    for (const i of checkQuestion(q, context.categories)) (i.severity === 'erreur' ? errors : warnings).push(fmt(i));
    // Chaque source doit porter au moins un terme de contrôle : on prouve qu'elle dit bien ce qu'on affirme.
    if (!q.sources.length || q.sources.some((s) => !s.checks?.length)) errors.push(`${q.id} : chaque source doit avoir des termes de contrôle (checks)`);
  }
  const others = context.existing.filter((q) => q.id !== context.replacing && !candidates.some((c) => c.id === q.id));
  for (const i of findDuplicates([...others, ...candidates])) {
    if (candidates.some((c) => c.id === i.id)) (i.severity === 'erreur' ? errors : warnings).push(fmt(i));
  }
  // Vérification en ligne des sources (pages existantes + termes présents).
  const results = await verifyQuestions(candidates);
  for (const r of results.filter((x) => !x.ok)) {
    errors.push(`${r.questionId} : source non vérifiée ${r.url} (${r.error ?? 'termes absents : ' + r.missingTerms.join(', ')})`);
  }
  const before = context.replacing ? context.existing.find((q) => q.id === context.replacing) : undefined;
  const answerChanged = !!before && candidates.length === 1 && correctAnswerText(before) !== correctAnswerText(candidates[0]);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    sourcesVerified: results.filter((x) => x.ok).length,
    answerChanged,
    questions: candidates,
  };
}

/** Normalise une nouvelle question proposée par l'IA (champs par défaut, statut brouillon). */
export function normalizeNewQuestion(p: Partial<Question>, today: string): Question {
  return {
    id: String(p.id ?? ''),
    version: 1,
    status: 'a_verifier',
    format: p.format ?? 'qcm',
    category: String(p.category ?? ''),
    subcategory: String(p.subcategory ?? ''),
    themes: p.themes ?? [],
    difficulty: (p.difficulty ?? 2) as Question['difficulty'],
    prompt: String(p.prompt ?? ''),
    choices: p.format === 'vrai_faux' ? ['Vrai', 'Faux'] : p.choices,
    correct: p.correct ?? (p.format === 'qcm' || p.format === 'vrai_faux' || !p.format ? 0 : undefined),
    accepted: p.accepted,
    items: p.items,
    orderLabel: p.orderLabel,
    pairs: p.pairs,
    explanation: String(p.explanation ?? ''),
    anecdote: p.anecdote,
    seeAlso: p.seeAlso ?? [],
    sources: (p.sources ?? []).map((s) => ({ title: s.title, url: s.url, checks: s.checks ?? [] })),
    origin: 'ia',
    createdAt: today,
    verifiedAt: today,
  };
}
