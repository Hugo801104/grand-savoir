// Stockage local persistant (IndexedDB). Toutes les données de l'utilisateur vivent ici d'abord ;
// le serveur n'est qu'une copie de sauvegarde / synchronisation.
import { createStore, get, set, del } from 'idb-keyval';

const store = typeof indexedDB !== 'undefined' ? createStore('grand-savoir', 'kv') : undefined;
const memory = new Map<string, unknown>();

export async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    if (!store) return (memory.get(key) as T) ?? fallback;
    const v = await get<T>(key, store);
    return v === undefined ? fallback : v;
  } catch {
    return (memory.get(key) as T) ?? fallback;
  }
}

export async function save<T>(key: string, value: T): Promise<void> {
  memory.set(key, value);
  try {
    if (store) await set(key, value, store);
  } catch (e) {
    console.warn('Enregistrement local impossible', e);
  }
}

export async function remove(key: string): Promise<void> {
  memory.delete(key);
  try {
    if (store) await del(key, store);
  } catch {
    /* rien */
  }
}

/** Demande au navigateur de ne pas effacer nos données en cas de manque d'espace. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export const KEYS = {
  events: 'events',
  settings: 'settings',
  content: 'content',
  reports: 'reports',
  lastBackup: 'last-backup',
  lastGame: 'last-game',
} as const;
