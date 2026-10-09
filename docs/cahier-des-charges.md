<!--
Copie du cahier des charges tenu dans Claude Docs :
https://claude.ai/code/artifact/396a6c87-7ab4-4603-8121-565fe62eec12 (révision 43, copiée le 9 octobre 2026).
Le document Claude Docs fait foi. S'il a changé, recopier ici puis ajuster docs/avancement.md.
-->

# Cahier des charges — Caisse iPad Moka

Lionel Hunziker, 5 octobre 2026

## Contexte et objectifs

Le Moka s'équipe d'une caisse tactile iPad développée en interne, conforme à l'article 286 I 3° bis du CGI, qui alimente directement un module stock intégré et Matalon Vision.

- **Encaisser sur iPad**, y compris sans réseau.
- **Être conforme ISCA** (inaltérabilité, sécurisation, conservation, archivage), prouvé par attestation individuelle de l'éditeur, de nouveau admise depuis le 21 février 2026 (loi de finances pour 2026, art. 125).
- **Supprimer la saisie manuelle du CA** dans Matalon Vision.
- **Remplacer Yokitup** par un module stock et fiches techniques intégré, amorcé avec les nouvelles fiches du Moka.
- **Servir de socle groupe** : multi-établissements dès la V1, pour un déploiement ultérieur sur les autres enseignes.

Hors V1, sauf arbitrage contraire : commande à table, écran cuisine, click & collect, borne, programme de fidélité.

## Périmètre fonctionnel de la caisse

La V1 couvre le cycle complet d'une vente, de la prise de commande à la clôture du jour, sans jamais permettre de modifier une vente validée.

