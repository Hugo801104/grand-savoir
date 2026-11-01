# Le Grand Savoir

Jeu de culture générale façon plateau télé, pensé pour **apprendre durablement** : répétition espacée, explications
sourcées, révisions au bon moment. Application web installable (PWA) sur Android, utilisable hors connexion, avec une
chaîne d'amélioration continue : un signalement envoyé depuis le téléphone devient un ticket GitHub, analysé et traité
par un agent IA contrôlé.

**Aucune base de données externe, aucun compte à créer** : GitHub est le seul service utilisé (code, questions,
historique, signalements, automatisation, hébergement).

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
- **Signalement** depuis chaque question (10 types + commentaire) : ticket GitHub pré-rempli, statut suivi dans
  l'appli (« Mes signalements »).
- **Progression sur le téléphone**, protégée contre l'effacement ; sauvegarde en un geste (partage vers Google
  Drive, e-mail…) et restauration par fusion (rien n'est jamais écrasé ; sert aussi à changer d'appareil).
- **Suivi technique** (Réglages → Suivi) : signalements, corrections à valider, historique des publications,
  exécutions des agents, erreurs et coûts mensuels, état de la bibliothèque, réglages de l'agent.

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
| Progression | IndexedDB sur l'appareil (idb-keyval) | pas de serveur ni de compte ; jamais perdue lors d'une mise à jour |
| Questions | fichiers JSON du dépôt → `content/bundle.json` publié | séparées du code ; historique et retour arrière par Git |
| Signalements | tickets GitHub (étiquette `signalement`) | aucun jeton dans l'appli, anti-spam de GitHub, suivi public |
| Hébergement | GitHub Pages | gratuit, HTTPS, déploiement automatique depuis `main` |
| Automatisation | GitHub Actions + Claude Code (`anthropics/claude-code-action`) | déclenché par événement ou planifié : rien ne tourne en permanence |
| Journal des agents | branche `agent-journal` (`runs.jsonl`) | coûts, erreurs et plafonds sans base de données |

```
src/               appli (écrans, moteur de quiz, répétition espacée, contrôles qualité, lien GitHub)
content/           bibliothèque : catégories, parcours, questions (format compact, sourcées)
scripts/content/   validation, vérification en ligne des sources, construction du fichier de données, maintenance
scripts/agent/     chaîne des agents : accueil, contrôles, publication, Pull Requests, enrichissement
agent.config.json  réglages des agents : activation, modèle, plafonds, seuils de publication, enrichissement
.github/           CI, déploiement, agents (consignes + workflows), maintenance mensuelle
tests/             tests automatisés (vitest)
```

## Bibliothèque de contenus

- Les questions sont des **données**, pas du code : fichiers `content/questions/*.json`, publiés sous forme d'un
  fichier `content/bundle.json` que l'appli télécharge, compare à sa version et garde hors-ligne. Corriger ou ajouter
  une question ne modifie pas le code de l'appli.
- Chaque question : identifiant stable, catégorie, sous-catégorie, thèmes, difficulté 1–5, énoncé, réponses,
  explication, anecdote, liens, **sources avec termes de contrôle**, dates de création et de vérification, numéro de
  version, statut éditorial (brouillon, à vérifier, validé, publié, suspendu, archivé — seules les publiées sont
  servies). **Historique complet** : chaque modification est un commit ; retour arrière par « Revert ».
- Contrôles automatiques (`src/lib/quality.ts`) : structure, cohérence réponse/explication, réponses en double,
  formulations qui se périment, doublons et quasi-doublons, références cassées, vérifications trop anciennes.
- **Vérification des sources** (`npm run content:verify-sources`) : chaque page citée est téléchargée et doit contenir
  les termes attendus (dates, noms). Une source inventée ou qui ne dit pas ce qu'on affirme est rejetée. Revérification
  complète chaque mois (workflow « Maintenance du contenu »), avec ticket automatique si quelque chose a changé.
- Contenu initial : 176 questions, 15 catégories, 5 parcours découverte ; 213 sources vérifiées en ligne le
  1er novembre 2026.

## Chaîne de traitement des signalements

