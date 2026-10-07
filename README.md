# Matalon POS

Caisse tactile iPad multi-établissements du groupe Matalon, conforme à l'article 286 I 3° bis du CGI (conditions ISCA : inaltérabilité, sécurisation, conservation, archivage). Premier établissement : le Moka, ouverture le 15 octobre 2026.

Éditeur : proIA Conseil.

## Structure

| Dossier | Contenu | Périmètre fiscal |
| --- | --- | --- |
| `packages/noyau-fiscal` | Tickets chaînés et signés, journal des événements, clôtures Z / mois / exercice, vérification, archives, export CSV | **Oui**, couvert par l'attestation |
| `packages/catalogue` | Format des cartes (prix, TVA, variantes, suppléments, formules), lecture stricte et contrôles, carte d'origine du Moka | Non |
| `packages/serveur` | API (fonction Edge Vercel, Postgres Neon) : établissements, équipes, rattachement des iPad, réplication vérifiée des chaînes, administration 2FA | Non, vérifie avec le noyau |
| `apps/caisse` | PWA iPad (`/`), note client (`/n`), administration (`/admin`), guide de test (`/guide`) | Non, consomme le noyau |

## Règles du noyau fiscal

- Montants en centimes entiers, TVA en points de base (1000 = 10 %).
- Une chaîne par caisse et par type (tickets, événements, clôtures) : numéro séquentiel sans trou, empreinte SHA-256 du contenu canonique, signature ECDSA P-256 par une clé propre à l'appareil.
- Aucune modification ni suppression : une erreur se corrige par un ticket d'annulation négatif lié à l'original.
- Chaque opération est écrite en un seul lot atomique (`StockageFiscal.ajouterLot`).
- Journée comptable basculant à 5 h, heure de Paris ; dates comptables monotones même si l'horloge recule.
- Toute modification de `packages/noyau-fiscal` impose d'incrémenter `VERSION_NOYAU_FISCAL`, de tagger `noyau-fiscal-v<version>` (GitHub refuse « @ » dans un nom de tag créé depuis le navigateur) et de mettre l'attestation à jour.

## Garde-fous à la charge de l'application caisse

- **Horloge** : une horloge qui avance (ex. iPad réglé en 2027) fige la date comptable dans le futur, puisque les dates ne reculent jamais. À chaque synchronisation, la caisse mesure l'écart avec l'heure du serveur et bloque l'encaissement au-delà de 5 minutes (dernier écart connu conservé hors ligne).
- **Persistance** : `navigator.storage.persist()`, écritures sérialisées entre onglets (Web Locks), réplication de chaque lot vers le serveur (après écriture, toutes les minutes, au retour du réseau). Le serveur revérifie continuité, empreinte, signature et totaux, et refuse toute divergence ; la caisse compare aussi la copie du serveur à la sienne. Une divergence est signalée à l'écran et dans l'administration sans bloquer l'encaissement : l'iPad détient l'original.
- **Révocation** : un iPad révoqué ne peut plus encaisser ni se synchroniser (les clôtures restent possibles).
- **Traçabilité** : journaliser connexions, suppressions de lignes sur une commande ouverte, impressions d'addition, ouvertures de tiroir, réimpressions, archivages et exports.

## Mise en route sur l'iPad

1. Dans l'administration (`/admin`, sur ordinateur) : créer le compte administrateur (mot de passe + application d'authentification), compléter l'identité légale de l'établissement, ajouter au moins un responsable, puis **Rattacher un iPad** pour obtenir un code à usage unique (48 h).
2. Sur l'iPad : ouvrir l'adresse dans Safari, Partager › Sur l'écran d'accueil, lancer la caisse depuis cette icône (sinon iPadOS peut purger les données), saisir le code. L'iPad crée sa clé de signature non exportable et reçoit établissement, équipe, tables et carte.
3. Imprimante Epson TM-m30III (facultative) : relever son adresse IP (page d'état), ouvrir `https://<adresse>` dans Safari et accepter le certificat, puis suivre l'assistant de connexion.

Les cartes se modifient dans l'administration (Cartes et prix) : catégories et rayons, articles, prix, TVA, disponibilité, variantes, suppléments, formules. Chaque enregistrement crée une nouvelle version (contrôle de version : deux personnes ne peuvent pas s'écraser), que les iPad téléchargent à la synchronisation suivante et gardent pour le hors ligne. La carte livrée avec le code ne sert qu'à amorcer la base.

