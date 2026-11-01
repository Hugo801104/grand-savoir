// Prépare une Pull Request à partir du correctif produit par l'agent (aucune exécution du code modifié ici).
//   npx tsx scripts/agent/prepare-pr.ts <reportId>
// Sorties GitHub : ok=true|false, branch, title ; fichier .agent/pr/body.md
// Refuse tout correctif qui touche autre chose que src/ ou tests/ (workflows, scripts d'agent, dépendances…).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Decision } from './decision';
import { readJson, sanitize, setOutput } from './lib';

const id = process.argv[2] ?? '';
if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('identifiant de signalement invalide');
const dir = `.agent/out/${id}`;
const no = (why: string) => {
  console.log(`Pas de Pull Request : ${why}`);
  setOutput('ok', 'false');
  process.exit(0);
};

if (!existsSync(`${dir}/decision.json`)) no('aucune décision');
const d = readJson<Decision>(`${dir}/decision.json`);
if (d.kind !== 'code') no('signalement de contenu');
const patch = existsSync(`${dir}/patch.diff`) ? readFileSync(`${dir}/patch.diff`, 'utf8') : '';
if (!patch.trim()) no('aucune modification de code');
if (patch.length > 200_000) no('correctif trop volumineux pour une correction ciblée');

const files = [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].flatMap((m) => [m[1], m[2]]);
const forbidden = files.filter((f) => !/^(src|tests)\//.test(f) || f.includes('..'));
if (forbidden.length) no(`fichiers non autorisés : ${[...new Set(forbidden)].join(', ')}`);

const tests = existsSync(`${dir}/tests.txt`) ? readFileSync(`${dir}/tests.txt`, 'utf8') : 'non exécutés';
const testsOk = /^OK/.test(tests);
const title = sanitize(d.code_change?.title || d.summary, 100).replace(/\s+/g, ' ');
mkdirSync('.agent/pr', { recursive: true });
writeFileSync(
  '.agent/pr/body.md',
  [
    `## Proposition de l'agent (signalement \`${id}\`)`,
    '',
    sanitize(d.code_change?.description ?? d.summary, 5000),
    '',
    `**Verdict :** ${d.verdict} · **confiance :** ${Math.round(d.confidence * 100)} %`,
    '',
    '### Analyse',
    sanitize(d.analysis, 20000),
    '',
    `### Vérifications automatiques ${testsOk ? '✅' : '❌'}`,
    '```text',
    sanitize(tests, 6000),
    '```',
    '',
    `Fichiers modifiés : ${[...new Set(files)].map((f) => '`' + f + '`').join(', ')}`,
    '',
    '> ⚠️ Modification générée automatiquement : **relecture humaine obligatoire** avant fusion. Rien n’est mis en ligne tant que cette PR n’est pas fusionnée dans `main`.',
  ].join('\n'),
);
setOutput('ok', 'true');
setOutput('branch', `agent/signalement-${id.slice(0, 8)}`);
setOutput('title', `[Agent] ${title}`);
setOutput('tests_ok', String(testsOk));
