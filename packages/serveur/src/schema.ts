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
  // Plan de salle : zones dimensionnées et décor ; la version refuse d'écraser une modification faite ailleurs.
  `alter table etablissements add column if not exists zones jsonb not null default '[]'::jsonb`,
  `alter table etablissements add column if not exists plan_version integer not null default 0`,
  `create table if not exists utilisateurs (
    id text primary key,
    etablissement_id text not null references etablissements(id),
    nom text not null,
    role text not null check (role in ('serveur', 'responsable')),
    pin_hash text not null,
    actif boolean not null default true,
    maj_le text not null
  )`,
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