Archives : l'iPad produit l'archive signée de chaque clôture (Clôtures › Télécharger l'archive). L'administration produit aussi, sans l'iPad, l'archive d'une clôture depuis la copie du serveur : même contenu, chaque enregistrement signé par l'iPad, empreinte de la clé de l'iPad à comparer avec celle affichée dans l'administration ; `verifierArchiveServeur` (packages/serveur) la contrôle seule.

Comptes clients (ardoises) : Encaisser › En compte porte tout ou partie d'une vente au compte d'un client (accord d'un responsable). La vente compte dans le chiffre du jour ; la TVA n'est exigible qu'au règlement (restauration sur place = prestation de services). Le règlement se fait depuis l'onglet Comptes, sur n'importe quel appareil connecté : ticket `REGLEMENT` sans vente, TVA répartie par tranches exactes de la vente. Les soldes sont recalculés par le serveur sur toutes les caisses.

L'équipe et l'identité de l'établissement sont communes à toutes ses caisses : elles se modifient dans l'administration ou dans les Réglages d'un iPad (connexion requise) et arrivent sur les autres iPad à la synchronisation suivante.

L'imprimante est facultative. Sans elle, rien ne s'imprime d'office : après chaque encaissement, la note s'affiche en QR code. Le client le scanne et ouvre sa note sur `/n`, la note entière étant contenue dans le lien (aucun stockage, aucune donnée personnelle). Les Z et les additions restent consultables à l'écran. Rappel : au-delà de 25 € TTC, la note de restaurant doit être remise imprimée.

La caisse s'adapte à l'iPhone en portrait : carte en plein écran, commande ouverte depuis le bandeau du bas.

## Commandes

```sh
pnpm install
pnpm test        # tous les tests
pnpm typecheck   # TypeScript strict
pnpm --filter @matalon/caisse build
(cd apps/caisse && node scripts/serveur-local.mjs 4180)   # caisse + API sur Postgres embarqué (PGlite)
URL=http://localhost:4180 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/parcours.mjs captures   # administration, rattachement, service, Z, synchro
# (serveur local relancé à vide entre chaque scénario)
URL=… node scripts/carte.mjs captures              # carte éditée dans l'administration, reçue par l'iPad
URL=… node scripts/journee-hors-ligne.mjs captures # journée entière hors ligne, copie serveur identique à l'iPad
URL=… node scripts/note-et-iphone.mjs captures     # note client et écrans iPhone
URL=… node scripts/comptes.mjs captures            # vente en compte hors ligne, règlement sur iPhone, annulation du règlement
URL=… node scripts/production.mjs captures         # bons bar et cuisine : Envoyer, annulation, envoi à l'encaissement (imprimantes simulées)
URL=… node scripts/plan.mjs captures               # plan de salle dessiné dans l'administration, tables assemblées, retouche sur l'iPad, conflit de version
URL=… node scripts/clotures-etablissement.mjs captures # iPad + iPhone : fond commun, lecture X et Z de l'établissement depuis l'iPhone, verrou, archive des deux caisses
pnpm --filter @matalon/caisse build:vercel   # sortie Vercel (Build Output API) : statique + fonction Edge cdg1
```

## Déploiement Vercel

Projet à la racine `apps/caisse`, commande de build `pnpm build:vercel`, préréglage « Other ». La base Neon (région Francfort) est reliée au projet par l'intégration Vercel, qui fournit `DATABASE_URL`. Le schéma se crée seul au premier appel de l'API. `VITE_MODE_TEST=1` sur le projet de test : bandeau et mention « sans valeur » sur chaque note.
