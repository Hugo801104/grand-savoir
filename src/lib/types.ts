// Types partagés par l'appli, les scripts de contenu et les agents.

export type QuestionFormat = 'qcm' | 'vrai_faux' | 'saisie' | 'classement' | 'association';

export type EditorialStatus =
  | 'brouillon'
  | 'a_verifier'
  | 'valide'
  | 'publie'
  | 'suspendu'
  | 'archive';

export const EDITORIAL_STATUSES: EditorialStatus[] = [
  'brouillon', 'a_verifier', 'valide', 'publie', 'suspendu', 'archive',
];

export interface Source {
  title: string;
  url: string;
  /** Termes qui doivent figurer dans la page source (vérification automatique). */
  checks?: string[];
}

export interface Question {
  /** Identifiant stable et unique, ex. « hist-fr-marignan ». Ne change jamais. */
  id: string;
  version: number;
  status: EditorialStatus;
  format: QuestionFormat;
  category: string;
  subcategory: string;
  themes: string[];
  /** 1 = très facile … 5 = expert */
  difficulty: 1 | 2 | 3 | 4 | 5;
  prompt: string;
  /** qcm / vrai_faux : réponses proposées */
  choices?: string[];
  /** qcm / vrai_faux : index de la bonne réponse dans choices */
  correct?: number;
  /** saisie : réponses acceptées (comparaison tolérante) */
  accepted?: string[];
  /** classement : éléments dans le BON ordre (mélangés à l'affichage) */
  items?: string[];
  /** classement : consigne d'ordre, ex. « du plus ancien au plus récent » */
  orderLabel?: string;
  /** association : paires [gauche, droite] correctes */
  pairs?: [string, string][];
  explanation: string;
  anecdote?: string;
  /** Identifiants de questions liées (« voir aussi ») */
  seeAlso?: string[];
  sources: Source[];
  origin?: 'seed' | 'ia' | 'utilisateur' | 'admin';
  createdAt: string;
  verifiedAt?: string;
  updatedAt?: string;
}

export interface Subcategory {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  position: number;
  subcategories: Subcategory[];
}

/** Parcours thématique (mode découverte) : une suite d'étapes progressives. */
export interface LearningPath {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  steps: { title: string; intro: string; questionIds: string[] }[];
}

export interface ContentBundle {
  version: string;
  generatedAt: string;
  categories: Category[];
  paths: LearningPath[];
  questions: Question[];
}

/** Un événement de réponse : journal append-only, base de toute la progression. */
export interface AnswerEvent {
  id: string;
  questionId: string;
  questionVersion: number;
  correct: boolean;
  /** Temps de réponse en ms (null si inconnu) */
  responseMs: number | null;
  mode: GameMode;
  at: number;
  /** true si déjà envoyé au serveur */
  synced?: boolean;
}

export type GameMode = 'aleatoire' | 'thematique' | 'personnalisee' | 'decouverte' | 'defi' | 'revision';

export const REPORT_TYPES = [
  { id: 'erreur_factuelle', label: 'Erreur factuelle' },
  { id: 'mauvaise_reponse', label: 'Mauvaise réponse ou réponses proposées incorrectes' },
  { id: 'ambigue', label: 'Question ambiguë ou mal formulée' },
  { id: 'explication', label: 'Explication insuffisante' },
  { id: 'anecdote', label: 'Anecdote incorrecte' },
  { id: 'source', label: 'Source manquante ou peu fiable' },
  { id: 'amelioration', label: "Suggestion d'amélioration" },
  { id: 'nouvelle_question', label: "Proposition d'une nouvelle question ou d'un nouveau thème" },
  { id: 'bug', label: "Bug technique ou problème d'affichage" },
  { id: 'autre', label: 'Autre' },
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]['id'];

export type ReportStatus =
  | 'nouveau'
  | 'en_analyse'
  | 'correction_proposee'
  | 'en_attente_validation'
  | 'corrige'
  | 'rejete'
  | 'echec_technique';

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  nouveau: 'Nouveau',
  en_analyse: 'En analyse',
  correction_proposee: 'Correction proposée',
  en_attente_validation: 'En attente de validation',
  corrige: 'Publié / corrigé',
  rejete: 'Rejeté',
  echec_technique: 'Échec technique',
};

export interface Report {
  id: string;
  type: ReportType;
  comment: string;
  questionId: string | null;
  questionVersion: number | null;
  /** Ce que l'utilisateur voyait : énoncé, réponses, catégorie, difficulté */
  snapshot: Record<string, unknown> | null;
  appVersion: string;
  clientInfo: Record<string, string>;
  createdAt: string;
  status: ReportStatus;
  /** Réponse / compte rendu visible par l'utilisateur */
  resolution?: string | null;
  issueUrl?: string | null;
  /** false tant qu'il n'est pas parvenu au serveur */
  sent: boolean;
}

export interface Settings {
  timerEnabled: boolean;
  timerSeconds: number;
  questionsPerGame: number;
  sound: boolean;
  vibration: boolean;
  reducedMotion: boolean;
  /** Afficher l'explication même quand la réponse est juste */
  alwaysExplain: boolean;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  timerEnabled: false,
  timerSeconds: 30,
  questionsPerGame: 10,
  sound: true,
  vibration: true,
  reducedMotion: false,
  alwaysExplain: true,
  updatedAt: 0,
};
