# Avancement — Matalon POS

À relire en début de session avec `docs/cahier-des-charges.md`, et à mettre à jour à chaque commit qui fait avancer un lot.
Dernière mise à jour : 6 octobre 2026.

## Règle de conduite

- On ne commence pas un lot tant que le précédent n'est pas terminé. On ne propose pas non plus de passer au lot suivant (consigne de Lionel).
- À chaque étape, on relit le cahier des charges en entier pour ne rien oublier.
- Ouverture du Moka : jeudi 15 octobre 2026. Décision go / no-go : 13 octobre 2026, après les services à blanc.

## État des lots

| Lot | État | Ce qui reste |
| --- | --- | --- |
| 0. Cadrage | En cours, côté Lionel | Fiches techniques du Moka, caisse de transition conforme (plan B), outil comptable destinataire des Z, calendrier de facturation électronique B2B (Audrex) |
| 1. Noyau fiscal et caisse minimale | Code terminé (noyau 0.4.0) | **L'attestation éditeur n'est pas rédigée**, alors que le cahier en fait un critère de sortie. Ticket envoyé par e-mail (optionnel) : non fait |
| 2. Back-office et synchronisation | Terminé en simulation : la journée hors ligne donne une copie serveur identique à l'iPad | À refaire sur le vrai iPad pendant un service à blanc |
| 3. Connecteur Matalon Vision | Pas commencé | Attend le feu vert de Lionel |
| 4. Stock et fiches techniques | Pas commencé | Attend les fiches techniques et le feu vert |
| 5. Mise en service | Pas commencé | Services à blanc avec l'équipe |

## Livré

| Commit | Contenu |
| --- | --- |
| 6db3a32 | Couverts saisissables avant tout article (table installée gardée, « Libérer la table »), écran des couverts en un toucher, lignes retirées gardées barrées à l'écran, aucun paiement une fois le total réglé, confirmation au-delà de 20 € de rendu |
| b6912c9 | Icônes dans les menus et les actions (caisse et administration), rattachement d'un iPad ou d'un iPhone (type d'appareil reconnu et affiché), administration défilante au doigt |
| 172907c | Lot 2 : éditeur de cartes dans l'administration, cartes envoyées aux iPad (versionnées, gardées hors ligne), archives par Z côté serveur vérifiables seules, journal d'administration en ajout seul |
| 0396872 | Lot 1 : fond de caisse et comptage au Z, facture sur demande et avoir, notes et transfert de table, CI GitHub |
| 867b516 et avant | Noyau fiscal, caisse PWA, serveur (rattachement, réplication vérifiée), administration 2FA, note en QR code, version iPhone, guide de test |

## Décisions techniques à ne pas défaire

- Montants en centimes entiers ; TVA en points de base.
- Le noyau fiscal tient une chaîne par caisse, signée par une clé ECDSA propre à l'iPad. Le serveur vérifie et réplique, mais ne signe jamais.
- Interface : une icône seule quand le sens est évident (fermer, retour, imprimer, se déconnecter), toujours avec son libellé pour l'accessibilité ; icône et mot court quand l'action engage. Icônes Lucide intégrées au code (hors ligne).
- La carte vient du serveur (`/api/caisse/carte`) ; `carteDe(config)` tombe sur la carte livrée avec le code seulement avant la première réception.
- Une divergence de synchronisation est signalée mais ne bloque pas l'encaissement. L'encaissement est bloqué si l'iPad est révoqué ou si son horloge s'écarte de plus de 5 min.
- Vercel : Build Output API (`apps/caisse/scripts/vercel-build.mjs`), fonction Edge en `cdg1`, Postgres Neon.

## Actions en attente côté Lionel

- [x] Créer le compte administrateur sur `/admin` (fait le 6 octobre 2026).
- [ ] Remplir les mentions légales des factures dans l'administration.
- [ ] Pousser le tag `noyau-fiscal@0.4.0` (le proxy refuse le push de tags depuis la session).
- [ ] Protéger la branche principale, avec le contrôle « Contrôles » obligatoire.
- [ ] Console Neon : fenêtre de restauration à 7 jours et sauvegarde quotidienne.
- [ ] Faire un service hors ligne réel sur l'iPad.
- [ ] Vérifier avec Audrex les mentions de facturation électronique.

## Tests

`pnpm typecheck && pnpm test`, puis les 4 parcours de bout en bout du README (serveur local relancé à vide entre chaque).
