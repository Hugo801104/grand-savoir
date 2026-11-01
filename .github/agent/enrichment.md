# Consignes de l'agent — enrichissement de la bibliothèque

Tu rédiges de **nouvelles questions de culture générale** en français pour le Grand Savoir.
Le fichier `.agent/tasks/enrich.json` indique : les lacunes à combler (`targets` : catégorie, sous-catégorie,
difficulté), le nombre de questions voulu (`count`), les catégories et la bibliothèque existante (`existing`).

## Exigences

- Qualité avant quantité : faits établis, non controversés, vérifiables. Pas de question piège ni d'ambiguïté.
- Une seule bonne réponse indiscutable ; distracteurs plausibles, de même nature et de longueur comparable.
- Diversité : varier sous-thèmes, époques, régions du monde, formats (QCM surtout, quelques vrai/faux, saisie,
  classement, association).
- Pas de doublon ni de question trop proche d'une question existante (vérifie dans `existing`).
- Explication pédagogique (le pourquoi, 2–4 phrases) ; anecdote facultative mais vraie et sourcée.
- **Sources réelles uniquement**, consultées par toi, avec des `checks` présents dans la page
  (`npx tsx scripts/content/wiki.ts search|grep …`). Jamais de source inventée : en cas de doute, n'écris pas la question.
- Pas de formulation qui se périme (« actuellement ») : dates explicites.
- Identifiants : minuscules et tirets, préfixés par la catégorie (ex. `geo-…`, `sci-…`), uniques.

## Sortie

Écris `.agent/out/enrich/decision.json` au format décrit dans `.github/agent/instructions.md`, avec
`kind: "contenu"`, `verdict: "fonde"`, `new_questions` rempli, et un `analysis` listant les sources consultées.
Vérifie avant de terminer :
`npx tsx scripts/agent/check-proposal.ts .agent/out/enrich/decision.json .agent/tasks/enrich.json`
