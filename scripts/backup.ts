// Sauvegarde chiffrée de la base (contenus + données utilisateur) et restauration.
//   npm run backup -- create <fichier.enc>    (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUP_PASSPHRASE)
//   npm run backup -- verify <fichier.enc>    déchiffre et vérifie la structure (test de restauration à blanc)
//   npm run backup -- restore <fichier.enc> [--content-only]   réinsère sans écraser (lignes existantes ignorées)
//
// Chiffrement AES-256-GCM, clé dérivée de la phrase secrète (scrypt). Sans la phrase, la sauvegarde est illisible :
// elle peut donc être stockée comme artefact GitHub même si le dépôt est public.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { adminClient, env, must } from './agent/lib';

const TABLES = [
  'categories', 'paths', 'questions', 'question_history', 'system_config',
  'reports', 'ai_proposals', 'agent_runs', 'answer_events', 'user_settings', 'admins',
] as const;
const CONTENT = new Set(['categories', 'paths', 'questions', 'question_history', 'system_config']);
const KEYS: Record<string, string> = { system_config: 'key', user_settings: 'user_id', admins: 'user_id' };

export function encrypt(plain: Buffer, pass: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(pass, salt, 32);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(gzipSync(plain)), c.final()]);
  return Buffer.concat([Buffer.from('GSB1'), salt, iv, c.getAuthTag(), enc]);
}
export function decrypt(buf: Buffer, pass: string): Buffer {
  if (buf.subarray(0, 4).toString() !== 'GSB1') throw new Error('format de sauvegarde inconnu');
  const salt = buf.subarray(4, 20);
  const iv = buf.subarray(20, 32);
  const tag = buf.subarray(32, 48);
  const d = createDecipheriv('aes-256-gcm', scryptSync(pass, salt, 32), iv);
  d.setAuthTag(tag);
  return gunzipSync(Buffer.concat([d.update(buf.subarray(48)), d.final()]));
}

type Dump = { app: 'grand-savoir'; createdAt: string; tables: Record<string, unknown[]> };

function verifyDump(d: Dump): string[] {
  const errs: string[] = [];
  if (d.app !== 'grand-savoir') errs.push('en-tête invalide');
  for (const t of TABLES) if (!Array.isArray(d.tables?.[t])) errs.push(`table manquante : ${t}`);
  const qs = (d.tables.questions ?? []) as { id?: string; prompt?: string }[];
  if (qs.some((q) => !q.id || !q.prompt)) errs.push('questions incomplètes');
  return errs;
}

if (process.argv[1]?.endsWith('backup.ts')) {
  const [cmd, file] = process.argv.slice(2);
  if (!file) throw new Error('fichier requis');
  if (cmd === 'create') {
    const db = adminClient();
    const tables: Record<string, unknown[]> = {};
    for (const t of TABLES) {
      const rows: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const page = (await must(db.from(t).select('*').range(from, from + 999))) as unknown[];
        rows.push(...page);
        if (page.length < 1000) break;
      }
      tables[t] = rows;
    }
    const dump: Dump = { app: 'grand-savoir', createdAt: new Date().toISOString(), tables };
    const enc = encrypt(Buffer.from(JSON.stringify(dump)), env('BACKUP_PASSPHRASE'));
    writeFileSync(file, enc);
    // Test immédiat : la sauvegarde doit se relire et rester cohérente.
    const back = JSON.parse(decrypt(readFileSync(file), env('BACKUP_PASSPHRASE')).toString()) as Dump;
    const errs = verifyDump(back);
    for (const t of TABLES) if (back.tables[t].length !== tables[t].length) errs.push(`nombre de lignes différent : ${t}`);
    if (errs.length) throw new Error('Sauvegarde invalide : ' + errs.join(', '));
    console.log('Sauvegarde vérifiée :', Object.fromEntries(TABLES.map((t) => [t, tables[t].length])));
  } else if (cmd === 'verify') {
    const dump = JSON.parse(decrypt(readFileSync(file), env('BACKUP_PASSPHRASE')).toString()) as Dump;
    const errs = verifyDump(dump);
    console.log(errs.length ? `❌ ${errs.join(', ')}` : `✅ Sauvegarde du ${dump.createdAt} lisible et complète.`);
    process.exit(errs.length ? 1 : 0);
  } else if (cmd === 'restore') {
    const contentOnly = process.argv.includes('--content-only');
    const dump = JSON.parse(decrypt(readFileSync(file), env('BACKUP_PASSPHRASE')).toString()) as Dump;
    const db = adminClient();
    for (const t of TABLES) {
      if (contentOnly && !CONTENT.has(t)) continue;
      const rows = (dump.tables[t] as Record<string, unknown>[]).map((r) => {
        const { fingerprint: _f, ...rest } = r; // colonne calculée
        return rest;
      });
      for (let i = 0; i < rows.length; i += 500) {
        await must(db.from(t).upsert(rows.slice(i, i + 500), { onConflict: KEYS[t] ?? 'id', ignoreDuplicates: true }));
      }
      console.log(`${t} : ${rows.length} ligne(s) examinée(s)`);
    }
  }
}