| Fonction | Exigences V1 |
| --- | --- |
| Prise de commande | Catalogue par catégories, options et suppléments, note libre, service au comptoir et à table (plan de salle, ouverture, transfert et addition par table), tickets en attente ; pas de vente à emporter. « Envoyer » valide la commande : avant envoi, c'est un brouillon (un retrait efface la ligne sans trace) ; après envoi, un retrait reste barré et est tracé au journal. Le CA s'enregistre à l'encaissement (7 octobre 2026) |
| Encaissement | CB sur TPE autonome (montant ressaisi), espèces avec rendu monnaie, titres-restaurant papier et carte, paiement fractionné sur plusieurs moyens |
| Remises et offerts | Motif obligatoire, autorisés selon le rôle, tracés au journal des événements |
| Annulations et remboursements | Jamais de suppression : ticket d'annulation négatif lié au ticket d'origine, motif obligatoire, tracé |
| Correction du paiement | Le détail d'un ticket montre ses moyens de paiement. Un mode erroné se corrige avant la Z de la journée, par un responsable, avec un motif : le ticket reste intact et un ticket de correction signé, de total nul, porte l'écart entre modes ; la Z et une annulation ultérieure tiennent compte des modes corrigés. Exclu pour les ventes en compte. Ajouté le 6 octobre 2026, noyau fiscal 0.6.0. |
| Recherche des tickets | Écran Tickets : 150 derniers tickets ou une période (aujourd'hui, hier, 7 et 30 jours, dates libres), tous les appareils de l'établissement (hors ligne : ceux de l'appareil). Recherche par n°, montant, table, client, serveur ou motif ; filtres par montant (de… à…), moyen de paiement (après correction), nature (ventes, ventes annulées, annulations, règlements de compte, corrections), comptoir ou table, personne et appareil. Totaux de la sélection : nombre de tickets, ventes et encaissé par moyen de paiement (rapprochement du TPE). Consultation seule. Ajouté le 9 octobre 2026. |
| Ticket et note | Mentions légales (raison sociale, SIRET, adresse, n° TVA, date et heure, numéro séquentiel, lignes, TVA par taux, totaux HT et TTC, version du logiciel), impression à la demande, envoi par e-mail en option |
| Facture | Facture client sur demande, générée depuis le ticket, numérotation propre |
| Clôtures | Lecture X à tout moment, clôture Z journalière, clôtures mensuelle et annuelle, fond de caisse, comptage espèces et écart. Les tickets et les clôtures de tous les appareils de l'établissement se consultent depuis chacun ; annulation, correction et facture restent sur l'appareil qui a encaissé (7 octobre 2026). La lecture X, la Z et les clôtures mensuelle et annuelle portent sur tout l'établissement, quel que soit le nombre de caisses, et se font depuis n'importe quel appareil, en ligne : un seul appareil clôture à la fois ; un ticket pas encore reçu d'un appareil hors ligne entre dans la Z suivante ; le fond de caisse déclaré sur un appareil vaut pour tous ; un appareil seul de son établissement peut encore clôturer hors ligne (7 octobre 2026, noyau fiscal 0.7.0) |
| Utilisateurs | Connexion par code PIN, changement rapide d'utilisateur, rôles vendeur, responsable, administrateur. Cinq codes PIN faux de suite bloquent la personne 5 minutes (connexion et validation responsable), avec une alerte. Modifier l'équipe depuis une caisse demande le code d'un responsable, vérifié par le serveur (8 octobre 2026) |
| Comptes clients | Vente portée au compte d'un client (accord d'un responsable), réglée plus tard sur n'importe quel appareil, annulation d'un règlement. Fiche client : nom, téléphone, e-mail ; chaque note due se rouvre depuis la fiche, même encaissée sur un autre appareil. La vente compte dans le CA du jour ; la TVA est exigible au règlement (restauration sur place = prestation de services). Ajouté le 6 octobre 2026, noyau fiscal 0.5.0. |
| Bons de production | Chaque catégorie de la carte désigne un poste (bar, cuisine) ; l'établissement associe une imprimante à chaque poste. « Envoyer » imprime les nouveaux articles par poste, le reste part à l'encaissement, un retrait après envoi imprime un bon d'annulation. Hors périmètre fiscal. Dans l'éditeur de carte, deux catégories au même taux de TVA peuvent être fusionnées. Ajouté le 6 octobre 2026. |
| Suites (courses) | À table, chaque article part « En direct » ou « À suivre » 1, 2 ou 3, selon un sélecteur en tête de la commande (En direct par défaut) ; la suite d'un article pas encore envoyé se change depuis sa ligne. « Envoyer » fait tout partir : chaque bon range ses articles par suite et les marque. « Réclamer AS n » (une fois par suite) fait d'abord partir ce qui reste à envoyer, puis imprime un bon de réclame à chaque poste qui tient déjà des articles de cette suite ; un article ajouté ensuite à une suite réclamée part marqué « réclamé ». La commande montre chaque suite et l'heure de sa réclame ; le plan et la liste des tables, la prochaine suite à réclamer et le temps écoulé depuis le dernier envoi ou la dernière réclame. Transfert et regroupement gardent les suites. Pas de suites au comptoir. Hors périmètre fiscal. Ajouté le 8 octobre 2026. |
| Plan de salle | Tables carrées, rectangulaires ou rondes avec leur nombre de chaises, placées sur une grille de 25 cm, zone par zone, avec des repères (bar, porte, murs). Dessiné dans l'administration ou sur l'iPad par un responsable ; une modification faite ailleurs entre-temps est refusée plutôt qu'écrasée. Une table n'est jamais supprimée, elle est masquée (les tickets la citent). En caisse : plan avec l'état de chaque table, couverts sur chaises, zoom et bascule en liste (iPhone). Tables assemblées pour un groupe : une commande, libérées ensemble. Ajouté le 6 octobre 2026. |
| Alertes | Dans l'administration, par établissement : vente à un autre prix ou taux de TVA que la carte (version en vigueur au moment de la vente, ou la précédente), article hors carte, code PIN bloqué. Une alerte ne bloque rien ; elle se marque vue. Ajouté le 8 octobre 2026. Les alertes à lire s'affichent aussi en tête de l'écran Statistiques ; un responsable les marque vues avec son code. |
| Statistiques | Écran de la caisse réservé aux responsables (iPad et iPhone), avant la connexion à Matalon Vision. Toutes les caisses de l'établissement, calculé par le serveur sur les tickets reçus, sur une période au choix (aujourd'hui, hier, 7 et 30 jours, mois, mois dernier, année, dates libres, 366 jours au plus) comparée à la période précédente de même durée : CA TTC et HT, TVA, tickets, ticket moyen, couverts, dépense par couvert, articles vendus, remises et offerts, annulations ; CA par heure, par jour (par mois au-delà de deux mois), par jour de la semaine ; moyens de paiement, catégories, salle et comptoir, appareils ; articles les plus et les moins vendus ; équipe (CA, tickets, ticket moyen, couverts, remises, annulations) ; tables ; TVA par taux ; remises et annulations par motif ; comptes clients et corrections. CA net des annulations, comme les Z. Ajouté le 8 octobre 2026. |

