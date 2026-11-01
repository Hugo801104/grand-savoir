// Maintenance mensuelle : revérifie toutes les sources en ligne et repère les vérifications anciennes.
// S'il y a des problèmes, ouvre (ou met à jour) un ticket « Maintenance du contenu » ; l'agent ou un humain
// pourra ensuite corriger. Sans GITHUB_TOKEN (exécution locale), affiche simplement le rapport.

import { findStale } from '../../src/lib/quality';
import { gh, repo } from '../agent/lib';
import { loadSeedQuestions } from './seed';
import { verifyQuestions } from './verify-sources';

const questions = loadSeedQuestions().filter((q) => q.status === 'publie');
const results = await verifyQuestions(questions);
const failed = results.filter((r) => !r.ok);
const stale = findStale(questions, Date.now(), 365);

const lines = [
  `Vérification du ${new Date().toLocaleDateString('fr-FR')} : ${results.length} sources pour ${questions.length} questions.`,
  '',
  failed.length ? `### Sources en échec (${failed.length})` : '✅ Toutes les sources sont accessibles et contiennent les termes attendus.',
  ...failed.map((r) => `- \`${r.questionId}\` — ${r.url} : ${r.error ?? 'termes introuvables : ' + r.missingTerms.join(', ')}`),
  '',
  stale.length ? `### Questions à revérifier (dernière vérification > 1 an) : ${stale.length}` : '',
  ...stale.slice(0, 100).map((i) => `- \`${i.id}\` : ${i.message}`),
];
console.log(lines.join('\n'));

if (process.env.GITHUB_TOKEN && (failed.length || stale.length)) {
  const title = 'Maintenance du contenu : sources ou vérifications à revoir';
  const open = await gh<{ number: number; title: string }[]>('GET', `/repos/${repo()}/issues?labels=maintenance&state=open&per_page=20`);
  const existing = open.find((i) => i.title === title);
  if (existing) await gh('POST', `/repos/${repo()}/issues/${existing.number}/comments`, { body: lines.join('\n') });
  else await gh('POST', `/repos/${repo()}/issues`, { title, body: lines.join('\n'), labels: ['maintenance'] });
}
