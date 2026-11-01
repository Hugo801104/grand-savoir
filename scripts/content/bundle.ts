// Construit public/content/bundle.json : contenu de démonstration utilisé UNIQUEMENT quand
// l'appli tourne sans base de données (mode local). En production, les questions viennent de Supabase.
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentBundle } from '../../src/lib/types';
import { loadCategories, loadPaths, loadSeedQuestions, ROOT } from './seed';

// En production (base configurée), les questions viennent UNIQUEMENT de Supabase : pas de paquet local.
if (process.env.VITE_SUPABASE_URL) {
  rmSync(join(ROOT, 'public', 'content', 'bundle.json'), { force: true });
  console.log('Base configurée : aucun paquet de contenu local généré.');
  process.exit(0);
}

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
