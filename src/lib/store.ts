// État global de l'appli : contenu, journal de réponses, réglages, signalements.
// Aucune base de données externe : la progression vit dans le navigateur (IndexedDB), le contenu est
// un fichier de données publié avec l'appli, les signalements deviennent des tickets GitHub.

import { useSyncExternalStore } from 'react';
import { APP_VERSION } from './config';
import { listReportIssues, matchIssues, statusFromIssue } from './github';
import { KEYS, load, requestPersistence, save } from './storage';
import { buildAllCards, type CardState, mergeEvents } from './srs';
import {
  type AnswerEvent,
  type ContentBundle,
  DEFAULT_SETTINGS,
  type Report,
  type ReportType,
  type Settings,
} from './types';

export interface AppState {
  ready: boolean;
  content: ContentBundle | null;
  contentError: string | null;
  events: AnswerEvent[];
  cards: Map<string, CardState>;
  settings: Settings;
  reports: Report[];
  /** date du dernier export de sauvegarde (ms) */
  lastBackup: number | null;
  persistent: boolean;
}

let state: AppState = {
  ready: false,
  content: null,
  contentError: null,
  events: [],
  cards: new Map(),
  settings: DEFAULT_SETTINGS,
  reports: [],
  lastBackup: null,
  persistent: false,
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
  const [content, events, settings, reports, lastBackup] = await Promise.all([
    load<ContentBundle | null>(KEYS.content, null),
    load<AnswerEvent[]>(KEYS.events, []),
    load<Settings>(KEYS.settings, DEFAULT_SETTINGS),
    load<Report[]>(KEYS.reports, []),
    load<number | null>(KEYS.lastBackup, null),
  ]);
  setState({
    ready: !!content,
    content,
    events,
    cards: buildAllCards(events),
    settings: { ...DEFAULT_SETTINGS, ...settings },
    reports,
    lastBackup,
  });
  // Demande au navigateur de ne jamais effacer ces données pour manque de place.
  void requestPersistence().then((persistent) => setState({ persistent }));
  await refreshContent();
  setState({ ready: true });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refreshContent();
    });
  }
}

// ---------------------------------------------------------------------------
// Contenu : fichier de données publié (indépendant du code), conservé hors-ligne.
// ---------------------------------------------------------------------------

export async function refreshContent(force = false): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}content/bundle.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`contenu introuvable (${res.status})`);
    const bundle = (await res.json()) as ContentBundle;
    if (!force && state.content?.version === bundle.version) return;
    if (bundle.questions.length > 0) {
      await save(KEYS.content, bundle);
      setState({ content: bundle, contentError: null });
    }
  } catch (e) {
    // Hors-ligne : on garde le contenu déjà téléchargé.
    setState({ contentError: state.content ? null : (e as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Réponses et réglages
// ---------------------------------------------------------------------------

export async function recordAnswer(e: Omit<AnswerEvent, 'id' | 'at' | 'synced'>): Promise<void> {
  const ev: AnswerEvent = { ...e, id: uuid(), at: Date.now() };
  const events = [...state.events, ev];
  setState({ events, cards: buildAllCards(events) });
  await save(KEYS.events, events);
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const settings = { ...state.settings, ...patch, updatedAt: Date.now() };
  setState({ settings });
  await save(KEYS.settings, settings);
}

// ---------------------------------------------------------------------------
// Signalements
// ---------------------------------------------------------------------------

const REPORT_LIMIT_PER_HOUR = 15;

export function clientInfo(): Record<string, string> {
  // Uniquement des informations techniques non sensibles.
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    plateforme: nav?.userAgent.match(/\(([^)]+)\)/)?.[1]?.slice(0, 60) ?? 'inconnue',
    ecran: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    installee: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches ? 'oui' : 'non',
    contenu: state.content?.version ?? '',
  };
}

/** Enregistre le signalement sur l'appareil ; l'envoi se fait en validant le ticket GitHub pré-rempli. */
export async function createReport(input: {
  type: ReportType;
  comment: string;
  questionId?: string | null;
  snapshot?: Record<string, unknown> | null;
  questionVersion?: number | null;
}): Promise<{ ok: true; report: Report } | { ok: false; message: string }> {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  if (state.reports.filter((r) => Date.parse(r.createdAt) > hourAgo).length >= REPORT_LIMIT_PER_HOUR) {
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
  return { ok: true, report };
}

export async function markReportOpened(id: string): Promise<void> {
  const reports = state.reports.map((r) => (r.id === id ? { ...r, sent: true } : r));
  setState({ reports });
  await save(KEYS.reports, reports);
}

export async function deleteReport(id: string): Promise<void> {
  const reports = state.reports.filter((r) => r.id !== id);
  setState({ reports });
  await save(KEYS.reports, reports);
}

/** Met à jour le statut des signalements à partir des tickets GitHub publics. */
export async function refreshReportStatuses(): Promise<string | null> {
  try {
    const issues = await listReportIssues();
    const matched = matchIssues(state.reports, issues);
    const reports = state.reports.map((r) => {
      const i = matched.get(r.id);
      return i ? { ...r, sent: true, status: statusFromIssue(i), issueUrl: i.html_url } : r;
    });
    setState({ reports });
    await save(KEYS.reports, reports);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ---------------------------------------------------------------------------
// Sauvegarde personnelle : export / import (fusion, jamais d'écrasement)
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

export async function markBackupDone(): Promise<void> {
  const now = Date.now();
  setState({ lastBackup: now });
  await save(KEYS.lastBackup, now);
}

export async function importData(json: string): Promise<string> {
  const data = JSON.parse(json);
  if (data?.app !== 'grand-savoir' || !Array.isArray(data.events)) {
    throw new Error("Ce fichier n'est pas une sauvegarde du Grand Savoir.");
  }
  const incoming = (data.events as AnswerEvent[]).filter(
    (e) => typeof e.id === 'string' && typeof e.questionId === 'string' && typeof e.at === 'number' && typeof e.correct === 'boolean',
  );
  const known = new Set(state.events.map((e) => e.id));
  const added = incoming.filter((e) => !known.has(e.id));
  // Fusion : l'import n'efface jamais la progression existante (il permet aussi de réunir deux appareils).
  const events = mergeEvents(state.events, added);
  const reportIds = new Set(state.reports.map((r) => r.id));
  const reports = [...state.reports, ...((data.reports ?? []) as Report[]).filter((r) => r?.id && !reportIds.has(r.id))];
  setState({ events, cards: buildAllCards(events), reports });
  await save(KEYS.events, events);
  await save(KEYS.reports, reports);
  if (data.settings && (data.settings as Settings).updatedAt > state.settings.updatedAt) {
    await updateSettings(data.settings);
  }
  return `${added.length} réponse(s) importée(s) ; la progression existante est conservée.`;
}
