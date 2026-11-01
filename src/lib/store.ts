// État global de l'appli : contenu, journal de réponses, réglages, signalements, compte.
// Local d'abord : tout est enregistré dans IndexedDB, puis synchronisé si un compte est connecté.

import { useSyncExternalStore } from 'react';
import { APP_VERSION, hasBackend } from './config';
import { getSupabase } from './supabase';
import { KEYS, load, remove, requestPersistence, save } from './storage';
import { buildAllCards, type CardState, mergeEvents } from './srs';
import { rowToQuestion, type CategoryRow, type PathRow, type QuestionRow } from './rows';
import {
  type AnswerEvent,
  type ContentBundle,
  DEFAULT_SETTINGS,
  type Report,
  type ReportType,
  type Settings,
} from './types';

export type SyncStatus = 'local' | 'idle' | 'syncing' | 'error' | 'offline';

export interface AppState {
  ready: boolean;
  content: ContentBundle | null;
  contentError: string | null;
  events: AnswerEvent[];
  cards: Map<string, CardState>;
  settings: Settings;
  reports: Report[];
  user: { id: string; email: string | null } | null;
  isAdmin: boolean;
  sync: SyncStatus;
  syncError: string | null;
  lastSync: number | null;
}

let state: AppState = {
  ready: false,
  content: null,
  contentError: null,
  events: [],
  cards: new Map(),
  settings: DEFAULT_SETTINGS,
  reports: [],
  user: null,
  isAdmin: false,
  sync: hasBackend() ? 'idle' : 'local',
  syncError: null,
  lastSync: null,
};

const listeners = new Set<() => void>();
function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getState = () => state;
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

