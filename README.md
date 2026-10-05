# ARTSCan R&D — Leyton France

Architecture indépendante de Floot : **GitHub + Cloudflare Workers + Static Assets + D1 + Queues**.

## Invariants

- aucune dépendance LLM au runtime ;
- aucune API de moteur de recherche au runtime ;
- crawl HTTP/HTTPS direct ;
- respect `robots.txt` ;
- garde SSRF ;
- une source active doit vérifier **officielle + publique + gratuite** ;
- preuves conservées avec URL exacte ;
- interface prioritaire 13 pouces, 1366×768, sans scroll horizontal.

## Déploiement Cloudflare

1. Créer un dépôt GitHub privé `artscan-rd` et y pousser ce dossier.
2. Dans Cloudflare Workers & Pages, créer un Worker depuis le dépôt GitHub via Workers Builds.
3. Créer D1 `artscan-rd`, puis remplacer `REPLACE_AFTER_D1_CREATE` dans `wrangler.jsonc`.
4. Créer la queue `artscan-rd-crawl`.
5. Exécuter `schema.sql` sur D1.
6. Charger le registre certifié dans `sources` avant ouverture du mode Expert.
7. Lancer `npm test` avant chaque déploiement.

## Registre mondial

`data/trust-roots.json` contient uniquement des racines institutionnelles de départ. `scripts/discover-sources.mjs` découvre des **candidats** via des annuaires officiels mais les laisse inactifs tant que leur statut officiel n'est pas validé. Il n'existe donc pas d'auto-certification aveugle.

Le gate de production doit rester : `official=1 AND public_access=1 AND free_access=1`.


## Référentiel documentaire v4

Le référentiel métier approuvé est conservé dans `docs/master-prompt-bpifrance.txt`.

ARTSCAN distingue désormais strictement :

- `sources` : institutions/racines certifiées **officielles + publiques + gratuites** ;
- `documents` : pages/documents réellement ouverts et vérifiés ;
- `job_documents` : corpus documentaire réellement retenu pour une analyse donnée ;
- Corpus A : sources institutionnelles primaires V2/V3 ;
- Corpus B : littérature scientifique et technique ;
- Corpus C : brevets, consolidés par famille ;
- Corpus D : normalisation et réglementation ;
- Corpus E : sources industrielles ou secondaires, justifiées.

Le Corpus A n'est certifié complet que lorsqu'il contient **au moins 1 000 documents V2/V3 effectivement vérifiés et dédupliqués provenant d'au moins 1 000 sources institutionnelles distinctes**. Un domaine, une URL générée ou une institution simplement enregistrée sans document vérifié ne compte pas.

Une recherche individuelle distingue désormais explicitement :
- **Corpus A global vérifié** : référentiel documentaire disponible, auquel s'applique le seuil de 1 000 ;
- **documents retenus pour la recherche** : sous-ensemble pertinent pour le sujet traité, sans réinterpréter ce sous-ensemble comme la taille du Corpus A.

## Actualisation

Le registre institutionnel et le Corpus A sont réévalués deux fois par mois, les 1er et 15. Les collectes restent HTTP/HTTPS directes, sans LLM ni API de moteur de recherche au runtime.

## Exécution reproductible hors GitHub Actions

GitHub Actions n'est qu'un orchestrateur. La certification métier reste exécutable sur tout environnement disposant de **Node.js 22** et **Python 3.12** :

- `npm test` : garde-fous statiques d'architecture et d'intégrité ;
- `npm run certify:registry` : recertification des sources puis reconstruction/validation du registre ;
- `npm run harvest:corpus-a` : collecte documentaire sur l'intégralité du registre certifié ;
- `npm run validate:corpus-a` : gate strict **>= 1 000 documents V2/V3 et >= 1 000 sources représentées** ;
- `npm run certify:full` : chaîne complète registre -> Corpus A -> validation -> tests.

Les workflows GitHub de déploiement, smoke, rebuild, harvest manuel et qualité restent **manuels uniquement**. Le seul cycle automatique de données est `registry-certification`, les **1er et 15** avec gate à 02:00 Europe/Paris.

## Diagnostic de couverture Corpus A

Chaque harvest produit `data/corpus-a-misses.json` et enrichit `data/corpus-a-stats.json` avec les causes d'absence de document par source : robots, homepage inaccessible, absence de candidat R&D, échec de validation du candidat, redirection hors domaine, canonical externe, contenu insuffisant ou déduplication.

Le workflow conserve ces diagnostics comme artefact **avant le gate bloquant**. Un cycle incomplet reste donc analysable sans être promu en staging ou production.

