// Configuration lue au moment du build. Aucun secret : l'appli n'utilise que des données publiques.
export const APP_VERSION: string = __APP_VERSION__;
/** Dépôt GitHub qui héberge le contenu, reçoit les signalements et fait tourner les agents. */
export const GITHUB_REPO: string = import.meta.env.VITE_GITHUB_REPO || 'Hugo801104/grand-savoir';
