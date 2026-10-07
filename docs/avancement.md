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
| 1. Noyau fiscal et caisse minimale | Code terminé (noyau 0.6.0 : comptes clients, correction du paiement) | Attestation éditeur rédigée (7 octobre), à compléter, valider par Audrex et signer ; noyau à geler en 1.0.0. Ticket envoyé par e-mail (optionnel) : non fait |
| 2. Back-office et synchronisation | Terminé en simulation : la journée hors ligne donne une copie serveur identique à l'iPad | À refaire sur le vrai iPad pendant un service à blanc |
| 3. Connecteur Matalon Vision | Pas commencé | Attend le feu vert de Lionel |
| 4. Stock et fiches techniques | Pas commencé | Attend les fiches techniques et le feu vert |
| 5. Mise en service | Pas commencé | Services à blanc avec l'équipe |

## Livré

| Commit | Contenu |
| --- | --- |
| a3f648c | Tickets et clôtures partagés entre appareils (copie du serveur, lecture seule hors de l'appareil d'origine) ; duplicatas et Z imprimés avec l'appareil et la version de l'enregistrement d'origine |
| 4118ce8 | « Envoyer » valide toute commande (même sans imprimante de production) : avant envoi, brouillon (retrait sans trace) ; après envoi, retrait barré et tracé. Plan de salle ajusté à la hauteur d'écran restante. Nouvelle icône (M manuscrit Matalon) |
| 6eaabbb | Correction du paiement (noyau 0.6.0, ticket CORRECTION avant la Z, accord responsable) et moyens de paiement dans le détail des tickets ; e-mail des clients en compte ; note d'un compte rouverte depuis la fiche (copie serveur pour un autre appareil) |
| c2985fa | Plan de salle : éditeur (administration et iPad responsable) avec tables carrées, rectangulaires et rondes, chaises, rotation, décor bar/porte/mur, zones dimensionnées, tables masquées ; contrôle de version du plan ; salle en plan (états, couverts sur chaises, zoom, liste) ; tables assemblées pour un groupe |
| 3857124 | Imprimantes de production : poste par catégorie dans l'éditeur de carte, imprimante par poste (Réglages de la caisse et administration, bon d'essai), bouton « Envoyer (n) », envoi d'office à l'encaissement, bon d'annulation au retrait d'un article envoyé, formules réparties entre postes |
| d4f1939 | Cartes : fusion de deux catégories au même taux de TVA |
| e81d18c | Comptes clients (noyau 0.5.0) : vente en compte (mode EN_COMPTE, client scellé, accord responsable), règlement sur n'importe quel appareil (ticket REGLEMENT, TVA exigible au règlement par tranches exactes), annulation d'un règlement, soldes recalculés par le serveur, page Comptes, section admin, Z avec ventes en compte, règlements et TVA exigible, mentions de facture « reste dû » |
| 6db3a32 | Couverts saisissables avant tout article (table installée gardée, « Libérer la table »), écran des couverts en un toucher, lignes retirées gardées barrées à l'écran, aucun paiement une fois le total réglé, confirmation au-delà de 20 € de rendu |
| b6912c9 | Icônes dans les menus et les actions (caisse et administration), rattachement d'un iPad ou d'un iPhone (type d'appareil reconnu et affiché), administration défilante au doigt |
| 172907c | Lot 2 : éditeur de cartes dans l'administration, cartes envoyées aux iPad (versionnées, gardées hors ligne), archives par Z côté serveur vérifiables seules, journal d'administration en ajout seul |
| 0396872 | Lot 1 : fond de caisse et comptage au Z, facture sur demande et avoir, notes et transfert de table, CI GitHub |
| 867b516 et avant | Noyau fiscal, caisse PWA, serveur (rattachement, réplication vérifiée), administration 2FA, note en QR code, version iPhone, guide de test |

## Décisions techniques à ne pas défaire

- Montants en centimes entiers ; TVA en points de base.
- Le noyau fiscal tient une chaîne par caisse, signée par une clé ECDSA propre à l'iPad. Le serveur vérifie et réplique, mais ne signe jamais.
- Interface : une icône seule quand le sens est évident (fermer, retour, imprimer, se déconnecter), toujours avec son libellé pour l'accessibilité ; icône et mot court quand l'action engage. Icônes Lucide intégrées au code (hors ligne).
- Comptes clients : la vente compte dans le CA du jour ; la TVA n'est exigible qu'à l'encaissement (ventes à consommer sur place = prestations de services, BOI-TVA-BASE-20-20 § 130). Le règlement est un ticket `REGLEMENT` sans ligne ni total ; sa TVA est la tranche exacte de la vente (`ventilerTranche`, méthode Sainte-Laguë cumulative : la somme des tranches redonne la ventilation de la vente). Les soldes se calculent sur le serveur (toutes caisses) ; les incohérences entre caisses sont signalées, jamais bloquantes. Format d'archive inchangé (`matalon-archive-fiscale/1`) : il peut désormais contenir des tickets REGLEMENT et des clôtures avec `comptesClients`.
- La carte vient du serveur (`/api/caisse/carte`) ; `carteDe(config)` tombe sur la carte livrée avec le code seulement avant la première réception.
- Une divergence de synchronisation est signalée mais ne bloque pas l'encaissement. L'encaissement est bloqué si l'iPad est révoqué ou si son horloge s'écarte de plus de 5 min.
- Bons de production : hors périmètre fiscal (rien au registre, sauf `apresEnvoi` sur `SUPPRESSION_LIGNE`). Sans aucune imprimante de production réglée, la fonction est invisible. Une ligne envoyée ne se regroupe plus avec un nouvel article identique ; augmenter sa quantité crée une ligne à envoyer. Un bon en échec laisse toute la ligne à envoyer (un doublon en cuisine plutôt qu'un oubli).
- Plan de salle : les tables ne changent plus que par la route du plan (`PUT …/plan`, avec `version` : 409 si le plan a bougé ailleurs) ; la mise à jour de l'établissement les ignore. Une table n'est jamais supprimée (`masquee`). Positions en cases de 25 cm (`CASE_CM`) ; une table sans position est placée d'office, et l'enregistrement fige toutes les positions. Tables assemblées : `Commande.jointes` (hors fiscal) ; le ticket ne porte que la table principale.
- Correction du paiement (0.6.0) : ticket `CORRECTION` sans ligne ni total, `ticketOrigine` = la vente, `paiements` = écart de somme nulle (mode erroné en négatif). Seulement avant la Z qui couvrirait la vente (correction et vente sont donc dans la même archive), jamais pour une vente en compte, jamais annulable (on corrige à nouveau). `paiementsEffectifs` sert à l'annulation, au détail et aux factures ; `verifierCorrections` contrôle la cohérence avec la vente.
- Commande : brouillon jusqu'à « Envoyer » (ou l'encaissement). Avant envoi, un retrait efface sans trace ; après envoi, il est barré, journalisé (`SUPPRESSION_LIGNE`, `apresEnvoi`) et donne un bon d'annulation s'il y a des imprimantes de production. Le CA reste enregistré à l'encaissement uniquement (ticket scellé).
- Tickets et clôtures des autres appareils : lus sur le serveur (`GET /api/caisse/tickets`, `/api/caisse/clotures`), en lecture seule. Une annulation, une correction ou une facture ne se fait que sur l'appareil qui a encaissé : chaque chaîne fiscale reste propre à son appareil (numérotation, signature). Les commandes ouvertes, elles, restent propres à chaque appareil.
- Vercel : Build Output API (`apps/caisse/scripts/vercel-build.mjs`), fonction Edge en `cdg1`, Postgres Neon.

## Actions en attente côté Lionel

- [x] Créer le compte administrateur sur `/admin` (fait le 6 octobre 2026).
- [ ] Remplir les mentions légales des factures dans l'administration.
- [x] Tag `noyau-fiscal-v0.5.0` sur e81d18c (release GitHub, 6 octobre 2026).
- [x] Tag `noyau-fiscal-v0.4.0` sur 0396872 (6 octobre 2026).
- [x] Tag `noyau-fiscal-v0.6.0` sur 6eaabbb (7 octobre 2026).
- [ ] Attestation éditeur rédigée le 7 octobre 2026 (Claude Docs : https://claude.ai/code/artifact/23f6ff65-9189-4b16-af34-d5554336d55d) : sociétés identifiées (PROIA CONSEIL, SIREN 101 164 614, éditeur ; JLE, SIREN 982 885 279, exploitant) ; reste les dates, puis validation par Audrex (même signataire pour les deux volets, APE de PROIA CONSEIL en 70.22Z et non en édition de logiciels, § 375 ; régime rétabli par la LF 2026), puis signature.
- [ ] Geler le noyau en 1.0.0 (au plus tard au go/no-go du 13 octobre) et poser le tag `noyau-fiscal-v1.0.0` : c'est la version citée par l'attestation.
- [ ] Audrex : confirmer l'absence d'option pour les débits (sinon la TVA d'une vente en compte serait due à la vente) et le traitement comptable des créances clients ; l'export CSV des Z a deux colonnes de plus (règlements, TVA exigible).
- [ ] Information RGPD : le nom des clients en compte est conservé 6 ans dans les enregistrements fiscaux (obligation légale, non effaçable).
- [ ] Protéger la branche principale, avec le contrôle « Contrôles » obligatoire.
- [ ] Console Neon : fenêtre de restauration à 7 jours et sauvegarde quotidienne.
- [ ] Faire un service hors ligne réel sur l'iPad.
- [ ] Vérifier avec Audrex les mentions de facturation électronique.

## Tests

`pnpm typecheck && pnpm test`, puis les 7 parcours de bout en bout du README (serveur local relancé à vide entre chaque).
