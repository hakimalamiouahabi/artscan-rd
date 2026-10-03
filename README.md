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
