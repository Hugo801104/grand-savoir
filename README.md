# Le Grand Savoir

Jeu de culture générale façon plateau télé, pensé pour **apprendre durablement** : répétition espacée, explications
sourcées, révisions au bon moment. Application web installable (PWA) sur Android, utilisable hors connexion, avec une
chaîne d'amélioration continue : un signalement envoyé depuis le téléphone est analysé et traité par un agent IA
contrôlé.

## Ce que fait l'application

- **Jouer en 1 geste** : gros bouton « Jouer » (partie aléatoire équilibrée entre les thèmes).
- **6 modes** : aléatoire, thématique (catégorie / sous-thème), sur mesure (thèmes + difficulté + formats + nombre),
  découverte (parcours guidés pas à pas), défi (questions difficiles), révision (connaissances fragiles et dues),
  plus un mode « express » de 5 questions.
- **5 formats** : QCM, vrai/faux, réponse libre (tolère les fautes de frappe), classement, association.
- **Après chaque réponse** : verdict, bonne réponse, explication, anecdote, liens vers des notions déjà étudiées,
  sources consultables.
- **Bilan de partie** : score, thèmes travaillés, erreurs à retenir, réussites, connaissances à consolider ;
  « Continuer » relance immédiatement.
- **Chronomètre facultatif** (désactivé par défaut), sons et vibrations réglables, animations réductibles.
- **Progression** : statistiques globales et par thème, niveau estimé, activité, révisions à venir, historique
  consultable de toutes les questions rencontrées.
- **Signalement** depuis chaque question (10 types + commentaire) et suivi de son statut dans l'appli.
- **Compte facultatif** : sauvegarde en ligne et synchronisation multi-appareils ; export / import JSON ;
  suppression du compte (RGPD).
- **Administration** (réservée au compte administrateur) : signalements, propositions de l'IA avec comparaison
  avant/après, contenus à vérifier, exécutions des agents et erreurs, historique des publications avec retour arrière,
  coûts mensuels, configuration (budgets, seuils, enrichissement).

## Apprentissage : comment la maîtrise est calculée

Toutes les réponses sont enregistrées dans un **journal** (jamais effacé). L'état de chaque question est recalculé à
partir de ce journal (`src/lib/srs.ts`) :

- une bonne réponse augmente la « stabilité » du souvenir, d'autant plus qu'on a attendu longtemps ;
- plusieurs bonnes réponses **le même jour** ne comptent que pour une ;
- une erreur rend la notion « fragile » et la fait revenir dans la même session, puis le lendemain ;
- **acquise** = bonnes réponses sur au moins 2 jours différents et stabilité ≥ 7 jours ;
  **maîtrisée** = 3 jours différents et stabilité ≥ 30 jours ;
- l'absence ne remet rien à zéro : seule la probabilité estimée de se souvenir diminue.

Le niveau par thème (type Elo) adapte la difficulté proposée ; les questions vues il y a quelques heures sont écartées.

## Architecture

| Élément | Choix | Pourquoi |
|---|---|---|
| Appli | React 19 + TypeScript + Vite, PWA (vite-plugin-pwa) | installable sur Android depuis une URL, hors-ligne, pas de store |
| Données locales | IndexedDB (idb-keyval) | la progression vit d'abord sur l'appareil ; jamais perdue lors d'une mise à jour |
| Serveur | Supabase (Postgres + Auth + RLS), offre gratuite | base de questions modifiable sans republier l'appli, comptes, sécurité par ligne |
| Hébergement | GitHub Pages | gratuit, HTTPS, déploiement automatique depuis `main` |
| Automatisation | GitHub Actions + Claude Code (`anthropics/claude-code-action`) | déclenché par événement ou planifié : pas de serveur allumé en permanence |

```
src/            appli (écrans, moteur de quiz, répétition espacée, synchro, contrôles qualité)
content/        bibliothèque initiale : catégories, parcours, questions (format compact, sourcées)
scripts/content outils de contenu : validation, vérification en ligne des sources, import, recherche Wikipédia
scripts/agent   chaîne des agents : accueil, contrôles, publication, Pull Requests, enrichissement
supabase/       schéma SQL (migrations) et fonction de déclenchement immédiat
.github/        CI, déploiement, agents (consignes + workflows), maintenance et sauvegardes
tests/          tests automatisés (vitest)
```

## Bibliothèque de contenus

- En production, les questions sont **dans la base Supabase**, pas dans le code : l'appli télécharge les questions
  publiées et les garde hors-ligne ; un numéro de version global indique quand se mettre à jour.
