// Outil pour humains et agents : chercher un article Wikipédia FR et vérifier un terme dans son texte.
//   npm run content -- wiki search "La Vie en rose"     (via cli)  ou  npx tsx scripts/content/wiki.ts search "..."
//   npx tsx scripts/content/wiki.ts grep "Titre exact" "terme"
import { normalizeText } from './verify-sources';

const UA = 'GrandSavoirBot/1.0 (verification de sources)';
async function api(params: Record<string, string>) {
  const url = 'https://fr.wikipedia.org/w/api.php?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return res.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function wikiSearch(q: string) {
  const d = await api({ action: 'query', list: 'search', srsearch: q, srlimit: '8' });
  return (d.query?.search ?? []).map((r: { title: string }) => r.title) as string[];
}

export async function wikiGrep(title: string, term: string, width = 90) {
  const d = await api({ action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: title });
  const page = d.query?.pages?.[0];
  if (!page || page.missing) return { found: false, title, excerpts: [] as string[], missing: true };
  const text = normalizeText(page.extract ?? '');
  const t = normalizeText(term);
  const excerpts: string[] = [];
  let i = text.indexOf(t);
  while (i >= 0 && excerpts.length < 3) {
    excerpts.push('…' + text.slice(Math.max(0, i - width), i + t.length + width) + '…');
    i = text.indexOf(t, i + t.length);
  }
  return { found: excerpts.length > 0, title: page.title as string, excerpts, missing: false };
}

if (process.argv[1]?.endsWith('wiki.ts')) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'search') console.log(await wikiSearch(a));
  else if (cmd === 'grep') console.log(JSON.stringify(await wikiGrep(a, b), null, 1));
  else console.log('usage : wiki.ts search <texte> | grep <titre> <terme>');
}
