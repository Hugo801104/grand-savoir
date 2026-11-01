// Mémorise le bilan de la dernière partie (pour l'écran de résultats, y compris après rechargement).
import type { GameMode } from './types';
import { KEYS, load, save } from './storage';

export interface GameResult {
  mode: GameMode;
  title: string;
  answers: { questionId: string; correct: boolean; timedOut?: boolean }[];
  params: Record<string, string>;
  endedAt: number;
}

let last: GameResult | null = null;

export function setLastGame(r: GameResult) {
  last = r;
  void save(KEYS.lastGame, r);
}

export async function getLastGame(): Promise<GameResult | null> {
  return last ?? (await load<GameResult | null>(KEYS.lastGame, null));
}
