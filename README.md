# Matalon POS

Caisse tactile iPad du groupe Matalon, conforme à l'article 286 I 3° bis du CGI (conditions ISCA : inaltérabilité, sécurisation, conservation, archivage). Premier établissement : le Moka, ouverture le 15 octobre 2026.

Éditeur : proIA Conseil.

## Structure

| Dossier | Contenu | Périmètre fiscal |
| --- | --- | --- |
| `packages/noyau-fiscal` | Tickets chaînés et signés, journal des événements, clôtures Z / mois / exercice, vérification, archives, export CSV | **Oui**, couvert par l'attestation |
| `packages/catalogue` | Cartes des établissements, prix, TVA, variantes, formules | Non |
| `apps/caisse` | PWA iPad (à venir) | Non, consomme le noyau |
| `apps/backoffice` | Back-office web et API Vercel (à venir) | Non |

## Règles du noyau fiscal

- Montants en centimes entiers, TVA en points de base (1000 = 10 %).
- Une chaîne par caisse et par type (tickets, événements, clôtures) : numéro séquentiel sans trou, empreinte SHA-256 du contenu canonique, signature ECDSA P-256 par une clé propre à l'appareil.
- Aucune modification ni suppression : une erreur se corrige par un ticket d'annulation négatif lié à l'original.
- Chaque opération est écrite en un seul lot atomique (`StockageFiscal.ajouterLot`).
- Journée comptable basculant à 5 h, heure de Paris ; dates comptables monotones même si l'horloge recule.
- Toute modification de `packages/noyau-fiscal` impose d'incrémenter `VERSION_NOYAU_FISCAL`, de tagger `noyau-fiscal@<version>` et de mettre l'attestation à jour.

## Garde-fous à la charge de l'application caisse

- **Horloge** : une horloge qui avance (ex. iPad réglé en 2027) fige la date comptable dans le futur, puisque les dates ne reculent jamais. La PWA compare l'heure de l'iPad à celle du serveur au démarrage et avant chaque encaissement en ligne, et bloque l'encaissement au-delà de 5 minutes d'écart.
- **Persistance** : `navigator.storage.persist()`, écritures sérialisées entre onglets (Web Locks), synchronisation de chaque lot vers le serveur, qui refuse toute divergence de numéro ou d'empreinte ; au démarrage, comparaison du dernier numéro/empreinte local et serveur, caisse bloquée en cas d'écart.
- **Traçabilité** : journaliser connexions, suppressions de lignes sur une commande ouverte, impressions d'addition, ouvertures de tiroir, réimpressions, archivages et exports.

## Commandes

```sh
pnpm install
pnpm test        # tous les tests
pnpm typecheck   # TypeScript strict
```