Tickets, notes et factures portent toutes les mentions obligatoires prévues par la réglementation.

## Conformité fiscale (ISCA)

La conformité repose sur un noyau fiscal isolé, versionné à part et couvert par une attestation individuelle signée par proIA Conseil, entité éditrice, selon le modèle BOI-LETTRE-000242.

| Condition | Exigence | Mise en œuvre |
| --- | --- | --- |
| Inaltérabilité | Aucune vente validée ne peut être modifiée ou supprimée | Base en ajout seul ; corrections par écritures négatives liées à l'original |
| Sécurisation | Toute altération est détectable | Chaque ticket porte l'empreinte SHA-256 du précédent, signée par une clé propre à chaque iPad ; journal des événements chaîné de la même façon |
| Conservation | Les totaux sont figés à chaque période | Clôtures Z journalière, mensuelle et annuelle, avec grand total perpétuel qui ne repart jamais à zéro |
| Archivage | Données lisibles et exploitables pendant 6 ans | Archives périodiques signées, exportables dans un format ouvert, stockées en UE |

Règles de versioning :

- Le noyau fiscal vit dans un module dédié du dépôt, avec ses propres tags de version.
- Le numéro de version figure sur chaque ticket et dans l'attestation.
- Toute modification du noyau fiscal déclenche une mise à jour de l'attestation ; les autres modules évoluent librement.
- Une vérification de la chaîne est exposée dans le back-office, pour démontrer l'intégrité en cas de contrôle.

Risque à garder en tête : en cas de non-conformité, l'amende est de 7 500 € par système de caisse, renouvelable.

