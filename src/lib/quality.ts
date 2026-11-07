// Contrôles qualité des questions : structure, cohérence, doublons, formulations à risque.
// Utilisés par les scripts de contenu, les agents IA (avant toute publication) et les tests.

import { correctAnswerText, normalizeAnswer } from './engine';
import type { Category, Question } from './types';

export type Severity = 'erreur' | 'alerte';
export interface Issue {
  id: string;
  severity: Severity;
  message: string;
}

const DIFFICULTIES = [1, 2, 3, 4, 5];

/** Vérifie une question isolée. */
export function checkQuestion(q: Question, categories?: Category[]): Issue[] {
  const out: Issue[] = [];
  const err = (message: string) => out.push({ id: q.id, severity: 'erreur', message });
  const warn = (message: string) => out.push({ id: q.id, severity: 'alerte', message });

  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(q.id)) err('identifiant invalide (minuscules, chiffres et tirets)');
  if (!q.prompt || q.prompt.trim().length < 10) err('énoncé trop court');
  if (q.prompt.length > 300) warn('énoncé très long (> 300 caractères)');
  if (!q.explanation || q.explanation.trim().length < 30) err('explication absente ou trop courte');
  if (!DIFFICULTIES.includes(q.difficulty)) err('difficulté hors de 1..5');
  if (!Array.isArray(q.themes)) err('thèmes manquants');
  if (!q.sources?.length) err('aucune source');
  for (const s of q.sources ?? []) {
    if (!/^https:\/\/[^\s]+$/.test(s.url)) err(`source sans URL https valide : ${s.title}`);
    if (!s.title) err('source sans titre');
  }
  if (categories) {
    const cat = categories.find((c) => c.id === q.category);
    if (!cat) err(`catégorie inconnue : ${q.category}`);
    else if (!cat.subcategories.some((s) => s.id === q.subcategory)) err(`sous-catégorie inconnue : ${q.subcategory}`);
  }

  switch (q.format) {
    case 'qcm': {
      const c = q.choices ?? [];
      if (c.length < 3 || c.length > 6) err('un QCM doit proposer 3 à 6 réponses');
      if (q.correct === undefined || q.correct < 0 || q.correct >= c.length) err('index de bonne réponse invalide');
      const norm = c.map((x) => normalizeAnswer(x));
      if (new Set(norm).size !== norm.length) err('réponses proposées en double');
      if (c.some((x) => !x.trim())) err('réponse vide');
      if (c.some((x) => /toutes? les? réponses|aucune des réponses/i.test(x)))
        warn('« toutes / aucune des réponses » : formulation à éviter');
      const right = c[q.correct ?? 0] ?? '';
      // La bonne réponse ne doit pas se trahir par sa longueur.
      const others = c.filter((_, i) => i !== q.correct);
      const avg = others.reduce((a, x) => a + x.length, 0) / Math.max(1, others.length);
      if (right.length > avg * 2.2 && right.length > 25) warn('la bonne réponse est beaucoup plus longue que les autres');
      break;
    }
    case 'vrai_faux':
      if (JSON.stringify(q.choices) !== JSON.stringify(['Vrai', 'Faux'])) err('vrai/faux : choix attendus ["Vrai","Faux"]');
      if (q.correct !== 0 && q.correct !== 1) err('vrai/faux : correct doit valoir 0 ou 1');
      if (!/^(vrai|faux)\b/i.test(q.explanation.trim())) warn("l'explication d'un vrai/faux devrait commencer par « Vrai. » ou « Faux. »");
      else if ((q.correct === 0) !== /^vrai/i.test(q.explanation.trim())) err("l'explication contredit la réponse (vrai/faux)");
      break;
    case 'saisie':
      if (!q.accepted?.length) err('saisie : aucune réponse acceptée');
      break;
    case 'classement':
      if (!q.items || q.items.length < 3) err('classement : au moins 3 éléments');
      else if (new Set(q.items).size !== q.items.length) err('classement : éléments en double');
      if (!q.orderLabel) warn('classement : préciser le sens (orderLabel)');
      break;
    case 'association':
      if (!q.pairs || q.pairs.length < 3) err('association : au moins 3 paires');
      else {
        if (new Set(q.pairs.map((p) => p[0])).size !== q.pairs.length) err('association : éléments de gauche en double');
        if (new Set(q.pairs.map((p) => p[1])).size !== q.pairs.length) err('association : éléments de droite en double');
      }
      break;
    default:
      err(`format inconnu : ${(q as Question).format}`);
  }

  // Formulations à risque : absolus, temporalité implicite, négations doubles.
  if (/\b(actuel(le)?ment|aujourd'hui|récemment|cette année|en ce moment)\b/i.test(q.prompt))
    warn('dépend du moment (« actuellement »…) : préciser une date pour éviter que la question se périme');
  if (/\bne\b[^.?]*\bpas\b[^.?]*\bne\b[^.?]*\bpas\b/i.test(q.prompt)) warn('double négation dans l’énoncé');
  if (/\b(toujours|jamais)\b/i.test(q.prompt) && q.format === 'vrai_faux') warn('vrai/faux avec un absolu (toujours/jamais) : vérifier l’absence d’exception');
  return out;
}

/** Similarité de deux énoncés (mots significatifs communs, 0..1). */
export function similarity(a: string, b: string): number {
  return overlap(significantWords(a), significantWords(b));
}
function significantWords(s: string): Set<string> {
  return new Set(
    normalizeAnswer(s)
      .split(' ')
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}
function overlap(A: Set<string>, B: Set<string>): number {
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}
const STOP = new Set(['quel', 'quelle', 'quels', 'quelles', 'dans', 'pour', 'avec', 'sont', 'est-il', 'est-elle', 'cette', 'entre', 'parmi', 'lequel', 'laquelle', 'combien', 'quoi', 'elle', 'ils']);

/** Détecte doublons et questions trop proches (même réponse ET énoncés similaires). */
export function findDuplicates(qs: Question[], threshold = 0.75): Issue[] {
  const out: Issue[] = [];
  const ids = new Set<string>();
  for (const q of qs) {
    if (ids.has(q.id)) out.push({ id: q.id, severity: 'erreur', message: 'identifiant en double' });
    ids.add(q.id);
  }
  const live = qs.filter((q) => q.status !== 'archive');
  // Pré-calcul (une seule normalisation par question) : la comparaison deux à deux reste rapide avec des milliers de questions.
  // On compare l'énoncé ET la réponse : deux consignes génériques (« Associe… ») ne sont pas des doublons.
  const sets = live.map((q) => significantWords(`${q.prompt} ${correctAnswerText(q)}`));
  const prompts = live.map((q) => normalizeAnswer(q.prompt));
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const sim = overlap(sets[i], sets[j]);
      if (prompts[i] === prompts[j]) {
        out.push({ id: b.id, severity: 'erreur', message: `énoncé identique à ${a.id}` });
      } else if (sim >= threshold) {
        out.push({ id: b.id, severity: 'alerte', message: `très proche de ${a.id} (similarité ${Math.round(sim * 100)} %)` });
      }
    }
  }
  return out;
}

/** Vérifie que les liens « voir aussi » et les parcours pointent vers des questions existantes. */
export function checkReferences(qs: Question[], pathQuestionIds: string[] = []): Issue[] {
  const ids = new Set(qs.map((q) => q.id));
  const out: Issue[] = [];
  for (const q of qs) for (const r of q.seeAlso ?? []) if (!ids.has(r)) out.push({ id: q.id, severity: 'erreur', message: `voir-aussi inconnu : ${r}` });
  for (const id of pathQuestionIds) if (!ids.has(id)) out.push({ id, severity: 'erreur', message: 'question de parcours inexistante' });
  return out;
}

/** Contenu possiblement obsolète : vérification trop ancienne. */
export function findStale(qs: Question[], now: number, maxAgeDays = 365): Issue[] {
  return qs
    .filter((q) => q.status === 'publie')
    .filter((q) => !q.verifiedAt || now - Date.parse(q.verifiedAt) > maxAgeDays * 86400000)
    .map((q) => ({ id: q.id, severity: 'alerte' as const, message: `dernière vérification trop ancienne (${q.verifiedAt ?? 'jamais'})` }));
}
