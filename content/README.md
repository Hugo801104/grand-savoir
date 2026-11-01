# Bibliothèque de questions

Ces fichiers **sont** la bibliothèque. À chaque déploiement, les questions publiées sont rassemblées dans
`content/bundle.json`, que l'appli télécharge et garde hors-ligne. Toute modification passe par un commit
(directement ou via une Pull Request de l'agent) : l'historique Git conserve chaque version et permet le retour
arrière. Le champ `version` d'une question est incrémenté à chaque correction.

## Format compact d'une question (`questions/<catégorie>.json`)

| Champ | Rôle |
|---|---|
| `id` | identifiant stable (minuscules, chiffres, tirets), préfixé par la catégorie |
| `fmt` | `qcm` (défaut), `vrai_faux`, `saisie`, `classement`, `association` |
| `sub`, `themes`, `diff` | sous-catégorie, thèmes, difficulté 1–5 |
| `q` | énoncé |
| `choices` + `correct` | QCM : réponses, index de la bonne (0 par défaut : écrire la bonne en premier, l'appli mélange) |
| `answer` | vrai/faux : `true` ou `false` |
| `accepted` | saisie : réponses acceptées |
| `items` + `orderLabel` | classement : éléments dans le bon ordre + sens du classement |
| `pairs` | association : paires `[gauche, droite]` |
| `exp`, `anec` | explication (le pourquoi), anecdote facultative |
| `see` | identifiants de questions liées (« à relier avec ») |
| `wiki` | sources Wikipédia FR : `[["Titre exact", "terme de contrôle", …]]` |
| `sources` | autres sources : `[{ "title", "url", "checks": [] }]` |

Avant tout ajout : `npm run content:validate` puis `npm run content:verify-sources`.
`verification.json` garde la trace de la dernière vérification complète des sources.
