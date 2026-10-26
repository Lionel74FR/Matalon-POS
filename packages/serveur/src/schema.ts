import { CARTES } from "@matalon/catalogue";
import type { Db } from "./db.js";

/**
 * Schéma de la base. Chaque instruction est idempotente : elles sont
 * rejouées à chaque démarrage à froid, sans effet si tout existe déjà.
 * Les horodatages sont stockés en texte ISO 8601 (UTC), fixés par l'API.
 */
export const MIGRATIONS: string[] = [
  `create table if not exists etablissements (
    id text primary key,
    enseigne text not null,
    raison_sociale text not null default '',
    adresse text not null default '',
    code_postal_ville text not null default '',
    telephone text not null default '',
    siret text not null default '',
    tva_intracom text not null default '',
    carte_id text not null,
    tables jsonb not null default '[]'::jsonb,
    seuil_note integer not null default 2500,
    cree_le text not null,
    maj_le text not null
  )`,
  `alter table etablissements add column if not exists mentions_legales text not null default ''`,
  // Imprimantes de production : poste de la carte (« Bar », « Cuisine »…) → imprimante de l'établissement.
  `alter table etablissements add column if not exists postes_production jsonb not null default '{}'::jsonb`,
  // Note imprimée d'office au-delà du seuil (sinon proposée à chaque encaissement : papier ou QR code).
  `alter table etablissements add column if not exists note_auto boolean not null default true`,
  // Imprimante des tickets commune à l'établissement (un appareil peut en garder une à lui).
  `alter table etablissements add column if not exists imprimante_tickets jsonb`,
  // Plan de salle : zones dimensionnées et décor ; la version refuse d'écraser une modification faite ailleurs.
  `alter table etablissements add column if not exists zones jsonb not null default '[]'::jsonb`,
  `alter table etablissements add column if not exists plan_version integer not null default 0`,
  // Clôtures d'établissement (noyau 0.7.0) : un seul appareil clôture à la fois ; anomalie de chaînage signalée.
  `alter table etablissements add column if not exists verrou_cloture jsonb`,
  `alter table etablissements add column if not exists anomalie_cloture text`,
  // Moments de la journée (matin, midi, soir…) : regroupement du CA dans les statistiques, hors fiscal.
  `alter table etablissements add column if not exists moments jsonb not null default '[]'::jsonb`,
  `create table if not exists utilisateurs (
    id text primary key,
    etablissement_id text not null references etablissements(id),
    nom text not null,
    role text not null check (role in ('serveur', 'responsable')),
    pin_hash text not null,
    actif boolean not null default true,
    maj_le text not null
  )`,
  // Code PIN vérifié par le serveur (modification de l'équipe depuis une caisse) : 5 codes faux bloquent 5 minutes.
  `alter table utilisateurs add column if not exists echecs_pin integer not null default 0`,
  `alter table utilisateurs add column if not exists pin_bloque_jusqua text`,
  `create table if not exists caisses (
    id text primary key,
    etablissement_id text not null references etablissements(id),
    nom text not null,
    cle_id text not null unique,
    cle_publique jsonb not null,
    jeton_hash text not null unique,
    appareil text not null default '',
    rattachee_le text not null,
    derniere_synchro text,
    revoquee_le text,
    divergence text
  )`,
  `create table if not exists codes_rattachement (
    code text primary key,
    etablissement_id text not null references etablissements(id),
    nom_caisse text not null,
    cree_le text not null,
    expire_le text not null,
    utilise_le text,
    caisse_id text
  )`,
  `create table if not exists enregistrements (
    caisse_id text not null references caisses(id),
    chaine text not null check (chaine in ('tickets', 'evenements', 'clotures')),
    numero integer not null,
    hash text not null,
    hash_precedent text not null,
    horodatage text not null,
    contenu jsonb not null,
    recu_le text not null,
    primary key (caisse_id, chaine, numero)
  )`,
  // Journée de l'établissement (0.7.0) : fond, comptage et clôtures retrouvés sans parcourir tout le journal.
  `create index if not exists enregistrements_evenements_code on enregistrements ((contenu->>'code'), horodatage) where chaine = 'evenements'`,
  `create index if not exists enregistrements_clotures_periode on enregistrements ((contenu->>'periode'), horodatage) where chaine = 'clotures'`,
  // Statistiques : tickets d'une période retrouvés par journée comptable.
  `create index if not exists enregistrements_tickets_jour on enregistrements ((contenu->>'dateComptable')) where chaine = 'tickets'`,
  // Inaltérabilité côté serveur : aucune modification ni suppression possible.
  `create or replace function interdire_modification_fiscale() returns trigger as $$
    begin
      raise exception 'Les enregistrements fiscaux sont en ajout seul';
    end;
  $$ language plpgsql`,
  `do $$ begin
    if not exists (select 1 from pg_trigger where tgname = 'enregistrements_ajout_seul') then
      create trigger enregistrements_ajout_seul before update or delete on enregistrements
      for each row execute function interdire_modification_fiscale();
    end if;
  end $$`,
  // Cartes des établissements, éditées dans l'administration. Chaque enregistrement incrémente la version.
  `create table if not exists cartes (
    id text primary key,
    nom text not null,
    contenu jsonb not null,
    version integer not null default 1,
    maj_le text not null,
    maj_par text
  )`,
  // Clients des comptes (ardoises). Créés par une caisse (même hors ligne : le ticket en compte porte le client) ou par l'administration.
  `create table if not exists clients (
    id text primary key,
    etablissement_id text not null references etablissements(id),
    nom text not null,
    telephone text not null default '',
    actif boolean not null default true,
    cree_le text not null,
    maj_le text not null
  )`,
  // Comptes clients : e-mail du client (factures, relances).
  `alter table clients add column if not exists email text not null default ''`,
  `create table if not exists admins (
    id text primary key,
    identifiant text not null unique,
    mot_de_passe text not null,
    totp_secret text not null,
    totp_actif boolean not null default false,
    echecs integer not null default 0,
    bloque_jusqua text,
    cree_le text not null
  )`,
  `create table if not exists sessions_admin (
    jeton_hash text primary key,
    admin_id text not null references admins(id),
    expire_le text not null
  )`,
  `create table if not exists journal_admin (
    id bigserial primary key,
    horodatage text not null,
    admin_id text,
    action text not null,
    details jsonb not null default '{}'::jsonb
  )`,
  // Le journal d'administration (exports, empreintes d'archives, modifications de carte) est lui aussi en ajout seul.
  `create or replace function interdire_modification_journal() returns trigger as $$
    begin
      raise exception 'Le journal d''administration est en ajout seul';
    end;
  $$ language plpgsql`,
  `do $$ begin
    if not exists (select 1 from pg_trigger where tgname = 'journal_admin_ajout_seul') then
      create trigger journal_admin_ajout_seul before update or delete on journal_admin
      for each row execute function interdire_modification_journal();
    end if;
  end $$`,
  // Historique des cartes : le contrôle des prix accepte la version en vigueur au moment de la vente
  // et la précédente (un appareil hors ligne n'a pas encore reçu la nouvelle).
  `create table if not exists cartes_versions (
    carte_id text not null,
    version integer not null,
    contenu jsonb not null,
    publiee_le text not null,
    primary key (carte_id, version)
  )`,
  `create or replace function archiver_carte() returns trigger as $$
    begin
      insert into cartes_versions (carte_id, version, contenu, publiee_le) values (new.id, new.version, new.contenu, new.maj_le)
      on conflict do nothing;
      return new;
    end;
  $$ language plpgsql`,
  `do $$ begin
    if not exists (select 1 from pg_trigger where tgname = 'cartes_historique') then
      create trigger cartes_historique after insert or update on cartes for each row execute function archiver_carte();
    end if;
  end $$`,
  `insert into cartes_versions (carte_id, version, contenu, publiee_le) select id, version, contenu, maj_le from cartes on conflict do nothing`,
  // Alertes de l'établissement (prix différent de la carte, code PIN bloqué…), lues dans l'administration.
  `create table if not exists alertes (
    id bigserial primary key,
    etablissement_id text not null references etablissements(id),
    caisse_id text,
    type text not null,
    message text not null,
    details jsonb not null default '{}'::jsonb,
    cle text unique,
    cree_le text not null,
    vue_le text,
    vue_par text
  )`,
  `create index if not exists alertes_etablissement on alertes (etablissement_id, cree_le)`,
  // Stock et fiches techniques (lot 4) : référentiel commun au groupe (produits, articles fournisseurs,
  // recettes), enregistré d'un bloc et versionné ; prix d'achat par établissement, en ajout seul.
  `create table if not exists stock_referentiel (
    id text primary key,
    contenu jsonb not null,
    version integer not null default 1,
    maj_le text not null,
    maj_par text
  )`,
  `insert into stock_referentiel (id, contenu, version, maj_le)
   values ('groupe', '{"produits":[],"articles":[],"recettes":[]}'::jsonb, 1, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
   on conflict (id) do nothing`,
  `create table if not exists prix_achats (
    id bigserial primary key,
    article_id text not null,
    etablissement_id text not null references etablissements(id),
    prix_ht integer not null check (prix_ht >= 0),
    le text not null,
    source text not null check (source in ('saisie', 'import', 'reception')),
    par text
  )`,
  `create index if not exists prix_achats_article on prix_achats (article_id, etablissement_id, le)`,
  `create or replace function interdire_modification_prix() returns trigger as $$
    begin
      raise exception 'L''historique des prix d''achat est en ajout seul';
    end;
  $$ language plpgsql`,
  `do $$ begin
    if not exists (select 1 from pg_trigger where tgname = 'prix_achats_ajout_seul') then
      create trigger prix_achats_ajout_seul before update or delete on prix_achats
      for each row execute function interdire_modification_prix();
    end if;
  end $$`,
  // Prix fournis par l'agent de factures (4d) ; une ligne de facture ne s'enregistre qu'une fois.
  `alter table prix_achats add column if not exists cle text`,
  `create unique index if not exists prix_achats_cle on prix_achats (cle) where cle is not null`,
  `do $$ begin
    if exists (select 1 from pg_constraint where conname = 'prix_achats_source_check') then
      alter table prix_achats drop constraint prix_achats_source_check;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'prix_achats_source_v2') then
      alter table prix_achats add constraint prix_achats_source_v2 check (source in ('saisie', 'import', 'reception', 'facture'));
    end if;
  end $$`,
  // Mouvements de stock (4b à 4d) : quantités signées en unité de base, valeur au coût du moment, en ajout seul.
  `create table if not exists stock_mouvements (
    id bigserial primary key,
    etablissement_id text not null references etablissements(id),
    produit_id text not null,
    quantite bigint not null,
    valeur_micro bigint,
    type text not null check (type in ('vente', 'annulation', 'perte', 'reception', 'inventaire', 'transfert')),
    le text not null,
    date_comptable text not null,
    origine jsonb not null default '{}'::jsonb,
    cle text unique,
    par text,
    cree_le text not null
  )`,
  `create index if not exists stock_mouvements_produit on stock_mouvements (etablissement_id, produit_id)`,
  `create index if not exists stock_mouvements_jour on stock_mouvements (etablissement_id, date_comptable)`,
  `create or replace function interdire_modification_mouvements() returns trigger as $$
    begin
      raise exception 'Les mouvements de stock sont en ajout seul';
    end;
  $$ language plpgsql`,
  `do $$ begin
    if not exists (select 1 from pg_trigger where tgname = 'stock_mouvements_ajout_seul') then
      create trigger stock_mouvements_ajout_seul before update or delete on stock_mouvements
      for each row execute function interdire_modification_mouvements();
    end if;
  end $$`,
  // Pièces du stock : réceptions, inventaires, pertes, transferts. Une réception s'annule (mouvements inverses), jamais ne s'efface.
  `create table if not exists stock_documents (
    id text primary key,
    type text not null check (type in ('reception', 'inventaire', 'perte', 'transfert')),
    etablissement_id text not null references etablissements(id),
    contenu jsonb not null,
    le text not null,
    cree_le text not null,
    par text,
    annule_le text,
    annule_par text
  )`,
  `create index if not exists stock_documents_etablissement on stock_documents (etablissement_id, type, le)`,
  // Agent de factures : clés d'accès (empreinte seule) et lignes de facture à rapprocher d'un article fournisseur.
  `create table if not exists cles_api (
    id text primary key,
    nom text not null,
    empreinte text not null unique,
    cree_le text not null,
    utilisee_le text,
    revoquee_le text
  )`,
  `create table if not exists factures_lignes (
    id bigserial primary key,
    etablissement_id text not null references etablissements(id),
    fournisseur text not null,
    reference text not null default '',
    designation text not null,
    prix_ht integer not null,
    facture jsonb not null,
    cle text not null unique,
    article_id text,
    statut text not null check (statut in ('rapprochee', 'a_rapprocher', 'ignoree')),
    recu_le text not null,
    traite_le text,
    traite_par text
  )`,
  // Réservations de tables (hors fiscal) : réglages par établissement, réservations modifiables.
  `create table if not exists reservations_reglages (
    etablissement_id text primary key references etablissements(id),
    contenu jsonb not null,
    version integer not null,
    maj_le text not null,
    maj_par text
  )`,
  `create table if not exists reservations (
    id text primary key,
    seq bigserial,
    etablissement_id text not null references etablissements(id),
    date text not null,
    contenu jsonb not null,
    statut text not null check (statut in ('confirmee', 'arrivee', 'absente', 'annulee')),
    jeton_hash text unique,
    cree_le text not null,
    maj_le text not null
  )`,
  `create index if not exists reservations_jour on reservations (etablissement_id, date)`,
  // Secrets d'un établissement (clé Resend…), chiffrés avec la clé maîtresse de l'hébergement (CLE_SECRETS).
  `create table if not exists secrets_etablissement (
    etablissement_id text not null references etablissements(id),
    nom text not null,
    iv text not null,
    chiffre text not null,
    apercu text not null,
    maj_le text not null,
    maj_par text,
    primary key (etablissement_id, nom)
  )`,
  // Commandes en cours (tables), partagées entre les appareils d'un établissement. Données de
  // travail hors périmètre fiscal : elles ne deviennent un ticket qu'à l'encaissement, sur un appareil.
  // contenu null = table fermée ; version incrémentée à chaque écriture (écriture conditionnelle).
  `create table if not exists commandes_ouvertes (
    etablissement_id text not null references etablissements(id),
    table_id text not null,
    contenu jsonb,
    version bigint not null default 1,
    maj_le text not null,
    maj_par text,
    primary key (etablissement_id, table_id)
  )`,
  // Clés d'accès (passkeys) des administrateurs : clé publique seule, liée au domaine (rp_id) qui l'a créée.
  `create table if not exists cles_acces_admin (
    id text primary key,
    admin_id text not null references admins(id),
    nom text not null,
    alg integer not null,
    jwk jsonb not null,
    compteur bigint not null default 0,
    rp_id text not null,
    cree_le text not null,
    utilisee_le text
  )`,
  // Défis WebAuthn à usage unique (5 minutes) ; seule leur empreinte est gardée.
  `create table if not exists defis_admin (
    defi_hash text primary key,
    usage text not null,
    admin_id text,
    expire_le text not null
  )`,
  // Commandes fournisseurs (hors fiscal) : bon numéroté par établissement, modifiable en brouillon
  // (écriture conditionnelle par version), puis envoyé ; les quantités reçues se lisent dans les réceptions.
  `create table if not exists commandes_fournisseurs (
    id text primary key,
    etablissement_id text not null references etablissements(id),
    numero integer not null,
    fournisseur text not null,
    statut text not null check (statut in ('brouillon', 'envoyee', 'soldee', 'annulee')),
    contenu jsonb not null,
    version integer not null default 1,
    cree_le text not null,
    cree_par text not null,
    maj_le text not null,
    unique (etablissement_id, numero)
  )`,
  `create index if not exists commandes_fournisseurs_etablissement on commandes_fournisseurs (etablissement_id, cree_le)`,
  // Réglages d'envoi des commandes, par établissement (expéditeur, e-mail de l'établissement, livraison).
  `create table if not exists stock_reglages (
    etablissement_id text primary key references etablissements(id),
    contenu jsonb not null,
    maj_le text not null,
    maj_par text
  )`,
  // Carte de fidélité (lot 7a), hors fiscal. Un programme appartient à un établissement ; d'autres
  // établissements peuvent le rejoindre (mêmes règles, même solde). Règles modifiées par version.
  `create table if not exists fidelite_programmes (
    id text primary key,
    nom text not null,
    actif boolean not null default true,
    regles jsonb not null,
    version integer not null default 1,
    proprietaire text not null references etablissements(id),
    cree_le text not null,
    maj_le text not null,
    maj_par text
  )`,
  `alter table etablissements add column if not exists programme_fidelite text`,
  // Membres, reconnus par leur téléphone (forme +33…) ; coordonnées effacées à la demande ou après trois ans sans visite.
  `create table if not exists fidelite_membres (
    id text primary key,
    programme_id text not null references fidelite_programmes(id),
    telephone text not null,
    prenom text not null,
    nom text not null default '',
    email text not null default '',
    offres boolean not null default false,
    inscrit_le text not null,
    inscrit_etablissement text not null,
    derniere_visite text,
    supprime_le text,
    maj_le text not null,
    unique (programme_id, telephone)
  )`,
  // Registre de fidélité, en ajout seul : le solde d'un membre est la somme de ses mouvements.
  // La clé rend chaque mouvement unique (gain d'un ticket, réservation d'une récompense, sa reprise…).
  `create table if not exists fidelite_mouvements (
    id bigserial primary key,
    cle text not null unique,
    programme_id text not null references fidelite_programmes(id),
    membre_id text not null references fidelite_membres(id),
    nature text not null check (nature in ('BIENVENUE', 'GAIN', 'UTILISATION', 'RENDU', 'ANNULATION', 'AJUSTEMENT', 'EXPIRATION')),
    points integer not null,
    etablissement_id text not null,
    caisse_id text,
    numero integer,
    recompense jsonb,
    motif text not null default '',
    auteur text not null default '',
    horodatage text not null
  )`,
  `create index if not exists fidelite_mouvements_membre on fidelite_mouvements (membre_id)`,
  `create or replace function interdire_modification_fidelite() returns trigger as $$
    begin
      raise exception 'Le registre de fidélité est en ajout seul';
    end;
  $$ language plpgsql`,
  `do $$ begin
    if not exists (select 1 from pg_trigger where tgname = 'fidelite_mouvements_ajout_seul') then
      create trigger fidelite_mouvements_ajout_seul before update or delete on fidelite_mouvements
      for each row execute function interdire_modification_fidelite();
    end if;
  end $$`,
  // Ticket rattaché à un membre : à côté du ticket, jamais dans l'enregistrement scellé. Une fois par ticket.
  `create table if not exists fidelite_liens (
    caisse_id text not null,
    numero integer not null,
    etablissement_id text not null,
    programme_id text not null,
    membre_id text,
    telephone text,
    utilisations jsonb not null default '[]'::jsonb,
    credite boolean not null default false,
    annule boolean not null default false,
    cree_le text not null,
    primary key (caisse_id, numero)
  )`,
  `create index if not exists fidelite_liens_attente on fidelite_liens (caisse_id) where not credite`,
  // Logo de l'établissement (PNG, déposé dans l'administration) : module de réservation et e-mails.
  // L'image vit à part ; l'établissement n'en porte que la version (empreinte), qui fait varier son adresse.
  `alter table etablissements add column if not exists logo_version text`,
  `create table if not exists etablissements_logos (
    etablissement_id text primary key references etablissements(id),
    png text not null,
    version text not null,
    maj_le text not null,
    maj_par text
  )`,
  // Accès à l'administration (26 octobre 2026) : le propriétaire (mot de passe, code, clés) et des accès
  // « comptable », limités aux statistiques et aux clôtures des établissements choisis, ouverts par une
  // invitation à usage unique et une clé d'accès. Un accès révoqué reste en base (le journal le cite).
  `alter table admins add column if not exists role text not null default 'proprietaire'`,
  `alter table admins add column if not exists nom text not null default ''`,
  `alter table admins add column if not exists etablissements jsonb`,
  `alter table admins add column if not exists revoque_le text`,
  `alter table admins add column if not exists cree_par text`,
  `create table if not exists invitations_admin (
    jeton_hash text primary key,
    admin_id text not null references admins(id),
    cree_le text not null,
    cree_par text,
    expire_le text not null,
    utilisee_le text
  )`,
  // Premier établissement du groupe. Son identité légale se complète dans l'administration.
  `insert into etablissements (id, enseigne, adresse, code_postal_ville, telephone, carte_id, tables, cree_le, maj_le)
   select 'moka', 'Moka', '6 rue Vaugelas', '74000 Annecy', '04 56 19 02 68', 'carte-automne-2026',
     (select jsonb_agg(jsonb_build_object('id', 't' || n, 'nom', n::text, 'zone', 'Salle')) from generate_series(1, 12) n),
     to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   where not exists (select 1 from etablissements)`,
];

let enCours: Promise<void> | null = null;

/** Applique le schéma une fois par instance du serveur. */
export function migrer(db: Db): Promise<void> {
  enCours ??= (async () => {
    for (const instruction of MIGRATIONS) await db.requete(instruction);
    // Cartes livrées avec le logiciel : chargées une seule fois, ensuite seule l'administration les modifie.
    for (const carte of Object.values(CARTES)) {
      await db.requete(
        `insert into cartes (id, nom, contenu, version, maj_le) values ($1, $2, $3::jsonb, 1, $4) on conflict (id) do nothing`,
        [carte.id, carte.nom, JSON.stringify(carte), new Date().toISOString()],
      );
    }
  })().catch((e) => {
    enCours = null;
    throw e;
  });
  return enCours;
}

/** Réinitialise le cache de migration (tests). */
export function _oublierMigration(): void {
  enCours = null;
}
