// Quand une Pull Request de l'agent est fusionnée (validée) ou fermée (refusée) par un humain,
// met à jour le ticket de signalement lié : statut affiché dans l'appli + compte rendu.
// Variables : PR_BODY, PR_MERGED ('true'|'false'), PR_URL, GITHUB_TOKEN, GITHUB_REPOSITORY.

import { comment, env, setIssueStatus } from './lib';

const m = (process.env.PR_BODY ?? '').match(/Signalement #(\d+)/);
if (!m) {
  console.log('Pull Request sans signalement lié.');
  process.exit(0);
}
const issue = Number(m[1]);
const merged = env('PR_MERGED') === 'true';
if (merged) {
  await comment(issue, `✅ La correction a été validée et publiée (${env('PR_URL')}). Elle sera disponible dans l'appli après la prochaine mise à jour du contenu.`);
  await setIssueStatus(issue, 'corrige', 'completed');
} else {
  await comment(issue, `La proposition n'a pas été retenue après relecture (${env('PR_URL')}).`);
  await setIssueStatus(issue, 'rejete', 'not_planned');
}
console.log(`#${issue} → ${merged ? 'corrigé' : 'rejeté'}`);
