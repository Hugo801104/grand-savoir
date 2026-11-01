// Construit public/content/bundle.json : le fichier de données des questions publiées, téléchargé par l'appli
// au démarrage (et gardé hors-ligne). Il est séparé du code : l'appli compare sa version et se met à jour seule.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentBundle } from '../../src/lib/types';
import { loadCategories, loadPaths, loadSeedQuestions, ROOT } from './seed';

const categories = loadCategories();
const paths = loadPaths();
const questions = loadSeedQuestions().filter((q) => q.status === 'publie');
const body = JSON.stringify({ categories, paths, questions });
const bundle: ContentBundle = {
  version: 'local-' + createHash('sha256').update(body).digest('hex').slice(0, 12),
  generatedAt: new Date().toISOString(),
  categories,
  paths,
  questions,
};
const dir = join(ROOT, 'public', 'content');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'bundle.json'), JSON.stringify(bundle));
console.log(`bundle.json : ${questions.length} questions (${bundle.version})`);