export async function init(): Promise<void> {
  const [content, events, settings, reports] = await Promise.all([
    load<ContentBundle | null>(KEYS.content, null),
    load<AnswerEvent[]>(KEYS.events, []),
    load<Settings>(KEYS.settings, DEFAULT_SETTINGS),
    load<Report[]>(KEYS.reports, []),
  ]);
  setState({
    ready: !!content,
    content,
    events,
    cards: buildAllCards(events),
    settings: { ...DEFAULT_SETTINGS, ...settings },
    reports,
  });
  void requestPersistence();
  await initAuth();
  await refreshContent();
  setState({ ready: true });
  void syncNow();
  // Synchro au retour sur l'appli et au retour du réseau.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void syncNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void refreshContent();
        void syncNow();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Contenu : depuis Supabase (questions publiées), sinon depuis le paquet de démonstration.
// ---------------------------------------------------------------------------

export async function refreshContent(force = false): Promise<void> {
  try {
    const current = state.content;
    const sb = await getSupabase();
    let bundle: ContentBundle | null = null;
    if (sb) {
      const { data: meta, error } = await sb.from('content_meta').select('version').eq('id', 1).maybeSingle();
      if (error) throw error;
      const version = String(meta?.version ?? '0');
      if (!force && current && current.version === version) return;
      const questions: QuestionRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error: e } = await sb
          .from('questions')
          .select('*')
          .eq('status', 'publie')
          .order('id')
          .range(from, from + 999);
        if (e) throw e;
        questions.push(...((data ?? []) as QuestionRow[]));
        if (!data || data.length < 1000) break;
      }
      const [{ data: cats, error: ec }, { data: paths, error: ep }] = await Promise.all([
        sb.from('categories').select('*').order('position'),
        sb.from('paths').select('*').eq('status', 'publie'),
      ]);
      if (ec) throw ec;
      if (ep) throw ep;
      bundle = {
        version,
        generatedAt: new Date().toISOString(),
        categories: (cats ?? []) as CategoryRow[],
        paths: ((paths ?? []) as PathRow[]).map(({ status: _s, ...p }) => p),
        questions: questions.map(rowToQuestion),
      };
    } else {
      const res = await fetch(`${import.meta.env.BASE_URL}content/bundle.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Contenu introuvable (${res.status})`);
      const b = (await res.json()) as ContentBundle;
      if (!force && current && current.version === b.version) return;
      bundle = b;
    }
    if (bundle && bundle.questions.length > 0) {
      await save(KEYS.content, bundle);
      setState({ content: bundle, contentError: null });
    }
  } catch (e) {
    // Hors-ligne : on garde le contenu déjà téléchargé.
    setState({ contentError: state.content ? null : (e as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

export async function recordAnswer(e: Omit<AnswerEvent, 'id' | 'at' | 'synced'>): Promise<void> {
  const ev: AnswerEvent = { ...e, id: uuid(), at: Date.now(), synced: false };
  const events = [...state.events, ev];
  setState({ events, cards: buildAllCards(events) });
  await save(KEYS.events, events);
  scheduleSync();
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const settings = { ...state.settings, ...patch, updatedAt: Date.now() };
  setState({ settings });
  await save(KEYS.settings, settings);
  scheduleSync();
}

// ---------------------------------------------------------------------------
// Signalements
// ---------------------------------------------------------------------------

const REPORT_LIMIT_PER_HOUR = 15;

export function clientInfo(): Record<string, string> {
  // Uniquement des informations techniques non sensibles.
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    plateforme: nav?.userAgent.match(/\(([^)]+)\)/)?.[1]?.slice(0, 80) ?? 'inconnue',
    ecran: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    langue: nav?.language ?? '',
    installee: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches ? 'oui' : 'non',
    contenu: state.content?.version ?? '',
  };
}

export async function submitReport(input: {
  type: ReportType;
  comment: string;
  questionId?: string | null;
  snapshot?: Record<string, unknown> | null;
  questionVersion?: number | null;
}): Promise<{ ok: boolean; message: string }> {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = state.reports.filter((r) => Date.parse(r.createdAt) > hourAgo).length;
  if (recent >= REPORT_LIMIT_PER_HOUR) {
    return { ok: false, message: 'Beaucoup de signalements envoyés cette heure-ci : réessaie un peu plus tard.' };
  }
  const report: Report = {
    id: uuid(),
    type: input.type,
    comment: input.comment.trim().slice(0, 2000),
    questionId: input.questionId ?? null,
    questionVersion: input.questionVersion ?? null,
    snapshot: input.snapshot ?? null,
    appVersion: APP_VERSION,
    clientInfo: clientInfo(),
    createdAt: new Date().toISOString(),
    status: 'nouveau',
    sent: false,
  };
  const reports = [report, ...state.reports];
  setState({ reports });
  await save(KEYS.reports, reports);
  await sendPendingReports();
  const sent = state.reports.find((r) => r.id === report.id)?.sent;
  return {
    ok: true,
    message: sent
      ? 'Merci ! Ton signalement est enregistré. Tu peux suivre son traitement dans « Mes signalements ».'
      : state.user
        ? "Merci ! Signalement enregistré sur l'appareil ; il sera envoyé dès le retour du réseau."
        : 'Merci ! Signalement enregistré sur cet appareil. Connecte-toi (Réglages) pour qu’il soit transmis et traité.',
  };
}

async function sendPendingReports(): Promise<void> {
  const sb = await getSupabase();
  if (!sb || !state.user) return;
  const pending = state.reports.filter((r) => !r.sent);
  if (!pending.length) return;
  const { error } = await sb.from('reports').upsert(
    pending.map((r) => ({
      id: r.id,
      type: r.type,
      comment: r.comment,
      question_id: r.questionId,
      question_version: r.questionVersion,
      snapshot: r.snapshot,
      app_version: r.appVersion,
      client_info: r.clientInfo,
      created_at: r.createdAt,
    })),
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw error;
  const ids = new Set(pending.map((r) => r.id));
  const reports = state.reports.map((r) => (ids.has(r.id) ? { ...r, sent: true } : r));
  setState({ reports });
  await save(KEYS.reports, reports);
}

async function pullReportStatuses(): Promise<void> {
  const sb = await getSupabase();
  if (!sb || !state.user) return;
  const { data, error } = await sb
    .from('reports')
    .select('id,status,resolution,issue_url,type,comment,question_id,question_version,snapshot,app_version,client_info,created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const byId = new Map(state.reports.map((r) => [r.id, r]));
  for (const row of data ?? []) {
    const prev = byId.get(row.id);
    byId.set(row.id, {
      id: row.id,
      type: row.type,
      comment: row.comment,
      questionId: row.question_id,
      questionVersion: row.question_version,
      snapshot: row.snapshot,
      appVersion: row.app_version,
      clientInfo: row.client_info ?? {},
      createdAt: row.created_at,
      ...prev,
      status: row.status,
      resolution: row.resolution,
      issueUrl: row.issue_url,
      sent: true,
    });
  }
  const reports = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  setState({ reports });
  await save(KEYS.reports, reports);
}

// ---------------------------------------------------------------------------
// Compte et synchronisation
// ---------------------------------------------------------------------------

async function initAuth(): Promise<void> {
  const sb = await getSupabase();
  if (!sb) return;
  try {
    const { data } = await sb.auth.getSession();
    await applySession(data.session?.user ?? null);
    sb.auth.onAuthStateChange((_evt, session) => {
      void applySession(session?.user ?? null);
    });
  } catch {
    /* hors-ligne : on réessaiera */
  }
}

async function applySession(user: { id: string; email?: string | null } | null) {
  if ((user?.id ?? null) === (state.user?.id ?? null)) return;
  setState({ user: user ? { id: user.id, email: user.email ?? null } : null, isAdmin: false });
  if (!user) return;
  const sb = await getSupabase();
  try {
    const { data } = await sb!.rpc('is_admin');
    setState({ isAdmin: data === true });
  } catch {
    /* pas grave */
  }
  void syncNow();
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const sb = await getSupabase();
  if (!sb) return 'Synchronisation non configurée.';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error ? traduireErreur(error.message) : null;
}

export async function signUp(email: string, password: string): Promise<string | null> {
  const sb = await getSupabase();
  if (!sb) return 'Synchronisation non configurée.';
  const { error, data } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) return traduireErreur(error.message);
  if (!data.session) return 'Compte créé : confirme ton adresse grâce au lien reçu par e-mail, puis connecte-toi.';
  return null;
}

export async function resetPassword(email: string): Promise<string> {
  const sb = await getSupabase();
  if (!sb) return 'Synchronisation non configurée.';
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  return error ? traduireErreur(error.message) : 'Si ce compte existe, un e-mail de réinitialisation a été envoyé.';
}

export async function signOut(): Promise<void> {
  await syncNow();
  const sb = await getSupabase();
  await sb?.auth.signOut();
  // La progression reste sur l'appareil : on ne supprime rien localement.
  await remove(KEYS.syncCursor);
  setState({ user: null, isAdmin: false });
}

/** RGPD : supprime le compte et les données en ligne (la progression reste sur l'appareil). */
export async function deleteAccount(): Promise<string | null> {
  const sb = await getSupabase();
  if (!sb || !state.user) return 'Non connecté.';
  const { error } = await sb.rpc('delete_my_account');
  if (error) return error.message;
  await sb.auth.signOut();
  await remove(KEYS.syncCursor);
  const events = state.events.map((e) => ({ ...e, synced: false }));
  setState({ user: null, isAdmin: false, events });
  await save(KEYS.events, events);
  return null;
}

function traduireErreur(msg: string): string {
  if (/invalid login/i.test(msg)) return 'E-mail ou mot de passe incorrect.';
  if (/already registered/i.test(msg)) return 'Un compte existe déjà avec cet e-mail.';
  if (/password/i.test(msg) && /6|short|weak/i.test(msg)) return 'Mot de passe trop faible (8 caractères minimum conseillés).';
  if (/email not confirmed/i.test(msg)) return "Adresse e-mail pas encore confirmée : clique sur le lien reçu par e-mail.";
  if (/rate limit/i.test(msg)) return 'Trop de tentatives, réessaie dans quelques minutes.';
  return msg;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSync() {
  if (!state.user) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncNow(), 2000);
}

let syncing: Promise<void> | null = null;
export function syncNow(): Promise<void> {
  if (syncing) return syncing;
  syncing = doSync().finally(() => (syncing = null));
  return syncing;
}

async function doSync(): Promise<void> {
  const sb = await getSupabase();
  if (!sb || !state.user) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setState({ sync: 'offline' });
    return;
  }
  setState({ sync: 'syncing', syncError: null });
  try {
    // 1. Envoi des réponses non synchronisées (idempotent : même id = ignoré).
    const unsynced = state.events.filter((e) => !e.synced);
    for (let i = 0; i < unsynced.length; i += 500) {
      const chunk = unsynced.slice(i, i + 500);
      const { error } = await sb.from('answer_events').upsert(
        chunk.map((e) => ({
          id: e.id,
          question_id: e.questionId,
          question_version: e.questionVersion,
          correct: e.correct,
          response_ms: e.responseMs,
          mode: e.mode,
          answered_at: new Date(e.at).toISOString(),
        })),
        { onConflict: 'id', ignoreDuplicates: true },
      );
      if (error) throw error;
    }
    // 2. Récupération des réponses faites sur d'autres appareils.
    const cursor = await load<string>(KEYS.syncCursor, '1970-01-01T00:00:00Z');
    const remote: AnswerEvent[] = [];
    // Recouvrement de 5 minutes : une écriture concurrente d'un autre appareil n'est jamais manquée
    // (les doublons sont éliminés par identifiant lors de la fusion).
    let newCursor = new Date(Math.max(0, Date.parse(cursor) - 5 * 60 * 1000)).toISOString();
    for (;;) {
      const { data, error } = await sb
        .from('answer_events')
        .select('id,question_id,question_version,correct,response_ms,mode,answered_at,created_at')
        .gt('created_at', newCursor)
        .order('created_at')
        .limit(1000);
      if (error) throw error;
      for (const r of data ?? []) {
        remote.push({
          id: r.id,
          questionId: r.question_id,
          questionVersion: r.question_version,
          correct: r.correct,
          responseMs: r.response_ms,
          mode: r.mode,
          at: Date.parse(r.answered_at),
          synced: true,
        });
        newCursor = r.created_at;
      }
      if (!data || data.length < 1000) break;
    }
    const sentIds = new Set(unsynced.map((e) => e.id));
    const local = state.events.map((e) => (sentIds.has(e.id) ? { ...e, synced: true } : e));
    const events = mergeEvents(local, remote);
    setState({ events, cards: buildAllCards(events) });
    await save(KEYS.events, events);
    await save(KEYS.syncCursor, newCursor);

    // 3. Réglages : le plus récent gagne.
    const { data: srow } = await sb.from('user_settings').select('settings,updated_at').maybeSingle();
    const remoteAt = srow ? Date.parse(srow.updated_at) : 0;
    if (srow && remoteAt > state.settings.updatedAt) {
      const settings = { ...DEFAULT_SETTINGS, ...(srow.settings as Settings), updatedAt: remoteAt };
      setState({ settings });
      await save(KEYS.settings, settings);
    } else if (state.settings.updatedAt > remoteAt) {
      await sb.from('user_settings').upsert({
        user_id: state.user.id,
        settings: state.settings,
        updated_at: new Date(state.settings.updatedAt).toISOString(),
      });
    }

    // 4. Signalements.
    await sendPendingReports();
    await pullReportStatuses();
    setState({ sync: 'idle', lastSync: Date.now() });
  } catch (e) {
    setState({ sync: 'error', syncError: (e as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Export / import (sauvegarde personnelle)
// ---------------------------------------------------------------------------

export function exportData(): string {
  return JSON.stringify(
    {
      app: 'grand-savoir',
      format: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      events: state.events.map(({ synced: _s, ...e }) => e),
      reports: state.reports,
    },
    null,
    1,
  );
}

export async function importData(json: string): Promise<string> {
  const data = JSON.parse(json);
  if (data?.app !== 'grand-savoir' || !Array.isArray(data.events)) {
    throw new Error("Ce fichier n'est pas une sauvegarde du Grand Savoir.");
  }
  const incoming = (data.events as AnswerEvent[]).filter(
    (e) => typeof e.id === 'string' && typeof e.questionId === 'string' && typeof e.at === 'number',
  );
  const known = new Set(state.events.map((e) => e.id));
  const added = incoming.filter((e) => !known.has(e.id)).map((e) => ({ ...e, synced: false }));
  // Fusion : l'import n'efface jamais la progression existante.
  const events = mergeEvents(state.events, added);
  const reportIds = new Set(state.reports.map((r) => r.id));
  const reports = [...state.reports, ...((data.reports ?? []) as Report[]).filter((r) => !reportIds.has(r.id))];
  setState({ events, cards: buildAllCards(events), reports });
  await save(KEYS.events, events);
  await save(KEYS.reports, reports);
  if (data.settings && (data.settings as Settings).updatedAt > state.settings.updatedAt) {
    await updateSettings(data.settings);
  }
  scheduleSync();
  return `${added.length} réponse(s) importée(s) ; la progression existante est conservée.`;
}

/** Pour les tests uniquement. */
export function __resetForTests(patch: Partial<AppState> = {}) {
  state = { ...state, ...patch };
}