- Chaque question : identifiant stable, catégorie, sous-catégorie, thèmes, difficulté 1–5, énoncé, réponses,
  explication, anecdote, liens, **sources avec termes de contrôle**, dates de création et de vérification,
  statut éditorial (brouillon, à vérifier, validé, publié, suspendu, archivé), **historique de toutes les versions**
  avec retour arrière.
- Contrôles automatiques (`src/lib/quality.ts`) : structure, cohérence réponse/explication, réponses en double,
  formulations qui se périment, doublons et quasi-doublons, références cassées, vérifications trop anciennes.
- **Vérification des sources** (`npm run content:verify-sources`) : chaque page citée est téléchargée et doit contenir
  les termes attendus (dates, noms). Une source inventée ou qui ne dit pas ce qu'on affirme est rejetée.
- Contenu initial : 176 questions, 15 catégories, 5 parcours découverte ; 213 sources vérifiées en ligne le 1er novembre 2026.

## Chaîne de traitement des signalements

1. L'appli enregistre le signalement (Supabase, anti-spam : 20/heure, 60/jour par compte).
2. Un déclencheur appelle la fonction `report-dispatch`, qui lance le workflow **Agent — signalements**
   (à défaut, il tourne toutes les 6 heures).
3. **Accueil** (sans IA) : budget vérifié, ticket GitHub créé, contexte préparé (question, sources, bibliothèque).
4. **Analyse** (IA) : l'agent vérifie le signalement — il peut être faux ou malveillant —, consulte des sources,
   propose une correction et l'auto-contrôle. Il **n'a accès à aucune clé** de la base.
5. **Publication** (sans IA, copie propre du code) :
   - contenu : publication automatique **seulement** si verdict fondé, aucun risque signalé, confiance ≥ seuil (0,9),
     tous les contrôles et sources vérifiés (et, si la bonne réponse change : confiance ≥ 0,95 et 2 sources) ;
     sinon proposition en attente dans l'administration ;
   - code : branche dédiée + Pull Request avec résultats des tests ; **jamais fusionnée ni déployée sans toi** ;
   - compte rendu publié sur le ticket ; statut mis à jour dans l'appli.
6. Garde-fous : une exécution à la fois, 2 tentatives max par signalement, plafond quotidien d'exécutions et budget
   mensuel en dollars (réglables dans l'administration), nombre de tours de l'IA limité, versions conservées.

## Développement

```bash
npm install
npm run dev                     # http://localhost:5173 (mode local, contenu de démonstration)
npm test                        # tests automatisés
npm run content:validate        # contrôle de la bibliothèque
npm run content:verify-sources  # vérification en ligne des sources
npm run build                   # build de production (service worker inclus)
```

Sans variables Supabase, l'appli fonctionne entièrement en local (questions lues dans un paquet de démonstration).

## Sécurité et données personnelles

- Données personnelles stockées : e-mail du compte (Supabase Auth), réponses, réglages, signalements. Pas de
  publicité, pas de traceur, pas de revente.
- Règles de sécurité par ligne (RLS) : chacun ne voit que ses propres données ; l'administration est réservée à la
  table `admins` ; la clé `service_role` n'est utilisée que dans GitHub Actions, jamais dans l'appli.
- Les secrets sont dans les « secrets » GitHub et Supabase, jamais dans le code ni dans les tickets.
- Les signalements transmis aux tickets GitHub sont nettoyés (mentions, balises, caractères de contrôle) ; ils ne
  contiennent ni e-mail ni identifiant utilisateur. **Le dépôt étant public, le texte des commentaires de signalement
  est visible dans les tickets** : n'y écris pas d'information personnelle.
- Sauvegarde hebdomadaire de toute la base, **chiffrée** (AES-256-GCM) puis relue et vérifiée, conservée 90 jours.
- Droit à l'effacement : Réglages → « Supprimer mon compte et mes données en ligne ».

## Coûts

| Service | Coût |
|---|---|
| GitHub (dépôt public, Pages, Actions) | 0 € |
| Supabase (offre gratuite : 500 Mo, 50 000 utilisateurs actifs/mois) | 0 € |
| IA — option abonnement Claude (jeton `claude setup-token`) | inclus dans ton abonnement, dans ses limites d'usage |
| IA — option clé API Anthropic | à l'usage ; ordre de grandeur 0,20 à 1 $ par signalement analysé, plafonné par le budget mensuel |

Note : sur l'offre gratuite, Supabase met en pause un projet inactif pendant 7 jours ; il se relance depuis le
tableau de bord (la tâche hebdomadaire de sauvegarde l'interroge chaque semaine, ce qui limite ce risque).
