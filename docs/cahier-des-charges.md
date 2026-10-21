<!--
Copie du cahier des charges tenu dans Claude Docs :
https://claude.ai/code/artifact/396a6c87-7ab4-4603-8121-565fe62eec12 (révision 107, copiée le 21 octobre 2026).
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

Hors V1, sauf arbitrage contraire : commande à table, écran cuisine, click & collect, borne ; le programme de fidélité forme le lot 7 (validé le 21 octobre 2026).

## Périmètre fonctionnel de la caisse

La V1 couvre le cycle complet d'une vente, de la prise de commande à la clôture du jour, sans jamais permettre de modifier une vente validée.

| Fonction | Exigences V1 |
| --- | --- |
| Prise de commande | Catalogue par catégories, options et suppléments, note libre, service au comptoir (bouton « Vente Directe », 17 octobre 2026) et à table (plan de salle, ouverture, transfert et addition par table), tickets en attente ; pas de vente à emporter. « Envoyer » valide la commande : avant envoi, c'est un brouillon (un retrait efface la ligne sans trace) ; après envoi, un retrait reste barré et est tracé au journal, avec un motif et l'accord d'un responsable (son code si un serveur est connecté), et compte dans les statistiques (« Articles retirés après envoi », par motif et par serveur ; 15 octobre 2026). Le CA s'enregistre à l'encaissement (7 octobre 2026) |
| Encaissement | CB sur TPE autonome (montant ressaisi), espèces avec rendu monnaie, titres-restaurant papier et carte, paiement fractionné sur plusieurs moyens. Division de la note (16 octobre 2026, noyau inchangé) : par articles, les articles choisis (ou une partie d'une quantité) font un ticket, le reste demeure sur la table, où ils restent affichés « Réglé » ; en parts égales ou d'un montant libre, ce qui est versé est un acompte sur la table, en ligne seulement, et le dernier paiement édite un ticket unique qui reprend chaque acompte comme paiement. Les couverts vont au ticket qui ferme la table. Un acompte saisi par erreur se rend au client avec l'accord d'un responsable. Une table qui porte des acomptes ne se libère pas et bloque la Z (appareil et serveur) jusqu'à ce qu'elle soit soldée ou mise en compte. |
| Remises et offerts | Motif obligatoire, autorisés selon le rôle, tracés au journal des événements |
| Annulations et remboursements | Jamais de suppression : ticket d'annulation négatif lié au ticket d'origine, motif obligatoire, tracé |
| Correction du paiement | Le détail d'un ticket montre ses moyens de paiement. Un mode erroné se corrige avant la Z de la journée, par un responsable, avec un motif : le ticket reste intact et un ticket de correction signé, de total nul, porte l'écart entre modes ; la Z et une annulation ultérieure tiennent compte des modes corrigés. Exclu pour les ventes en compte. Ajouté le 6 octobre 2026, noyau fiscal 0.6.0. |
| Recherche des tickets | Écran Tickets : 150 derniers tickets ou une période (aujourd'hui, hier, 7 et 30 jours, dates libres), tous les appareils de l'établissement (hors ligne : ceux de l'appareil). Recherche par n°, montant, table, client, serveur ou motif ; filtres par montant (de… à…), moyen de paiement (après correction), nature (ventes, ventes annulées, annulations, règlements de compte, corrections), comptoir ou table, personne et appareil. Totaux de la sélection : nombre de tickets, ventes et encaissé par moyen de paiement (rapprochement du TPE). Consultation seule. Ajouté le 9 octobre 2026. Dans l'administration, rubrique Tickets (17 octobre 2026) : tickets de tous les appareils sur une période (aujourd'hui, hier, 7 et 30 jours, dates libres), résumé par serveur (ventes gardées, CA, ticket moyen, couverts, remises, ventes annulées) dont une ligne filtre la liste, recherche, et le détail de chaque ticket (heure, appareil, table, couverts, serveur, lignes, paiements après correction, annulation éventuelle, journée comptable, empreinte) ; depuis les statistiques, le nom d'un serveur (Équipe) ouvre ses tickets de la période. Consultation seule : annulation, correction, facture et duplicata restent sur l'appareil qui a encaissé. |
| Ticket et note | Mentions légales (raison sociale, SIRET, adresse, n° TVA, date et heure, numéro séquentiel, lignes, TVA par taux, totaux HT et TTC, version du logiciel), impression à la demande, envoi par e-mail (21 octobre 2026 : à la fin de l'encaissement, ou en duplicata depuis les Tickets, le client reçoit le lien de sa note dématérialisée ; l'adresse ne sert qu'à cet envoi, le journal ne garde que le canal). Note due à partir d'un seuil (25 € par défaut) : imprimée d'office, ou, si l'établissement le règle ainsi, rappel à l'encaissement de la remettre (papier ou QR code si le client préfère la version dématérialisée). Duplicata « note sans détail » depuis les Tickets : un total par taux de TVA au lieu des articles, tracé au journal (14 octobre 2026) |
| Facture | Facture client sur demande, générée depuis le ticket, numérotation propre |
| Clôtures | Lecture X à tout moment, clôture Z journalière, clôtures mensuelle et annuelle, fond de caisse, comptage espèces et écart ; dépenses payées en espèces sur le fond (objet et montant) déclarées au comptage, déduites des espèces attendues, tracées au journal et imprimées sur le Z (15 octobre 2026). Les tickets et les clôtures de tous les appareils de l'établissement se consultent depuis chacun ; annulation, correction et facture restent sur l'appareil qui a encaissé (7 octobre 2026). La lecture X, la Z et les clôtures mensuelle et annuelle portent sur tout l'établissement, quel que soit le nombre de caisses, et se font depuis n'importe quel appareil, en ligne : un seul appareil clôture à la fois ; un ticket pas encore reçu d'un appareil hors ligne entre dans la Z suivante ; le fond de caisse déclaré sur un appareil vaut pour tous ; un appareil seul de son établissement peut encore clôturer hors ligne (7 octobre 2026, noyau fiscal 0.7.0). Dans l'administration, rubrique Clôtures (21 octobre 2026) : les clôtures de l'établissement sur un mois ou une année, tous appareils, avec le total des Z de la période (TTC, HT, TVA, ventes, encaissé par moyen de paiement) et un rappel quand un mois passé n'a pas sa clôture mensuelle ; pour chaque Z, l'appareil, le nombre de tickets et l'écart du comptage (ou « sans comptage ») ; son détail donne les appareils couverts, les totaux, le grand total perpétuel, le comptage, l'empreinte et l'archive JSON à télécharger. Exports de la période : export comptable CSV (une ligne par clôture, format validé par Audrex) et comptages de caisse CSV (espèces attendues et comptées, CB et titres-restaurant face au TPE, écarts et motif, dépenses en espèces, fond conservé, remise en banque). Consultation seule : une clôture se fait sur la caisse |
| Utilisateurs | Connexion par code PIN, changement rapide d'utilisateur, rôles vendeur, responsable, administrateur. Cinq codes PIN faux de suite bloquent la personne 5 minutes (connexion et validation responsable), avec une alerte. Modifier l'équipe depuis une caisse demande le code d'un responsable, vérifié par le serveur (8 octobre 2026) |
| Comptes clients | Vente portée au compte d'un client (accord d'un responsable), réglée plus tard sur n'importe quel appareil, annulation d'un règlement. Fiche client : nom, téléphone, e-mail ; chaque note due se rouvre depuis la fiche, même encaissée sur un autre appareil. La vente compte dans le CA du jour ; la TVA est exigible au règlement (restauration sur place = prestation de services). Ajouté le 6 octobre 2026, noyau fiscal 0.5.0. |
| Bons de production | Chaque catégorie de la carte désigne un poste (bar, cuisine) ; l'établissement associe une imprimante à chaque poste. « Envoyer » imprime les nouveaux articles par poste, le reste part à l'encaissement, un retrait après envoi imprime un bon d'annulation. Hors périmètre fiscal. Dans l'éditeur de carte, deux catégories au même taux de TVA peuvent être fusionnées. Ajouté le 6 octobre 2026. |
| Suites (courses) | À table, chaque article part « En direct » ou « À suivre » 1, 2 ou 3, selon un sélecteur en tête de la commande (En direct par défaut) ; la suite d'un article pas encore envoyé se change depuis sa ligne. « Envoyer » fait tout partir : chaque bon range ses articles par suite et les marque. « Réclamer AS n » (une fois par suite) fait d'abord partir ce qui reste à envoyer, puis imprime un bon de réclame à chaque poste qui tient déjà des articles de cette suite ; un article ajouté ensuite à une suite réclamée part marqué « réclamé ». La commande montre chaque suite et l'heure de sa réclame ; le plan et la liste des tables, la prochaine suite à réclamer et le temps écoulé depuis le dernier envoi ou la dernière réclame. Transfert et regroupement gardent les suites. Pas de suites au comptoir. Hors périmètre fiscal. Ajouté le 8 octobre 2026. |
| Plan de salle | Tables carrées, rectangulaires ou rondes avec leur nombre de chaises (carrées et rectangulaires tournent d'un quart de tour, chaises comprises, 14 octobre 2026), placées sur une grille de 25 cm, zone par zone, avec des repères (bar, porte, murs). Dessiné dans l'administration ou sur l'iPad par un responsable ; une modification faite ailleurs entre-temps est refusée plutôt qu'écrasée. Une table n'est jamais supprimée, elle est masquée (les tickets la citent). En caisse : plan avec l'état de chaque table, couverts sur chaises, zoom et bascule en liste (iPhone). Tables assemblées pour un groupe : une commande, libérées ensemble. Ajouté le 6 octobre 2026. |
| Alertes | Dans l'administration, par établissement : vente à un autre prix ou taux de TVA que la carte (version en vigueur au moment de la vente, ou la précédente), article hors carte, code PIN bloqué. Une alerte ne bloque rien ; elle se marque vue. Ajouté le 8 octobre 2026. Les alertes à lire s'affichent aussi en tête de l'écran Statistiques ; un responsable les marque vues avec son code. |
| Statistiques | Écran de la caisse réservé aux responsables (iPad et iPhone), et le même dans l'administration, rubrique Statistiques (16 octobre 2026), avant la connexion à Matalon Vision. En direct tant que la période va jusqu'à aujourd'hui : recalcul toutes les 10 secondes pour la journée (chaque minute sur une période plus longue), chaque vente arrivant au serveur quelques secondes après l'encaissement ; « En salle maintenant » donne les tables ouvertes, leurs couverts et ce qui reste à encaisser (acomptes déduits), hors comptoir. Toutes les caisses de l'établissement, calculé par le serveur sur les tickets reçus, sur une période au choix (aujourd'hui, hier, 7 et 30 jours, mois, mois dernier, année, dates libres, 366 jours au plus) comparée à la période précédente de même durée : CA TTC et HT, TVA, tickets, ticket moyen, couverts, dépense par couvert, articles vendus, remises et offerts, annulations ; CA par heure, dans l'ordre de la journée de service, de 8 h à 3 h du matin (les heures d'après minuit après 23 h ; une vente hors de ces heures élargit l'axe ; 17 octobre 2026), par jour (par mois au-delà de deux mois), par jour de la semaine ; moyens de paiement, catégories, salle et comptoir, appareils ; articles les plus et les moins vendus ; équipe (CA, tickets, ticket moyen, couverts, remises, annulations) ; tables ; TVA par taux ; remises et annulations par motif ; comptes clients et corrections. CA net des annulations, comme les Z. Ajouté le 8 octobre 2026. Moments de la journée (20 octobre 2026) : l'administration définit, par établissement, jusqu'à 8 moments nommés avec leurs horaires (Matin 8 h – 12 h, Soir 18 h – 3 h…), fin exclue, passage de minuit admis, sans chevauchement ; la carte « CA par moment » des statistiques (caisse et administration) donne pour chacun le CA, sa part, l'écart avec la période précédente, les tickets, le ticket moyen et les couverts, plus « Hors moments » s'il y a des ventes en dehors. Une vente compte à l'heure de son encaissement, une annulation dans le moment de la vente annulée ; le regroupement se calcule à la lecture, ventes passées comprises. Hors périmètre fiscal. |

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

- **V1 en web app installée (PWA)**, ouverte depuis l'écran d'accueil de l'iPad ou de l'iPhone : stockage persistant demandé au système, base IndexedDB, clé de signature WebCrypto non exportable propre à chaque iPad, impression Epson en ePOS-Print par le réseau local. L'imprimante des tickets est commune à l'établissement (réglée sur un appareil ou dans l'administration, reçue par les autres à la synchronisation) ; un appareil peut garder la sienne. Chaque appareil accepte une fois le certificat de l'imprimante (ajouté le 13 octobre 2026). La V2 passera en app native (App Store / Apple Business Manager) pour le trousseau iOS et le SDK de l'imprimante.
- **Serveur** : une fonction Edge Vercel en région Paris (cdg1) ; Postgres Neon en région Francfort, table des enregistrements fiscaux en ajout seul (trigger). Le serveur ne signe rien : une clôture de secours ne peut venir que d'un iPad, le serveur peut seulement alerter si un Z manque.
- **Numérotation** : une séquence par iPad, identifiant de caisse sur chaque ticket ; aucune dépendance réseau pour encaisser.
- **Multi-établissements** : application générique « Matalon POS ». Chaque iPad est rattaché à un établissement par un code à usage unique (48 h) généré dans l'administration ; il reçoit alors l'établissement, l'équipe, les tables et la carte.
- **Administration web** : l'établissement se choisit dans l'en-tête (avec ses alertes et ses caisses), puis un menu latéral ouvre ses rubriques : Statistiques (16 octobre 2026), Tickets (17 octobre 2026), Clôtures (21 octobre 2026), Appareils, Équipe, Plan de salle, Imprimantes, Réservations, Comptes clients, Fidélité (21 octobre 2026), Cartes et prix (communes au groupe), Stock et recettes, Alertes, Identité et carte. Une page par rubrique au lieu d'une seule page longue ; sur iPhone, le menu devient une liste « Rubrique ». L'adresse garde l'établissement et la rubrique (lien ou rechargement), et le poste retrouve le dernier établissement ouvert. Ajouté le 11 octobre 2026.
- **Synchronisation** : chaque enregistrement fiscal est répliqué vers le serveur dès que le réseau le permet (après écriture, toutes les minutes, au retour du réseau). Le serveur revérifie continuité, empreinte, signature et totaux ; toute divergence est signalée sans bloquer l'encaissement, l'iPad détenant l'original.
- **Commandes en cours partagées** : une table ouverte sur un appareil apparaît sur les autres en quelques secondes (lecture du serveur toutes les 4 secondes) ; chacun peut y ajouter, modifier, envoyer, transférer ou encaisser. Écriture conditionnelle par version ; deux modifications simultanées sont fusionnées ligne par ligne, sans rien perdre de ce qui a été ajouté. À l'encaissement, la table est d'abord fermée sur le serveur : un autre appareil ne peut plus l'encaisser (refus « déjà encaissée sur … »). Hors ligne, l'appareil continue (y compris l'encaissement) et se remet à jour au retour du réseau. Le comptoir reste propre à chaque appareil. Hors périmètre fiscal : seuls les tickets, scellés sur l'appareil qui encaisse, comptent. Ajouté le 13 octobre 2026.
- **Production et test** : la production tourne sur matalon-pos.app (projet Vercel et base Neon propres, sans mode test) ; la caisse de test reste sur matalon-pos-test.vercel.app, chaque note portant la mention « sans valeur ». La configuration (établissements, équipe, plan, imprimante des tickets, cartes, stock, commandes fournisseurs, réservations à venir) passe de l'une à l'autre par un fichier exporté dans l'administration et importé dans une installation neuve ; aucune vente ni aucun appareil ne suit, et l'import est refusé dès que la base a servi. Noyau fiscal gelé en 1.0.0 pour l'attestation. Ajouté le 16 octobre 2026.

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

Lot ultérieur : alimentation automatique des prix d'achat par l'agent de routage des factures du groupe, puis suggestions de commande fournisseur (les commandes elles-mêmes sont livrées depuis le 15 octobre 2026, voir plus bas).

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
- **Inventaire** (iPad, iPhone ou administration) : par zone ou par produit, en conditionnements et au détail ; seuls les produits saisis sont inventoriés. L'écart compté − théorique devient un mouvement. Le premier inventaire d'un produit donne son stock d'ouverture, hors food cost. L'onglet Inventaire liste d'abord les inventaires faits (détail par produit, avec une recherche : compté, théorique, écart, valeur), puis « Nouvel inventaire ». Un comptage se date : celui d'un jour passé (92 jours au plus) se compare au stock théorique de ce jour-là, et les livraisons et ventes d'après s'y ajoutent ; il est refusé pour un produit déjà inventorié depuis (15 octobre 2026).
- **Réception** (iPad, iPhone ou administration) : fournisseur, date, bon de livraison, nombre de colis et prix payé, qui devient le dernier prix. Une réception se corrige par annulation, jamais par effacement.
- **Perte** : produit ou préparation, motif obligatoire (casse, péremption, erreur de préparation, repas du personnel, dégustation, vol ou disparition, autre).
- **Transfert** (administration) : d'un établissement à un autre, au coût de l'expéditeur.
- **Food cost** (administration), sur une période : théorique = coût des fiches des articles vendus / CA HT ; réel = théorique + pertes + écarts d'inventaire / CA HT, qui suppose un inventaire en début et en fin de période ; détail par article et par famille, plus gros écarts.
- **Agent de factures** : dépose les lignes d'une facture par une clé d'accès créée dans l'administration (empreinte seule gardée, révocable). Une ligne reconnue (fournisseur et référence, ou libellé déjà rapproché) devient un prix d'achat ; les autres attendent un rapprochement, retenu pour la fois suivante.
- **En caisse** : onglet Stock réservé aux responsables, en ligne (inventaire, réception, perte, stock théorique et dernières pièces).
- **Carte et fiches sur l'iPad** (16 octobre 2026) : un responsable modifie la carte de son établissement (prix, articles, catégories, rayons, disponibilité, fiches liées) et les fiches techniques depuis le menu de la caisse, en ligne, avec le même éditeur que l'administration. Rôle de la personne connectée vérifié par le serveur, sur un appareil rattaché à l'établissement ; une modification faite ailleurs entre-temps est refusée plutôt qu'écrasée ; chaque enregistrement est tracé au journal avec son auteur. Les produits et prix d'achat restent dans l'administration. La carte parvient aux autres appareils à leur synchronisation.

### Commandes fournisseurs (15 octobre 2026)

Demandées par Lionel le 15 octobre 2026 pour le test d'avant ouverture : saisie de la commande dans l'interface, envoi au fournisseur sur les coordonnées de sa fiche, puis réception pour intégration au stock. Hors périmètre fiscal.

- **Fiche fournisseur** (administration › Stock et recettes › Fournisseurs), commune au groupe : e-mail de commande, trois adresses en copie au plus, contact, téléphone, franco de port, jours de livraison, note, numéro de client de chaque établissement. Son nom est celui des articles fournisseurs : la renommer renomme ses articles.
- **Bon de commande**, propre à l'établissement et numéroté (1, 2, 3…), saisi dans l'administration ou dans l'onglet Stock de la caisse (responsables) : fournisseur, quantités en conditionnements (stock théorique et dernier prix affichés), livraison souhaitée, message ; le franco manquant est signalé. Modifiable tant qu'il est en brouillon.
- **Envoi** : par e-mail, avec la clé Resend de l'établissement, à l'adresse de la fiche ; en copie les adresses de la fiche et l'e-mail de l'établissement, qui reçoit aussi les réponses. Ou « marquée envoyée » quand la commande passe par téléphone ou par un portail. Un e-mail refusé laisse la commande en brouillon.
- **Réception** contre la commande : reste à recevoir et prix pré-remplis, corrigés au besoin ; le stock entre et le prix devient le dernier payé, comme toute réception. Livraison partielle : la commande reste ouverte (« reçue en partie ») jusqu'à la livraison suivante ou au solde. Une réception annulée ne compte plus.
- **Suivi** : brouillon, envoyée, reçue en partie, reçue, soldée, annulée. Annulation seulement avant toute réception, avec un e-mail au fournisseur si le bon lui était parti par e-mail. Historique de chaque bon.
- **Import** : l'écran Importer accepte aussi les fiches techniques (recette, ingrédient, quantité, unité) et le volume d'une pièce vendue entière (`volume_unitaire_ml`).

## Réservations en ligne

Le client réserve depuis le site de l'établissement dans un panneau semblable à Zenchef ; la réservation est confirmée d'office, reçoit une table et apparaît sur le plan de salle de la caisse. Module commun à tous les établissements, réglé et testé au Moka d'abord. Demandé par Lionel le 9 octobre 2026, lancé le jour même (lot 6), hors périmètre fiscal.

### Décisions du 9 octobre 2026

| Question | Décision |
| --- | --- |
| Premier établissement | Moka (le plan de table n'existe que là où Matalon POS est la caisse) |
| Capacité | Les trois plafonds par service : couverts du service, personnes à table en même temps (avec la durée), arrivées par créneau |
| Confirmation | D'office, avec un e-mail au client (lien d'annulation) et une copie à l'établissement ; service d'envoi Resend, un compte par établissement, depuis son domaine (moka-annecy.com, déjà vérifié) |
| Plan de table | Plus petite table libre qui convient attribuée d'office, modifiable par l'équipe ; un groupe reçoit plusieurs tables, choisies à la saisie ou dans la liste (20 octobre 2026) |

### Module du site

- Une balise `<script src="…/reservation.js" data-etablissement="moka" async>` ajoute un bouton flottant « Réserver une table » ; les boutons du site marqués `data-matalon-reserver` ou pointant vers `#reserver` ouvrent le même panneau. Lien direct en page entière pour Google, Instagram ou un QR code. Logo de l'établissement (21 octobre 2026) : déposé dans l'administration (Identité et carte › Logo), réduit en PNG de 600 × 240 au plus, il s'affiche en tête du module (sur fond sombre, à défaut d'un data-logo dans la balise) et des e-mails aux clients (sur fond blanc) : réservations, fidélité, note par e-mail.
- Parcours : nombre de couverts, date (prochaines disponibilités ou calendrier), préférence de salle s'il y a plusieurs zones, horaire par service (complet signalé), puis civilité, prénom, nom, téléphone avec indicatif, e-mail, commentaire, conditions à accepter, offres par e-mail (consentement facultatif), mémorisation sur l'appareil. Confirmation avec ajout à l'agenda et lien d'annulation.
- Au-delà du groupe maximum en ligne, le module invite à appeler ou écrire. Une même personne (téléphone) ne réserve qu'une fois par jour en ligne ; un champ piège écarte les robots.

### Administration

- Services : nom, jours, première et dernière heure d'arrivée, couverts du service, personnes en même temps, arrivées par créneau, durée propre (facultatif). Deux services ne se chevauchent pas un même jour.
- Règles : durée par défaut d'une réservation, écart entre créneaux (15 ou 30 min), délai minimum avant l'arrivée, réservation jusqu'à N jours à l'avance, groupe maximum en ligne, fermetures exceptionnelles, message d'accueil, téléphone, e-mail de l'établissement, liens des conditions et de la politique de confidentialité.
- E-mails : chaque établissement a son compte Resend. Sa clé API se saisit dans l'administration, est chiffrée sur le serveur avec une clé maîtresse gardée hors de la base, et n'est plus jamais affichée (aperçu seulement). Adresse d'expédition propre (domaine vérifié dans ce compte), e-mail de l'établissement qui reçoit les réservations et les réponses, e-mail d'essai.
- Réservations à venir (par jour, sur la fenêtre de réservation en ligne, au moins 60 jours) ou d'un jour par service (couverts réservés sur le plafond), recherche par nom, téléphone, e-mail ou note ; tables et statut modifiables dans la liste (une ou plusieurs tables, places comptées face aux personnes, tables déjà prises sur le créneau signalées ; 20 octobre 2026) ; fiche de réservation pour modifier date, heure, personnes, durée, coordonnées et note, annuler (client prévenu par e-mail) ou rétablir, avec l'historique ; saisie d'une réservation prise au téléphone ou sur place ; la balise à copier.

### Caisse

- Plan de salle : table réservée (heure et nom), bord plein dans la demi-heure ; une table occupée affiche « Résa 20:00 » dans l'heure qui précède. Même indication dans la vue en liste.
- Réservations du jour : installer (la table s'ouvre avec les couverts et une note au nom du client, tables assemblées comprises), placer sur une ou plusieurs tables, absent, annuler, remettre à venir, saisir au téléphone. Liste relue chaque minute ; hors ligne, la dernière copie du jour.
- Toutes les réservations depuis la caisse, comme dans l'administration : vues « Aujourd'hui », « À venir » (par jour, sur la fenêtre de réservation en ligne, au moins 60 jours) et « Par jour » (jour au choix) ; recherche par nom, téléphone, e-mail ou note ; fiche pour modifier date, heure, personnes, durée, coordonnées et note, annuler ou rétablir, avec l'historique ; saisie pour n'importe quel jour. Les jours suivants demandent une connexion. Ajouté le 14 octobre 2026.
- L'équipe peut dépasser un plafond après confirmation (« Enregistrer quand même »), tracé dans l'historique de la réservation ; le client en ligne jamais.

### Règles

- Une réservation compte (capacité et tables) tant qu'elle est confirmée ou installée ; annulée ou absente, elle libère sa place.
- Deux demandes simultanées : chacune est revérifiée après son écriture contre celles écrites avant elle, la seconde est refusée si elle dépasse.
- Coordonnées gardées un an après la date de la réservation, puis effacées ; le lien d'annulation cesse alors de valoir.
- Une réservation n'est ni un ticket ni une commande : rien n'entre au registre fiscal. Le CA reste celui des tickets.

## Carte de fidélité (proposée et validée le 21 octobre 2026)

Un programme par établissement, activable dans l'administration, dont la règle se règle (points sur la dépense ou tampons) ; le client est reconnu par son téléphone ou par sa carte dans Apple Wallet ou Google Wallet ; la récompense s'applique comme une remise sur le ticket, sans modifier le noyau fiscal. Proposition demandée par Lionel et validée le 21 octobre 2026 : tout le programme se configure dans l'administration, et la règle comme la récompense du Moka se choisiront à sa mise en route. Première version par le téléphone seul (7a), la carte Wallet viendra plus tard (7b) ; les messages au client partent par e-mail, sans SMS. L'étape 7a est lancée le 21 octobre 2026 sur décision de Lionel, avant la fin des lots 1 à 5 (comme le stock et les réservations).

### Étape 7a livrée (21 octobre 2026)

- **Administration › Service › Fidélité** : créer le programme (inactif tant qu'il n'est pas activé ; proposition de départ 1 point par euro, 10 € offerts à 150 points, 10 points de bienvenue, points perdus après 12 mois sans visite), ou rejoindre celui d'un autre établissement ; un propriétaire ne quitte pas un programme encore partagé. Règles modifiées par version (une modification faite ailleurs entre-temps est refusée), contrôlées de la même façon à l'écran et au serveur. Membres : recherche (nom, e-mail, chiffres du téléphone), fiche modifiable, solde, historique du registre, ajustement motivé (jamais sous zéro), effacement RGPD.
- **Caisse** : bouton carte de fidélité sur la commande (table ou Vente Directe) ; téléphone saisi en toutes formes (06…, +33…, 0033…), ramené à +33… ; client inconnu inscrit sur place (prénom, nom et e-mail facultatifs, accord pour les offres décoché). La commande affiche le prénom, le solde et les récompenses appliquées, sur tous les appareils (la carte voyage avec la table partagée).
- **Récompense** : réservée en ligne (le solde baisse aussitôt), appliquée en remise de ligne motif « Fidélité » sans code de responsable : article offert ajouté (une unité, remise 100 %, au choix si la récompense en propose plusieurs), remise en euros sur les lignes sans remise des plus chères aux moins chères dans la limite de la note, ou pourcentage sur chaque ligne sans remise. Retirée de la commande, elle est rendue ; réservée et jamais passée sur un ticket, elle revient d'office au bout de 48 h. Une récompense par ticket si la règle le veut. La récompense se paie en points au moment de l'utiliser : la « récompense valable N jours » de la proposition est sans objet, seule la validité des points s'applique.
- **Cumul** : calculé par le serveur à la réception du ticket, sur les articles vendus (TTC après remise), hors catégories exclues et hors lignes de récompense ; doublé sur les moments choisis ; plafonné si demandé. Le lien entre la carte et le ticket part à côté du ticket (file de l'appareil, envoyée après lui), jamais dans l'enregistrement scellé ; renvoyé après une coupure, il ne compte qu'une fois. Une vente annulée retire ses points et rend la récompense utilisée.
- **Hors ligne** : la carte se rattache par le téléphone, les points viennent à la synchronisation ; les récompenses attendent le réseau.
- **Client qui avait oublié sa carte** : écran Tickets › un ticket du jour › « Ajouter à une carte de fidélité », une seule fois par ticket.
- **E-mails** (si le membre en a donné un) : bienvenue, puis récompense atteinte, avec la clé et l'expéditeur des réservations de l'établissement.
- **Statistiques** (caisse et administration) : carte « Fidélité » : membres venus, inscriptions, CA des membres et sa part, visites par membre, récompenses données et leur valeur, points gagnés.
- **Données** : registre en ajout seul (le solde est la somme des mouvements) ; coordonnées effacées à la demande, ou d'office après trois ans sans visite, le registre restant sans nom. La configuration de l'installation exporte les programmes, jamais les membres.
- Reporté : bonus d'anniversaire (la date de naissance n'est pas demandée), carte Wallet (7b), inscription en libre-service (7c). Noyau fiscal inchangé (1.0.0).

### Réglages du programme (administration, par établissement)

| Réglage | Choix | Exemple pour le Moka |
| --- | --- | --- |
| Programme | Actif ou non, nom affiché au client | « Club Moka », actif |
| Cumul | Points sur la dépense (X points par euro TTC encaissé), ou tampons (par article d'une catégorie, ou par visite au-delà d'un montant) | 1 point par euro |
| Récompenses | Un ou plusieurs paliers : article offert choisi dans une liste de la carte, remise en euros ou en pourcentage sur le ticket | 50 points : une boisson chaude offerte ; 150 points : 10 € offerts |
| Bonus | Bienvenue à l'inscription, anniversaire, points doublés sur un moment de la journée (Matin, Après-midi…) | 10 points de bienvenue |
| Exclusions | Catégories qui ne rapportent rien, plafond par ticket | Aucune |
| Validité | Points perdus après N mois sans visite ; récompense valable N jours | 12 mois ; 60 jours |
| Périmètre | Un programme par établissement ; d'autres établissements du groupe peuvent le rejoindre (mêmes règles, même solde) (21 octobre 2026) | Programme du Moka, que d'autres établissements pourront rejoindre |

Une règle modifiée vaut pour la suite ; les points déjà gagnés restent acquis.

### Carte du client

- **Reconnaissance à la caisse** : par le numéro de téléphone (fiche client existante, sans rien à installer), puis, avec l'étape 7b, par le QR code de sa carte, lu par la caméra de l'iPad ou de l'iPhone.
- **Carte dématérialisée** dans Apple Wallet (pass PassKit) et Google Wallet (carte de fidélité) : nom, solde, prochaine récompense, QR code. Elle se met à jour après chaque vente, avec un message sur l'écran verrouillé quand une récompense est atteinte. Une page web de la carte sert ceux qui n'utilisent pas de Wallet. Pas de carte plastique.
- **Inscription** : à la caisse (téléphone et prénom, puis, avec l'étape 7b, lien envoyé par e-mail pour ajouter la carte au Wallet), en libre-service par un QR code (comptoir, table, note client), ou depuis la réservation en ligne (case à cocher). L'accord pour recevoir des offres est une case à part, décochée.

### En caisse

- Avant d'encaisser, « Fidélité » sur la commande : téléphone ou scan ; la commande affiche le nom et le solde du client.
- Une récompense atteinte est proposée ; un geste l'applique (article offert ou remise), motif « Fidélité », sans code de responsable puisque la règle l'autorise. Une récompense par ticket (réglable).
- Client qui avait oublié sa carte : rattachement à un ticket du jour, une fois, depuis l'écran Tickets.
- Hors ligne, le cumul continue (il est calculé à la synchronisation) ; utiliser une récompense demande le réseau, pour que le solde soit sûr (comme les acomptes).
- Statistiques : membres actifs, part du CA faite par les membres, récompenses données et leur valeur, fréquence de visite.

### Fiscal et comptable

- **Noyau fiscal inchangé (1.0.0)** : la récompense figure sur le ticket comme une remise de ligne (article offert ou montant), motif « Fidélité ». La base de TVA est réduite à la vente qui consomme la récompense, comme un rabais : le BOFiP traite les ristournes de fidélité comme des réductions de prix, recettes déclarées nettes ([BOI-TVA-BASE-10-20-10](https://bofip.impots.gouv.fr/bofip/705-PGP.html/identifiant=BOI-TVA-BASE-10-20-10-20220629), § 470 à 530). Le cas de l'article offert n'y est pas traité en propre : à faire confirmer par Audrex.
- **Les points ne sont jamais un moyen de paiement** : ils n'apparaissent ni dans les encaissements ni dans les Z.
- **Registre de fidélité, hors fiscal**, sur le serveur, en ajout seul : gain, utilisation, ajustement motivé par un responsable, expiration. Le gain se calcule à la réception des tickets, comme les consommations de stock ; une annulation retire les points gagnés. Le lien entre la carte et le ticket voyage à côté du ticket, jamais dans l'enregistrement scellé.

### Données personnelles

- Le fonctionnement du programme repose sur l'adhésion du client (exécution du contrat) ; recevoir des offres demande un consentement distinct, retirable à chaque message ([synthèse RGPD des cartes de fidélité](https://donneespersonnelles.fr/rgpd-carte-fidelite)).
- Conservation : tant que la carte vit, puis trois ans après la dernière visite (référentiel CNIL de gestion commerciale), ensuite anonymisation.
- Information courte à l'inscription et page de conditions ; accès, rectification et suppression depuis l'administration.

### Prérequis et coûts

| Élément | Ce qu'il faut | Coût |
| --- | --- | --- |
| Apple Wallet | Compte Apple Developer (déjà actif, à passer au nom de PROIA CONSEIL), un identifiant de pass (Pass Type ID) et son certificat, qui signe les cartes et envoie les mises à jour ([PassKit](https://developer.apple.com/library/ios/documentation/UserExperience/Conceptual/PassKit_PG/Updating.html)) | Compris dans le compte, aucun coût par carte |
| Google Wallet | Compte émetteur Google Wallet, carte de fidélité par l'API ([Google Wallet API](https://developers.google.com/wallet/reference/rest/v1/loyaltyobject)) | Gratuit |
| E-mails | Resend, déjà en place | Inchangé |
| SMS | Non retenu : e-mail seulement (21 octobre 2026) | Aucun |

Un service de cartes Wallet tout fait (abonnement mensuel) est possible, mais n'est pas recommandé : le serveur existe déjà, et les données des clients restent chez nous.

### Découpage proposé (lot 7, à planifier après les lots en cours)

| Étape | Contenu | Validation |
| --- | --- | --- |
| 7a | Programme et règles dans l'administration, reconnaissance par téléphone, cumul et récompenses en caisse, registre, statistiques | Une semaine au Moka avec la règle choisie, registre égal aux tickets (code livré le 21 octobre 2026, à valider en service) |
| 7b | Plus tard, au signal de Lionel : carte Apple Wallet et Google Wallet, lecture du QR code, mises à jour après chaque vente | Carte ajoutée sur iPhone et sur Android, solde à jour moins d'une minute après la vente |
| 7c | Inscription en libre-service et depuis la réservation, e-mails (pas de SMS) | Premières inscriptions sans passage par l'équipe |

### À trancher par Lionel

- [ ] Règle du Moka : points sur la dépense (un cadeau tous les X euros) ou tampons (le 10e café offert) ; se choisira dans l'administration à la mise en route (21 octobre 2026)
- [x] Un programme par établissement, que d'autres établissements du groupe peuvent rejoindre (mêmes règles, même solde) — décidé le 21 octobre 2026
- [ ] Récompense : article offert choisi dans une liste, remise en euros, ou les deux ; se choisira dans l'administration à la mise en route (21 octobre 2026)
- [x] Téléphone d'abord (7a), carte Wallet plus tard (7b) — décidé le 21 octobre 2026
- [x] E-mail seulement, pas de SMS — décidé le 21 octobre 2026
- [ ] Traitement de l'article offert validé par Audrex

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

- **Utilisateurs** : un compte par personne, code PIN en caisse, double authentification pour le back-office. Clé d'accès (passkey) possible à la place du mot de passe et du code : Face ID, Touch ID ou code de l'appareil exigé, défi à usage unique, clé liée au domaine de l'administration, seule la partie publique gardée sur le serveur ; créée avec le code de vérification redemandé, retirable, connexions et ajouts journalisés. Le mot de passe et le code restent valables en secours. Ajouté le 11 octobre 2026.
- **Droits** : remises, offerts, annulations et clôtures réservés aux rôles autorisés.
- **Appareils** : rattachement par code à usage unique ; clé de signature propre à chaque iPad, non exportable (trousseau iOS en V2) ; un iPad perdu ou volé est révoqué depuis l'administration et ne peut plus encaisser.
- **Secrets** : variables d'environnement Vercel et Secrets Replit, jamais dans le dépôt Git.
- **Sauvegardes** : retour en arrière de la base serveur à n'importe quel instant des 7 derniers jours, par l'historique de Neon (décision de Lionel du 21 octobre 2026 : pas de copie hors Neon) ; archives fiscales conservées 6 ans.
- **RGPD** : aucune donnée client par défaut ; l'e-mail saisi pour un ticket dématérialisé sert uniquement à cet envoi. Les réservations gardent nom, téléphone, e-mail et commentaire un an après leur date, puis les effacent ; les offres commerciales ne partent qu'avec le consentement coché par le client. Page d'information des clients par établissement, /donnees/<établissement> (21 octobre 2026) : responsable, achats et notes, ventes en compte (nom conservé six ans sur les tickets, obligation légale), réservations, carte de fidélité, hébergement, droits ; citée à la création d'un compte client, à l'inscription à la fidélité et dans le module de réservation (à défaut d'un lien propre à l'établissement).

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
| 6. Réservations en ligne | Module du site, services et capacités, e-mails, tables attribuées et affichées au plan ; lancé le 9 octobre 2026 sur décision de Lionel | Premières réservations réelles du Moka reçues par le site, confirmées par e-mail et installées depuis le plan |

Après la V1 : prix fournisseurs via l'agent de factures, déploiement sur une deuxième enseigne, facturation électronique B2B.

## Points ouverts

Sept points sont tranchés ; restent l'outil comptable et la facturation électronique.

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
- [x] Fiches techniques du Moka à transmettre (importées, confirmé le 21 octobre 2026).

- [x] Choisir la caisse de transition conforme pour l'ouverture du 15 octobre (sans objet : le Moka encaisse sur Matalon POS, 21 octobre 2026).