Sources : [Shopcaisse, attestation rétablie en 2026](https://www.shopcaisse.com/blog/attestation-logiciel-caisse-retablie-2026) · [Comptanoo, ce que dit la loi en 2026](https://www.comptanoo.com/logiciel-de-caisse-certifie-nf525-ce-que-dit-la-loi-en-2026/) · [Leo2, amendes](https://www.leo2.fr/2025/02/10/systeme-de-caisse-la-certification-nf525-ou-lne-devient-obligatoire/)

## Architecture technique

La caisse fonctionne hors ligne : l'iPad numérote, chaîne et signe les tickets ; le serveur Vercel réplique, vérifie la chaîne et archive en UE.

*(Schéma d'architecture dans le document d'origine : iPad → API Vercel → Postgres Neon et archives UE → Matalon Vision.)*

Le noyau fiscal, en couleur, est le seul composant couvert par l'attestation ; tout ce qui est en dessous lit ses données sans pouvoir les modifier.

Choix techniques :

- **V1 en web app installée (PWA)**, ouverte depuis l'écran d'accueil de l'iPad ou de l'iPhone : stockage persistant demandé au système, base IndexedDB, clé de signature WebCrypto non exportable propre à chaque iPad, impression Epson en ePOS-Print par le réseau local. La V2 passera en app native (App Store / Apple Business Manager) pour le trousseau iOS et le SDK de l'imprimante.
- **Serveur** : une fonction Edge Vercel en région Paris (cdg1) ; Postgres Neon en région Francfort, table des enregistrements fiscaux en ajout seul (trigger). Le serveur ne signe rien : une clôture de secours ne peut venir que d'un iPad, le serveur peut seulement alerter si un Z manque.
- **Numérotation** : une séquence par iPad, identifiant de caisse sur chaque ticket ; aucune dépendance réseau pour encaisser.
- **Multi-établissements** : application générique « Matalon POS ». Chaque iPad est rattaché à un établissement par un code à usage unique (48 h) généré dans l'administration ; il reçoit alors l'établissement, l'équipe, les tables et la carte.
- **Synchronisation** : chaque enregistrement fiscal est répliqué vers le serveur dès que le réseau le permet (après écriture, toutes les minutes, au retour du réseau). Le serveur revérifie continuité, empreinte, signature et totaux ; toute divergence est signalée sans bloquer l'encaissement, l'iPad détenant l'original.

Dépôt Git (GitHub), en monorepo :

| Dossier | Contenu |
| --- | --- |
| apps/caisse | App iPad |
| packages/serveur | API Vercel (établissements, équipes, rattachement, réplication vérifiée) ; l'administration web est servie par apps/caisse sur /admin |
| packages/noyau-fiscal | Chaînage, signatures, clôtures, archives ; tags de version dédiés |
| packages/stock | Ingrédients, fiches techniques, inventaires, food cost |
| packages/connecteurs | Webhooks Matalon Vision |

Branche principale protégée ; tests automatiques du noyau fiscal obligatoires avant toute fusion.

## Module stock et fiches techniques

Chaque vente décrémente le stock théorique à partir de sa fiche technique ; l'écart avec les inventaires donne le food cost réel. Le module remplace Yokitup et démarre avec les nouvelles fiches du Moka.

Données de référence :

- **Ingrédients** : unité de stock, conditionnements (ex. carton de 6 × 1 L), fournisseur, prix d'achat HT.
- **Fiches techniques** : ingrédients et quantités, rendement en portions, pertes matière, sous-recettes (préparations maison).
- **Articles de vente** : chaque article de caisse pointe vers une fiche technique ; la carte n'existe qu'à un seul endroit.

Fonctions V1 :

1. Consommation théorique calculée à chaque ticket validé.
2. Réceptions fournisseurs, avec mise à jour du prix d'achat.
3. Inventaires sur iPad, par zone de stockage.
4. Saisie des pertes et de la casse, avec motif.
5. Écarts théorique / réel par ingrédient et par période.
6. Food cost théorique et réel par article, par catégorie et par période.

Lot ultérieur : alimentation automatique des prix d'achat par l'agent de routage des factures du groupe, puis suggestions de commande fournisseur.

Le module lit les ventes du noyau fiscal mais n'y écrit jamais : il reste hors du périmètre de l'attestation.

### Décisions du 9 octobre 2026

- **Démarrage immédiat** du lot 4, sur décision de Lionel, avant la fin des lots 1 à 3.
- **Pas de reprise de Yokitup** : on repart de zéro. Lionel fournit les premiers produits à importer (tableur : produit, unité, famille, zone, fournisseur, référence, conditionnement, quantité, prix HT, poids unitaire).
- **Périmètre** : le module sert tous les établissements, présents et futurs ; le Moka est mis en place le premier.

### Modèle

- **Produit** : ingrédient générique, compté dans une unité (kg, L ou pièce), avec famille, zone de stockage et statut (actif ou archivé). Un nom ne peut exister qu'une fois : un doublon couperait le stock et le coût en deux.
- **Article fournisseur** : un produit chez un fournisseur, avec sa référence, son conditionnement d'achat (carton de 6 × 1 L), son prix HT et l'historique des prix. Un produit peut en avoir plusieurs.
- **Recette (fiche technique)** : lignes de produits ou de sous-recettes, quantité et perte matière par ligne, rendement par lot (une sauce se fait par 1,2 L, un plat à la pièce). Une recette qui se contient elle-même est refusée.
- **Liaison avec la carte** : chaque article de la carte, et chaque variante, supplément ou choix de formule, pointe vers une recette ou vers un produit vendu tel quel, avec une quantité.
- **Deux niveaux** : produits et recettes communs au groupe ; stocks, coûts et inventaires propres à chaque établissement.

### Règles

- **Coût** : dernier prix payé par l'établissement, à défaut celui du groupe, affiché « prix emprunté » ; jamais un coût à zéro faute d'achat.
- **Unités** : une quantité en pièce dans une recette en grammes demande un poids unitaire déclaré ; sans conversion possible, la ligne est refusée.
- **Articles sans fiche** : signalés dans l'éditeur de carte, avec la part du CA couverte par des fiches.
- **Montants** en centimes entiers, quantités en entiers (g, mL ou millièmes de pièce).

### Découpage

| Sous-lot | Contenu |
| --- | --- |
| 4a | Produits, articles fournisseurs, recettes, import des produits, liaison carte, coût des fiches et food cost théorique dans l'éditeur de carte |
| 4b | Consommation théorique à chaque vente (annulation = mouvement inverse, offert consommé), pertes et casse |
| 4c | Réceptions fournisseurs, inventaires sur iPad et iPhone par zone, écarts théorique / réel |
| 4d | Food cost réel, transferts entre établissements, prix alimentés par l'agent de factures |

### Mise en œuvre des sous-lots 4b à 4d (9 octobre 2026)

- **Consommation à la vente** : à la réception des tickets par le serveur, chaque ligne sort du stock les produits de sa fiche, sous-recettes et pertes matière comprises. Fiche de la carte en vigueur à l'heure de la vente, sinon celle d'aujourd'hui (une fiche ajoutée après coup vaut pour les ventes passées, après « Recalculer la consommation »). Une formule consomme la fiche de chaque article choisi. Une annulation remet en stock ; un offert est consommé. Les ventes sans fiche sont signalées dans le food cost.
- **Mouvements** : quantité signée et valeur au coût du moment, en ajout seul ; le stock théorique en est la somme. Un même ticket ne se décompte qu'une fois.
- **Inventaire** (iPad, iPhone ou administration) : par zone ou par produit, en conditionnements et au détail ; seuls les produits saisis sont inventoriés. L'écart compté − théorique devient un mouvement. Le premier inventaire d'un produit donne son stock d'ouverture, hors food cost.
- **Réception** (iPad, iPhone ou administration) : fournisseur, date, bon de livraison, nombre de colis et prix payé, qui devient le dernier prix. Une réception se corrige par annulation, jamais par effacement.
- **Perte** : produit ou préparation, motif obligatoire (casse, péremption, erreur de préparation, repas du personnel, dégustation, vol ou disparition, autre).
- **Transfert** (administration) : d'un établissement à un autre, au coût de l'expéditeur.
- **Food cost** (administration), sur une période : théorique = coût des fiches des articles vendus / CA HT ; réel = théorique + pertes + écarts d'inventaire / CA HT, qui suppose un inventaire en début et en fin de période ; détail par article et par famille, plus gros écarts.
- **Agent de factures** : dépose les lignes d'une facture par une clé d'accès créée dans l'administration (empreinte seule gardée, révocable). Une ligne reconnue (fournisseur et référence, ou libellé déjà rapproché) devient un prix d'achat ; les autres attendent un rapprochement, retenu pour la fois suivante.
- **En caisse** : onglet Stock réservé aux responsables, en ligne (inventaire, réception, perte, stock théorique et dernières pièces).

## Intégration Matalon Vision

Matalon Vision reçoit deux événements de la caisse et ne lui renvoie rien ; le CA du jour fait foi une fois la clôture Z reçue.

| Événement | Déclencheur | Usage dans Matalon Vision | Contenu |
| --- | --- | --- | --- |
| Ticket validé | Chaque vente encaissée | CA provisoire en temps réel, par service | Établissement, caisse, horodatage, totaux HT et TTC par taux de TVA, moyens de paiement, nombre de couverts |
| Clôture Z | Clôture du jour | CA officiel, remplace le provisoire du jour | Établissement, date, totaux par taux de TVA et par moyen de paiement, nombre de tickets, grand total perpétuel |

Côté caisse (Vercel) :

- Envoi par webhook signé (HMAC, clé partagée).
- File d'attente persistante et relances automatiques : aucun événement perdu si Matalon Vision est indisponible.

Côté Matalon Vision (Replit) :

- Un endpoint de réception qui vérifie la signature, clé stockée dans les Secrets Replit.
- Stockage brut de chaque événement, puis agrégation par établissement, jour et service.
- Idempotence sur l'identifiant du ticket ou de la clôture : un doublon n'est compté qu'une fois.
- Calcul du ratio masse salariale / CA par service, en croisant avec les plannings déjà présents dans Matalon Vision.

## Matériel et encaissement

Le poste se compose d'un iPad, d'une imprimante ticket réseau qui pilote le tiroir-caisse, et d'un TPE autonome, sans liaison avec la caisse.

| Élément | Exigence | Options |
| --- | --- | --- |
| iPad | iPadOS récent, sur support fixe ou pied | Modèle à définir |
| Imprimante ticket | Réseau (Wi-Fi ou Ethernet), 80 mm, ouverture du tiroir | Epson TM-m30III, Star mC-Print3 |
| Tiroir-caisse | Raccordé à l'imprimante | Standard RJ12 |
| TPE | Paiement CB et titres-restaurant carte | Autonome : montant ressaisi sur le TPE, aucune intégration en V1 |

Contrôle : à chaque clôture Z, le total CB de la caisse est comparé au total du TPE ; l'écart est saisi et tracé au journal.

## Sécurité, utilisateurs et données personnelles

Chaque action est rattachée à un utilisateur nommé, chaque iPad à une clé révocable, et toutes les données restent hébergées en UE.

- **Utilisateurs** : un compte par personne, code PIN en caisse, double authentification pour le back-office.
- **Droits** : remises, offerts, annulations et clôtures réservés aux rôles autorisés.
- **Appareils** : rattachement par code à usage unique ; clé de signature propre à chaque iPad, non exportable (trousseau iOS en V2) ; un iPad perdu ou volé est révoqué depuis l'administration et ne peut plus encaisser.
- **Secrets** : variables d'environnement Vercel et Secrets Replit, jamais dans le dépôt Git.
- **Sauvegardes** : base serveur sauvegardée quotidiennement ; archives fiscales conservées 6 ans.
- **RGPD** : aucune donnée client par défaut ; l'e-mail saisi pour un ticket dématérialisé sert uniquement à cet envoi.

## Lots de livraison

Le Moka ouvre le 15 octobre 2026 avec la caisse maison : lots 1 et 2 réduits au strict nécessaire d'ici là, lots 3 et 4 après l'ouverture. Décision go / no-go le 13 octobre 2026 à l'issue des services à blanc ; plan B : une caisse de transition conforme, prête à être activée.

| Lot | Contenu | Critère de sortie |
| --- | --- | --- |
| 0. Cadrage | Fiches techniques Moka, choix du matériel, caisse de transition pour l'ouverture | Points ouverts tranchés |
| 1. Noyau fiscal et caisse minimale | Commande, encaissement, ticket, clôtures, archives, mode hors ligne | Tests de chaînage verts, attestation rédigée |
| 2. Back-office et synchronisation | Carte, utilisateurs, rôles, vérification de chaîne, exports | Données serveur identiques aux iPad après une journée hors ligne simulée |
| 3. Connecteur Matalon Vision | Webhooks, file d'attente, réception côté Replit | CA de Matalon Vision égal aux Z sur 7 jours de test |
| 4. Stock et fiches techniques | Ingrédients, fiches, consommation théorique, inventaires, food cost ; sous-lots 4a à 4d livrés le 9 octobre 2026 | Écarts calculés sur un inventaire réel |
| 5. Mise en service | Services à blanc avec l'équipe, puis bascule depuis la caisse de transition | Une semaine d'exploitation sans incident bloquant |

Après la V1 : prix fournisseurs via l'agent de factures, déploiement sur une deuxième enseigne, facturation électronique B2B.

## Points ouverts

Cinq points sont tranchés ; restent la caisse de transition pour l'ouverture, l'outil comptable, la facturation électronique et les fiches techniques.

| Point | Décision |
| --- | --- |
| Entité éditrice | proIA Conseil |
| Ouverture du Moka | Jeudi 15 octobre 2026 |
| Mode de service | Comptoir et tables, pas de vente à emporter |
| TPE | Autonome, pas d'intégration en V1 |
| Audrex | Archives sur serveur validées, export comptable en CSV, mentions obligatoires conformes à la réglementation |

- [x] Entité éditrice qui signe l'attestation : proIA Conseil ou la société exploitant le Moka ?
- [x] Date d'ouverture du Moka, pour caler le planning.
- [x] Mode de service : comptoir, tables, à emporter (impacte la gestion des tables et les taux de TVA).
- [x] Prestataire TPE et type d'intégration.
- [x] Validation Audrex : localisation des archives, mentions des tickets et notes, format d'export comptable.
- [ ] Outil comptable destinataire des clôtures Z.
- [ ] Calendrier de la facturation électronique B2B applicable au Moka, à confirmer avec Audrex.
- [ ] Fiches techniques du Moka à transmettre.

- [ ] Choisir la caisse de transition conforme pour l'ouverture du 15 octobre.