1. Dans l'appli, « Signaler » ouvre un **ticket GitHub pré-rempli** (type, commentaire, question, ce qui était affiché,
   version) ; il suffit de valider. Hors connexion, le signalement est gardé et envoyé plus tard.
2. Le ticket déclenche le workflow **Agent — signalements** (sinon, passage automatique toutes les 6 heures).
   Seuls les tickets du propriétaire du dépôt déclenchent l'IA (protection contre le spam et les coûts).
3. **Accueil** (sans IA) : réglages et budget vérifiés, contexte préparé, statut « en analyse ».
4. **Analyse** (IA, sans aucun droit d'écriture) : l'agent vérifie le signalement — il peut être faux ou malveillant —,
   consulte des sources, propose une correction et l'auto-contrôle.
5. **Publication** (sans IA, copie propre du code) :
   - contenu : Pull Request, **fusionnée automatiquement seulement si** verdict fondé, aucun risque signalé,
     confiance ≥ 0,9, tous les contrôles et toutes les sources vérifiés (et, si la bonne réponse change :
     confiance ≥ 0,95 et 2 sources) ; sinon elle attend ta validation. Les nouvelles questions sont toujours
     validées par toi ;
   - code : branche dédiée + Pull Request avec résultats des tests, **jamais fusionnée ni déployée sans toi** ;
   - compte rendu sur le ticket, statut mis à jour (visible dans l'appli), coût inscrit au journal.
6. Fusionner une Pull Request = valider (en ligne en ~2 minutes) ; la fermer = refuser. Le ticket est mis à jour.
7. Garde-fous : une exécution à la fois, 2 tentatives max par signalement, 10 exécutions par jour et 10 $ par mois au
   maximum (réglables dans `agent.config.json`), nombre de tours de l'IA limité.

### Activer l'agent IA (plus tard)

Ajouter **un** de ces secrets dans GitHub → dépôt → Settings → Secrets and variables → Actions :

- `CLAUDE_CODE_OAUTH_TOKEN` : avec un abonnement Claude Pro/Max, générer le jeton avec `claude setup-token` ;
- ou `ANTHROPIC_API_KEY` : clé API (facturation à l'usage, plafonnée par `monthly_budget_usd`).

Tant qu'aucun secret n'est présent, aucune dépense n'est possible : les signalements restent « nouveaux » et
consultables. L'enrichissement hebdomadaire s'active avec `"enrichment_enabled": true` dans `agent.config.json`.

## Développement

```bash
npm install
npm run dev                     # http://localhost:5173
npm test                        # tests automatisés
npm run content:validate        # contrôle de la bibliothèque
npm run content:verify-sources  # vérification en ligne des sources
npm run wiki -- search "Bataille de Marignan"   # trouver un article Wikipédia FR
npm run build                   # build de production (service worker + fichier de données)
```

## Sécurité et données personnelles

- **Aucune donnée personnelle sur un serveur** : progression et réglages restent sur le téléphone ; pas de compte,
  pas de publicité, pas de traceur.
- L'appli ne contient aucun secret ; les signalements sont validés par toi, connecté à GitHub.
- **Le dépôt est public** : le texte des signalements est visible dans les tickets. N'y écris pas d'information
  personnelle.
- Les agents n'utilisent que le jeton temporaire de GitHub Actions (droits minimaux, étape par étape) et la clé IA
  stockée dans les secrets GitHub ; l'étape IA n'a aucun droit d'écriture ; les textes des tickets sont nettoyés et
  traités comme des données, jamais comme des instructions.
- Actions GitHub épinglées par empreinte, mises à jour par Dependabot ; audit des dépendances à chaque déploiement.
- Sauvegardes : le contenu est sauvegardé par Git (chaque version) ; la progression, par l'export depuis l'appli
  (rappel affiché si aucune sauvegarde depuis un mois).

## Coûts

| Service | Coût |
|---|---|
| GitHub (dépôt public, Pages, Actions) | 0 € |
| IA — option abonnement Claude (`claude setup-token`) | inclus dans l'abonnement, dans ses limites d'usage |
| IA — option clé API Anthropic | à l'usage ; ordre de grandeur 0,20 à 1 $ par signalement, plafonné à 10 $/mois |
| Maintenance mensuelle des sources, CI, déploiement | 0 € (sans IA) |
