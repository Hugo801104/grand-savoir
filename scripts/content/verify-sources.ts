// Vérifie les sources des questions : chaque page doit exister et contenir les termes de contrôle.
// Pour Wikipédia, on lit le texte brut via l'API officielle (suit les redirections).
// Usage : npm run content:verify-sources [-- --ids=id1,id2] [--json=fichier]
//
// Sert à deux choses : empêcher les sources inventées (page inexistante = échec) et
// détecter les contenus devenus incohérents avec leur source (terme absent = alerte).

import { writeFileSync } from 'node:fs';
import type { Question, Source } from '../../src/lib/types';
import { loadSeedQuestions } from './seed';

const UA = 'GrandSavoirBot/1.0 (verification de sources ; https://github.com/Hugo801104/grand-savoir)';
const cache = new Map<string, Promise<{ ok: boolean; text: string; finalTitle?: string; error?: string }>>();

export function normalizeText(s: string): string {
  return s
    .replace(/[    ]/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function fetchWithRetry(url: string, tries = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
      if (res.status === 429 && i < tries) {
        await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after") ?? 0) * 1000 || 3000 * (i + 1)));
        continue;
      }
      return res;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function fetchSource(url: string) {
  if (!cache.has(url)) {
    cache.set(
      url,
      (async () => {
        const m = url.match(/^https:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/);
        try {
          if (m) {
            const title = decodeURIComponent(m[2]);
            const api = `https://${m[1]}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(title)}`;
            const res = await fetchWithRetry(api);
            if (!res.ok) return { ok: false, text: '', error: `HTTP ${res.status}` };
            const data = (await res.json()) as { query?: { pages?: { missing?: boolean; title: string; extract?: string }[] } };
            const page = data.query?.pages?.[0];
            if (!page || page.missing) return { ok: false, text: '', error: 'page Wikipédia inexistante' };
            return { ok: true, text: normalizeText(page.extract ?? ''), finalTitle: page.title };
          }
          const res = await fetchWithRetry(url);
          if (!res.ok) return { ok: false, text: '', error: `HTTP ${res.status}` };
          const html = await res.text();
          return { ok: true, text: normalizeText(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')) };
        } catch (e) {
          return { ok: false, text: '', error: (e as Error).message };
        }
      })(),
    );
  }
  return cache.get(url)!;
}

export interface SourceResult {
  questionId: string;
  url: string;
  ok: boolean;
  missingTerms: string[];
  error?: string;
  finalTitle?: string;
}

export async function verifySource(questionId: string, s: Source): Promise<SourceResult> {
  const r = await fetchSource(s.url);
  if (!r.ok) return { questionId, url: s.url, ok: false, missingTerms: s.checks ?? [], error: r.error };
  const missing = (s.checks ?? []).filter((t) => !r.text.includes(normalizeText(t)));
  return { questionId, url: s.url, ok: missing.length === 0, missingTerms: missing, finalTitle: r.finalTitle };
}

export async function verifyQuestions(qs: Question[], concurrency = 2): Promise<SourceResult[]> {
  const jobs = qs.flatMap((q) => q.sources.map((s) => () => verifySource(q.id, s)));
  const results: SourceResult[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < jobs.length) {
        const job = jobs[i++];
        results.push(await job());
      }
    }),
  );
  return results;
}

// Exécution en ligne de commande
if (process.argv[1]?.endsWith('verify-sources.ts')) {
  const idsArg = process.argv.find((a) => a.startsWith('--ids='))?.slice(6);
  const jsonArg = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
  let qs = loadSeedQuestions();
  if (idsArg) qs = qs.filter((q) => idsArg.split(',').includes(q.id));
  const results = await verifyQuestions(qs);
  const failed = results.filter((r) => !r.ok);
  for (const r of failed) {
    console.log(`✖ ${r.questionId} — ${r.url}\n    ${r.error ?? 'termes introuvables : ' + r.missingTerms.join(', ')}`);
  }
  console.log(`\n${results.length} sources vérifiées pour ${qs.length} questions : ${results.length - failed.length} OK, ${failed.length} en échec.`);
  if (jsonArg) writeFileSync(jsonArg, JSON.stringify({ date: new Date().toISOString(), results }, null, 1));
  process.exit(failed.length ? 1 : 0);
}
