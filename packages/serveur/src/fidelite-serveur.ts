import type { Catalogue } from "@matalon/catalogue";
import type { Ticket } from "@matalon/noyau-fiscal";
import { ErreurHttp, type Db } from "./db.js";
import {
  articleDeBase,
  CONSERVATION_MEMBRE_JOURS,
  DELAI_RESERVATION_MS,
  MOTIF_FIDELITE,
  normaliserTelephone,
  pointsDuTicket,
  problemeRegles,
  prochaineRecompense,
  recompensesTriees,
  reglesParDefaut,
  unite,
  type LienFidelite,
  type MembreFidelite,
  type MouvementFidelite,
  type NatureMouvement,
  type ProgrammeCaisse,
  type ProgrammeFidelite,
  type RecompenseFidelite,
  type ReglesFidelite,
  type ReponseMembreCaisse,
  type StatFidelite,
  type UtilisationFidelite,
} from "./fidelite.js";
import { EMAIL_VALIDE, momentDe, type EtablissementApi, type MomentJournee } from "./partage.js";
import { echapper, gabarit } from "./reservations-serveur.js";
import { aleatoire, hex } from "./securite.js";

/**
 * Carte de fidélité côté serveur (lot 7a) : programmes, membres, registre en ajout seul,
 * rapprochement des tickets reçus. Hors périmètre fiscal : rien ici ne touche aux
 * enregistrements scellés, et une erreur de fidélité ne bloque jamais une synchronisation.
 */

export interface ContexteFidelite {
  db: Db;
  maintenant: Date;
  /** Journée comptable du jour (bascule à 5 h). */
  aujourdhui: string;
  etablissement: (id: string) => Promise<EtablissementApi>;
  /** Envoi d'un e-mail au nom de l'établissement ; absent ou sans clé : rien ne part. */
  envoyer?: (etablissementId: string, c: { a: string; nomA?: string; sujet: string; html: string; texte: string }) => Promise<void>;
}

type Requete = { texte: string; params: unknown[] };

interface LigneProgramme {
  id: string;
  nom: string;
  actif: boolean;
  regles: ReglesFidelite;
  version: number;
  proprietaire: string;
  maj_le: string;
}

interface LigneMembre {
  id: string;
  programme_id: string;
  telephone: string;
  prenom: string;
  nom: string;
  email: string;
  offres: boolean;
  inscrit_le: string;
  derniere_visite: string | null;
  supprime_le: string | null;
}

interface LigneLien {
  caisse_id: string;
  numero: number;
  etablissement_id: string;
  programme_id: string;
  membre_id: string | null;
  telephone: string | null;
  utilisations: string[];
  credite: boolean;
  annule: boolean;
}

const identifiant = (prefixe: string) => `${prefixe}-${hex(aleatoire(6))}`;
const ID_MEMBRE = /^mbr-[0-9a-f]{12}$/;
const ID_UTILISATION = /^u-[0-9a-f]{12}$/;
const COLONNES_MEMBRE = "id, programme_id, telephone, prenom, nom, email, offres, inscrit_le, derniere_visite, supprime_le";

function json(statut: number, corps: unknown): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
async function corps(requete: Request): Promise<Record<string, unknown>> {
  const t = await requete.text();
  if (t.length > 500_000) throw new ErreurHttp(413, "TROP_VOLUMINEUX", "Requête trop volumineuse.");
  try {
    const v = JSON.parse(t || "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    throw new ErreurHttp(400, "JSON_INVALIDE", "Corps de requête illisible.");
  }
}
const texteCourt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ───────── Lecture ─────────

async function programmeDe(db: Db, etablissementId: string): Promise<LigneProgramme | null> {
  const [p] = await db.requete<LigneProgramme>(
    `select p.id, p.nom, p.actif, p.regles, p.version, p.proprietaire, p.maj_le
     from fidelite_programmes p join etablissements e on e.programme_fidelite = p.id where e.id = $1`,
    [etablissementId],
  );
  return p ?? null;
}

async function programmeParId(db: Db, id: string): Promise<LigneProgramme> {
  const [p] = await db.requete<LigneProgramme>("select id, nom, actif, regles, version, proprietaire, maj_le from fidelite_programmes where id = $1", [id]);
  if (!p) throw new ErreurHttp(404, "PROGRAMME_INCONNU", "Programme de fidélité inconnu.");
  return p;
}

const versCaisse = (p: LigneProgramme): ProgrammeCaisse => ({ id: p.id, nom: p.nom, actif: p.actif, regles: p.regles });

/** Programme de l'établissement tel que la caisse le reçoit (état de la caisse) ; null s'il n'y en a pas. */
export async function programmeCaisse(db: Db, etablissementId: string): Promise<ProgrammeCaisse | null> {
  const p = await programmeDe(db, etablissementId);
  return p ? versCaisse(p) : null;
}

async function soldes(db: Db, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const l = await db.requete<{ membre_id: string; solde: string | number }>(
    "select membre_id, coalesce(sum(points), 0) as solde from fidelite_mouvements where membre_id = any($1) group by membre_id",
    [ids],
  );
  return new Map(l.map((x) => [x.membre_id, Number(x.solde)]));
}

const versMembre = (l: LigneMembre, solde: number): MembreFidelite => ({
  id: l.id,
  telephone: l.supprime_le ? "" : l.telephone,
  prenom: l.prenom,
  nom: l.nom,
  email: l.email,
  offres: l.offres,
  inscritLe: l.inscrit_le,
  derniereVisite: l.derniere_visite,
  solde,
  ...(l.supprime_le ? { supprime: true } : {}),
});

async function membre(db: Db, programmeId: string, id: string): Promise<LigneMembre> {
  const [m] = await db.requete<LigneMembre>(`select ${COLONNES_MEMBRE} from fidelite_membres where id = $1 and programme_id = $2`, [id, programmeId]);
  if (!m) throw new ErreurHttp(404, "MEMBRE_INCONNU", "Membre inconnu.");
  return m;
}

async function membreParTelephone(db: Db, programmeId: string, telephone: string): Promise<LigneMembre | null> {
  const [m] = await db.requete<LigneMembre>(`select ${COLONNES_MEMBRE} from fidelite_membres where programme_id = $1 and telephone = $2 and supprime_le is null`, [programmeId, telephone]);
  return m ?? null;
}

async function membreAvecSolde(db: Db, m: LigneMembre): Promise<MembreFidelite> {
  return versMembre(m, (await soldes(db, [m.id])).get(m.id) ?? 0);
}

function mouvement(p: { programmeId: string; membreId: string; etablissementId: string; maintenant: string }, cle: string, nature: NatureMouvement, points: number, autre: { caisseId?: string; numero?: number; recompense?: unknown; motif?: string; auteur?: string } = {}): Requete {
  return {
    texte: `insert into fidelite_mouvements (cle, programme_id, membre_id, nature, points, etablissement_id, caisse_id, numero, recompense, motif, auteur, horodatage)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12) on conflict (cle) do nothing`,
    params: [cle, p.programmeId, p.membreId, nature, points, p.etablissementId, autre.caisseId ?? null, autre.numero ?? null, autre.recompense ? JSON.stringify(autre.recompense) : null, autre.motif ?? "", autre.auteur ?? "", p.maintenant],
  };
}

/** Mois écoulés entre deux dates ISO (au jour près). */
function moisEntre(a: string, b: string): number {
  const x = new Date(a);
  const y = new Date(b);
  return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth()) - (y.getUTCDate() < x.getUTCDate() ? 1 : 0);
}

/**
 * Entretien d'un membre à sa lecture : récompenses réservées jamais passées sur un
 * ticket rendues passé 48 h ; points perdus après la durée de validité sans visite.
 */
async function entretenir(ctx: ContexteFidelite, p: LigneProgramme, m: LigneMembre): Promise<void> {
  const maintenant = ctx.maintenant.toISOString();
  const base = { programmeId: p.id, membreId: m.id, etablissementId: p.proprietaire, maintenant };
  const perimees = await ctx.db.requete<{ cle: string; points: number; etablissement_id: string }>(
    `select u.cle, u.points, u.etablissement_id from fidelite_mouvements u
     where u.membre_id = $1 and u.nature = 'UTILISATION' and u.horodatage < $2
       and not exists (select 1 from fidelite_mouvements r where r.cle = 'rendu:' || substr(u.cle, 3))
       and not exists (select 1 from fidelite_liens l where l.utilisations ? substr(u.cle, 3))`,
    [m.id, new Date(ctx.maintenant.getTime() - DELAI_RESERVATION_MS).toISOString()],
  );
  const ecritures: Requete[] = perimees.map((u) =>
    mouvement({ ...base, etablissementId: u.etablissement_id }, `rendu:${u.cle.slice(2)}`, "RENDU", -u.points, { motif: "Réservée sans être utilisée", auteur: "serveur" }),
  );
  if (ecritures.length) await ctx.db.lot(ecritures);
  const mois = p.regles.moisValidite;
  const reference = m.derniere_visite ?? m.inscrit_le;
  if (mois && moisEntre(reference, maintenant) >= mois) {
    const solde = (await soldes(ctx.db, [m.id])).get(m.id) ?? 0;
    if (solde > 0) await ctx.db.lot([mouvement(base, `exp:${m.id}:${reference}`, "EXPIRATION", -solde, { motif: `${mois} mois sans visite`, auteur: "serveur" })]);
  }
}

// ───────── Rapprochement des tickets ─────────

const minuteParis = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", minute: "numeric", hourCycle: "h23" });
const minutesDe = (iso: string) => {
  const x = minuteParis.formatToParts(new Date(iso));
  return (Number(x.find((y) => y.type === "hour")?.value ?? 0) % 24) * 60 + Number(x.find((y) => y.type === "minute")?.value ?? 0);
};

/** Catégorie et moments de chaque établissement, lus une fois par rapprochement. */
async function contexteEtablissement(db: Db, etablissementId: string) {
  const [e] = await db.requete<{ carte_id: string; moments: MomentJournee[] | null }>("select carte_id, moments from etablissements where id = $1", [etablissementId]);
  const [carte] = e ? await db.requete<{ contenu: Catalogue }>("select contenu from cartes where id = $1", [e.carte_id]) : [];
  const categories = new Map<string, string>();
  for (const c of carte?.contenu.categories ?? []) for (const a of c.articles) categories.set(a.id, c.id);
  return { categorieDe: (articleId: string) => categories.get(articleDeBase(articleId)) ?? null, moments: e?.moments ?? [] };
}

/**
 * Rapproche les tickets reçus de leurs liens : gain des ventes (une fois par ticket),
 * puis, pour les ventes annulées, retrait du gain et reprise des récompenses utilisées.
 * Idempotent (clés uniques) : il peut se rejouer sans rien doubler.
 */
export async function rapprocherFidelite(ctx: ContexteFidelite, caisseId: string, numerosAnnules: number[] = []): Promise<void> {
  const db = ctx.db;
  const maintenant = ctx.maintenant.toISOString();
  const enAttente = await db.requete<LigneLien>("select * from fidelite_liens where caisse_id = $1 and not credite", [caisseId]);
  const tickets = enAttente.length
    ? new Map(
        (
          await db.requete<{ numero: number; contenu: Ticket }>("select numero, contenu from enregistrements where caisse_id = $1 and chaine = 'tickets' and numero = any($2)", [
            caisseId,
            enAttente.map((l) => l.numero),
          ])
        ).map((x) => [x.numero, x.contenu]),
      )
    : new Map<number, Ticket>();
  const programmes = new Map<string, LigneProgramme>();
  const etabs = new Map<string, Awaited<ReturnType<typeof contexteEtablissement>>>();
  for (const lien of enAttente) {
    const t = tickets.get(lien.numero);
    if (!t) continue; // le ticket arrivera à la prochaine synchronisation
    const p = programmes.get(lien.programme_id) ?? (await programmeParId(db, lien.programme_id).catch(() => null));
    if (!p) continue;
    programmes.set(p.id, p);
    let m: LigneMembre | null = null;
    if (lien.membre_id) m = (await db.requete<LigneMembre>(`select ${COLONNES_MEMBRE} from fidelite_membres where id = $1 and supprime_le is null`, [lien.membre_id]))[0] ?? null;
    else if (lien.telephone) m = await membreParTelephone(db, p.id, lien.telephone);
    const ecritures: Requete[] = [{ texte: "update fidelite_liens set credite = true, membre_id = $3 where caisse_id = $1 and numero = $2", params: [caisseId, lien.numero, m?.id ?? null] }];
    let points = 0;
    if (m && p.actif && t.type === "VENTE") {
      const e = etabs.get(lien.etablissement_id) ?? (await contexteEtablissement(db, lien.etablissement_id));
      etabs.set(lien.etablissement_id, e);
      points = pointsDuTicket(p.regles, t, e.categorieDe, momentDe(e.moments, minutesDe(t.horodatage))?.id ?? null);
      const base = { programmeId: p.id, membreId: m.id, etablissementId: lien.etablissement_id, maintenant };
      if (points > 0) ecritures.push(mouvement(base, `g:${caisseId}:${t.numero}`, "GAIN", points, { caisseId, numero: t.numero }));
      ecritures.push({
        texte: "update fidelite_membres set derniere_visite = $2 where id = $1 and (derniere_visite is null or derniere_visite < $2)",
        params: [m.id, t.horodatage],
      });
    }
    const avant = m && points > 0 ? ((await soldes(db, [m.id])).get(m.id) ?? 0) : 0;
    await db.lot(ecritures);
    if (m && points > 0) await signalerRecompense(ctx, p, m, lien.etablissement_id, avant, avant + points);
  }

  // Ventes annulées (annulation reçue maintenant, ou lien reçu après l'annulation).
  if (!numerosAnnules.length) return;
  const liens = await db.requete<LigneLien>("select * from fidelite_liens where caisse_id = $1 and numero = any($2) and credite and not annule", [caisseId, numerosAnnules]);
  for (const lien of liens) {
    const ecritures: Requete[] = [{ texte: "update fidelite_liens set annule = true where caisse_id = $1 and numero = $2", params: [caisseId, lien.numero] }];
    if (lien.membre_id) {
      const base = { programmeId: lien.programme_id, membreId: lien.membre_id, etablissementId: lien.etablissement_id, maintenant };
      const [gain] = await db.requete<{ points: number }>("select points from fidelite_mouvements where cle = $1", [`g:${caisseId}:${lien.numero}`]);
      if (gain) ecritures.push(mouvement(base, `a:${caisseId}:${lien.numero}`, "ANNULATION", -gain.points, { caisseId, numero: lien.numero, motif: "Vente annulée" }));
      for (const id of lien.utilisations) {
        const [u] = await db.requete<{ points: number; recompense: unknown }>("select points, recompense from fidelite_mouvements where cle = $1", [`u:${id}`]);
        if (u) ecritures.push(mouvement(base, `reprise:${id}`, "RENDU", -u.points, { caisseId, numero: lien.numero, recompense: u.recompense, motif: "Vente annulée : récompense rendue" }));
      }
    }
    await db.lot(ecritures);
  }
}

/** Annulations parmi des tickets reçus : numéros des ventes qu'elles annulent. */
export const ventesAnnulees = (tickets: Ticket[]) => tickets.filter((t) => t.type === "ANNULATION" && t.ticketOrigine).map((t) => t.ticketOrigine!.numero);

// ───────── E-mails ─────────

async function courriel(ctx: ContexteFidelite, etablissementId: string, m: LigneMembre, sujet: string, lignes: string[]): Promise<void> {
  if (!ctx.envoyer || !m.email) return;
  try {
    const etab = await ctx.etablissement(etablissementId);
    await ctx.envoyer(etablissementId, {
      a: m.email,
      nomA: `${m.prenom} ${m.nom}`.trim(),
      sujet,
      html: gabarit(etab, sujet, [...lignes.map(echapper), echapper("Vos données servent au seul fonctionnement du programme. Pour les corriger ou les effacer, répondez à cet e-mail ou demandez-le en caisse.")]),
      texte: [...lignes, "Vos données servent au seul fonctionnement du programme. Pour les corriger ou les effacer, répondez à cet e-mail ou demandez-le en caisse."].join("\n\n"),
    });
  } catch (e) {
    console.error("e-mail de fidélité", e);
  }
}

async function bienvenue(ctx: ContexteFidelite, p: LigneProgramme, m: LigneMembre, etablissementId: string, solde: number): Promise<void> {
  const enseigne = (await ctx.etablissement(etablissementId).catch(() => null))?.identite.enseigne ?? "";
  const suite = prochaineRecompense(p.regles, solde);
  await courriel(ctx, etablissementId, m, `Bienvenue au programme ${p.nom}`, [
    `Bonjour ${m.prenom},`,
    `Vous êtes inscrit au programme de fidélité ${p.nom}${enseigne ? ` de ${enseigne}` : ""}. Votre solde : ${unite(p.regles, solde)}.`,
    ...(suite ? [`Prochaine récompense : ${suite.recompense.libelle}, à ${unite(p.regles, suite.recompense.seuil)}.`] : []),
    "À chaque passage, donnez simplement votre numéro de téléphone en caisse.",
  ]);
}

/** Une récompense vient d'être atteinte : le membre est prévenu par e-mail. */
async function signalerRecompense(ctx: ContexteFidelite, p: LigneProgramme, m: LigneMembre, etablissementId: string, avant: number, apres: number): Promise<void> {
  const atteinte = recompensesTriees(p.regles).filter((r) => r.seuil > avant && r.seuil <= apres).at(-1);
  if (!atteinte) return;
  const enseigne = (await ctx.etablissement(etablissementId).catch(() => null))?.identite.enseigne ?? "";
  await courriel(ctx, etablissementId, m, `Une récompense vous attend${enseigne ? ` chez ${enseigne}` : ""}`, [
    `Bonjour ${m.prenom},`,
    `Avec votre dernier passage, vous avez ${unite(p.regles, apres)} : « ${atteinte.libelle} » vous attend.`,
    "Donnez votre numéro de téléphone à votre prochaine visite.",
  ]);
}

// ───────── Caisse ─────────

async function programmeActif(db: Db, etablissementId: string): Promise<LigneProgramme> {
  const p = await programmeDe(db, etablissementId);
  if (!p || !p.actif) throw new ErreurHttp(404, "PROGRAMME_INACTIF", "Pas de programme de fidélité actif dans cet établissement.");
  return p;
}

function telephoneValide(v: unknown): string {
  const t = normaliserTelephone(typeof v === "string" ? v : "");
  if (!t) throw new ErreurHttp(400, "TELEPHONE_INVALIDE", "Numéro de téléphone invalide.");
  return t;
}

function lienValide(x: unknown): LienFidelite | null {
  const l = x as LienFidelite;
  if (!l || typeof l.caisseId !== "string" || !Number.isSafeInteger(l.numero) || l.numero < 1) return null;
  const utilisations = Array.isArray(l.utilisations) ? l.utilisations.filter((u) => typeof u === "string" && ID_UTILISATION.test(u)).slice(0, 10) : [];
  const telephone = l.telephone ? normaliserTelephone(l.telephone) : null;
  if (l.membreId && ID_MEMBRE.test(l.membreId)) return { caisseId: l.caisseId, numero: l.numero, membreId: l.membreId, utilisations };
  return telephone ? { caisseId: l.caisseId, numero: l.numero, telephone, utilisations } : null;
}

async function inscrire(ctx: ContexteFidelite, p: LigneProgramme, etablissementId: string, c: Record<string, unknown>, auteur: string): Promise<{ membre: MembreFidelite; cree: boolean }> {
  const telephone = telephoneValide(c.telephone);
  const prenom = texteCourt(c.prenom, 40);
  if (!prenom) throw new ErreurHttp(400, "PRENOM_MANQUANT", "Le prénom est demandé.");
  const email = texteCourt(c.email, 254).toLowerCase();
  if (email && !EMAIL_VALIDE.test(email)) throw new ErreurHttp(400, "EMAIL_INVALIDE", "Adresse e-mail invalide.");
  const existant = await membreParTelephone(ctx.db, p.id, telephone);
  if (existant) return { membre: await membreAvecSolde(ctx.db, existant), cree: false };
  const maintenant = ctx.maintenant.toISOString();
  const m: LigneMembre = {
    id: identifiant("mbr"),
    programme_id: p.id,
    telephone,
    prenom,
    nom: texteCourt(c.nom, 60),
    email,
    offres: c.offres === true,
    inscrit_le: maintenant,
    derniere_visite: null,
    supprime_le: null,
  };
  const ecritures: Requete[] = [
    {
      texte: `insert into fidelite_membres (id, programme_id, telephone, prenom, nom, email, offres, inscrit_le, inscrit_etablissement, maj_le)
              values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8)`,
      params: [m.id, p.id, m.telephone, m.prenom, m.nom, m.email, m.offres, maintenant, etablissementId],
    },
  ];
  if (p.regles.bienvenue > 0) ecritures.push(mouvement({ programmeId: p.id, membreId: m.id, etablissementId, maintenant }, `b:${m.id}`, "BIENVENUE", p.regles.bienvenue, { auteur }));
  await ctx.db.lot(ecritures);
  await bienvenue(ctx, p, m, etablissementId, p.regles.bienvenue);
  return { membre: versMembre(m, p.regles.bienvenue), cree: true };
}

/**
 * Routes de la caisse (jeton d'appareil) : recherche par téléphone, inscription,
 * réservation et reprise d'une récompense, liens des tickets, rattachement d'un ticket du jour.
 */
export async function routeFideliteCaisse(ctx: ContexteFidelite, caisse: { id: string; etablissement_id: string }, requete: Request, chemin: string): Promise<Response | null> {
  const m = requete.method;
  const db = ctx.db;
  const etab = caisse.etablissement_id;
  if (chemin === "/api/caisse/fidelite" && m === "GET") {
    const p = await programmeActif(db, etab);
    const tel = new URL(requete.url).searchParams.get("telephone");
    if (!tel) return json(200, { programme: versCaisse(p), membre: null } satisfies ReponseMembreCaisse);
    const x = await membreParTelephone(db, p.id, telephoneValide(tel));
    if (x) await entretenir(ctx, p, x);
    return json(200, { programme: versCaisse(p), membre: x ? await membreAvecSolde(db, x) : null } satisfies ReponseMembreCaisse);
  }
  if (chemin === "/api/caisse/fidelite/membres" && m === "POST") {
    const p = await programmeActif(db, etab);
    const c = await corps(requete);
    const r = await inscrire(ctx, p, etab, c, texteCourt(c.utilisateurId, 40) || caisse.id);
    return json(r.cree ? 201 : 200, r);
  }
  if (chemin === "/api/caisse/fidelite/utilisations" && m === "POST") {
    const p = await programmeActif(db, etab);
    const c = await corps(requete);
    const x = await membre(db, p.id, texteCourt(c.membreId, 20));
    if (x.supprime_le) throw new ErreurHttp(404, "MEMBRE_INCONNU", "Membre inconnu.");
    const r = p.regles.recompenses.find((y) => y.id === c.recompenseId);
    if (!r) throw new ErreurHttp(404, "RECOMPENSE_INCONNUE", "Cette récompense n'existe plus : rechargez le programme.");
    await entretenir(ctx, p, x);
    const solde = (await soldes(db, [x.id])).get(x.id) ?? 0;
    if (solde < r.seuil) throw new ErreurHttp(409, "SOLDE_INSUFFISANT", `Solde insuffisant : ${unite(p.regles, solde)} pour ${unite(p.regles, r.seuil)}.`);
    const id = identifiant("u");
    const recompense: RecompenseFidelite = { ...r };
    await db.lot([
      mouvement({ programmeId: p.id, membreId: x.id, etablissementId: etab, maintenant: ctx.maintenant.toISOString() }, `u:${id}`, "UTILISATION", -r.seuil, {
        recompense,
        auteur: texteCourt(c.utilisateurId, 40) || caisse.id,
        caisseId: caisse.id,
      }),
    ]);
    const utilisation: UtilisationFidelite = { id, recompenseId: r.id, libelle: r.libelle, points: r.seuil };
    return json(201, { utilisation, recompense, solde: solde - r.seuil });
  }
  const pr = /^\/api\/caisse\/fidelite\/utilisations\/(u-[0-9a-f]{12})\/rendre$/.exec(chemin);
  if (pr && m === "POST") {
    const id = pr[1]!;
    const [u] = await db.requete<{ membre_id: string; programme_id: string; points: number; etablissement_id: string }>(
      "select membre_id, programme_id, points, etablissement_id from fidelite_mouvements where cle = $1",
      [`u:${id}`],
    );
    if (!u || u.etablissement_id !== etab) throw new ErreurHttp(404, "UTILISATION_INCONNUE", "Récompense inconnue.");
    const [lie] = await db.requete("select 1 from fidelite_liens where utilisations ? $1", [id]);
    if (lie) throw new ErreurHttp(409, "DEJA_UTILISEE", "Cette récompense est déjà sur un ticket.");
    await db.lot([
      mouvement({ programmeId: u.programme_id, membreId: u.membre_id, etablissementId: etab, maintenant: ctx.maintenant.toISOString() }, `rendu:${id}`, "RENDU", -u.points, {
        motif: "Retirée de la commande",
        auteur: caisse.id,
      }),
    ]);
    return json(200, { solde: (await soldes(db, [u.membre_id])).get(u.membre_id) ?? 0 });
  }
  if (chemin === "/api/caisse/fidelite/liens" && m === "POST") {
    const c = await corps(requete);
    const brut = Array.isArray(c.liens) ? c.liens : [];
    if (brut.length > 200) throw new ErreurHttp(400, "LOT_INVALIDE", "200 liens au plus par envoi.");
    const liens = brut.map(lienValide).filter((l): l is LienFidelite => !!l && l.caisseId === caisse.id);
    const p = await programmeDe(db, etab);
    if (p && liens.length) {
      await db.lot(
        liens.map((l) => ({
          texte: `insert into fidelite_liens (caisse_id, numero, etablissement_id, programme_id, membre_id, telephone, utilisations, cree_le)
                  values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) on conflict (caisse_id, numero) do nothing`,
          params: [l.caisseId, l.numero, etab, p.id, l.membreId ?? null, l.telephone ?? null, JSON.stringify(l.utilisations), ctx.maintenant.toISOString()],
        })),
      );
      await rapprocherFidelite(ctx, caisse.id, await numerosAnnulesParmi(db, caisse.id, liens.map((l) => l.numero)));
    }
    return json(200, { acceptes: p ? liens.length : 0 });
  }
  if (chemin === "/api/caisse/fidelite/rattachement" && m === "POST") {
    const p = await programmeActif(db, etab);
    const c = await corps(requete);
    const caisseId = texteCourt(c.caisseId, 40);
    const numero = Number(c.numero);
    const [t] = await db.requete<{ contenu: Ticket }>(
      `select e.contenu from enregistrements e join caisses k on k.id = e.caisse_id
       where e.caisse_id = $1 and e.chaine = 'tickets' and e.numero = $2 and k.etablissement_id = $3`,
      [caisseId, Number.isSafeInteger(numero) ? numero : -1, etab],
    );
    if (!t) throw new ErreurHttp(404, "TICKET_INCONNU", "Ticket pas encore reçu par le serveur : réessayez après la synchronisation.");
    if (t.contenu.type !== "VENTE") throw new ErreurHttp(400, "TICKET_NON_VENTE", "Seule une vente se rattache à une carte.");
    if (t.contenu.dateComptable !== ctx.aujourdhui) throw new ErreurHttp(400, "TICKET_ANCIEN", "Seul un ticket du jour se rattache à une carte.");
    const [deja] = await db.requete("select 1 from fidelite_liens where caisse_id = $1 and numero = $2", [caisseId, numero]);
    if (deja) throw new ErreurHttp(409, "DEJA_RATTACHE", "Ce ticket est déjà rattaché à une carte.");
    const x = await membreParTelephone(db, p.id, telephoneValide(c.telephone));
    if (!x) throw new ErreurHttp(404, "MEMBRE_INCONNU", "Aucun membre avec ce numéro : inscrivez-le d'abord.");
    await db.lot([
      {
        texte: `insert into fidelite_liens (caisse_id, numero, etablissement_id, programme_id, membre_id, utilisations, cree_le) values ($1, $2, $3, $4, $5, '[]'::jsonb, $6)
                on conflict (caisse_id, numero) do nothing`,
        params: [caisseId, numero, etab, p.id, x.id, ctx.maintenant.toISOString()],
      },
    ]);
    await rapprocherFidelite(ctx, caisseId, await numerosAnnulesParmi(db, caisseId, [numero]));
    const [g] = await db.requete<{ points: number }>("select points from fidelite_mouvements where cle = $1", [`g:${caisseId}:${numero}`]);
    return json(200, { membre: await membreAvecSolde(db, x), points: g?.points ?? 0 });
  }
  return null;
}

async function numerosAnnulesParmi(db: Db, caisseId: string, numeros: number[]): Promise<number[]> {
  if (!numeros.length) return [];
  const l = await db.requete<{ numero: number }>(
    `select (contenu->'ticketOrigine'->>'numero')::int as numero from enregistrements
     where caisse_id = $1 and chaine = 'tickets' and contenu->>'type' = 'ANNULATION' and (contenu->'ticketOrigine'->>'numero')::int = any($2)`,
    [caisseId, numeros],
  );
  return l.map((x) => x.numero);
}

// ───────── Administration ─────────

async function versAdmin(db: Db, p: LigneProgramme): Promise<ProgrammeFidelite> {
  const etablissements = await db.requete<{ id: string; enseigne: string }>("select id, enseigne from etablissements where programme_fidelite = $1 order by enseigne", [p.id]);
  const [n] = await db.requete<{ n: string | number }>("select count(*) as n from fidelite_membres where programme_id = $1 and supprime_le is null", [p.id]);
  return { ...versCaisse(p), version: p.version, proprietaire: p.proprietaire, etablissements, majLe: p.maj_le, membres: Number(n?.n ?? 0) };
}

function reglesValides(v: unknown): ReglesFidelite {
  const r = v as ReglesFidelite;
  if (!r || typeof r !== "object") throw new ErreurHttp(400, "REGLES_INVALIDES", "Règles manquantes.");
  const propres: ReglesFidelite = {
    mode: r.mode,
    pointsParEuro: r.pointsParEuro,
    tampon: r.tampon?.par === "ARTICLE" ? { par: "ARTICLE", categories: (r.tampon.categories ?? []).filter((x) => typeof x === "string").slice(0, 50) } : { par: "VISITE", montantMin: r.tampon?.par === "VISITE" ? r.tampon.montantMin : 0 },
    recompenses: (Array.isArray(r.recompenses) ? r.recompenses : []).map((x) => ({
      id: String(x.id ?? "").slice(0, 40),
      libelle: String(x.libelle ?? "").trim(),
      seuil: x.seuil,
      type: x.type,
      ...(x.type === "ARTICLE" ? { articles: (x.articles ?? []).filter((a) => typeof a === "string").slice(0, 50) } : {}),
      ...(x.type === "REMISE_EUROS" ? { montant: x.montant } : {}),
      ...(x.type === "REMISE_POURCENT" ? { pourcentage: x.pourcentage } : {}),
    })),
    bienvenue: r.bienvenue,
    momentsDoubles: (Array.isArray(r.momentsDoubles) ? r.momentsDoubles : []).filter((x) => typeof x === "string").slice(0, 8),
    categoriesExclues: (Array.isArray(r.categoriesExclues) ? r.categoriesExclues : []).filter((x) => typeof x === "string").slice(0, 50),
    plafondParTicket: r.plafondParTicket ?? null,
    moisValidite: r.moisValidite ?? null,
    uneRecompenseParTicket: r.uneRecompenseParTicket !== false,
  };
  const probleme = problemeRegles(propres);
  if (probleme) throw new ErreurHttp(400, "REGLES_INVALIDES", probleme);
  return propres;
}

/** Coordonnées effacées des membres sans activité depuis trois ans (le registre reste, sans nom). */
async function anonymiserInactifs(ctx: ContexteFidelite, programmeId: string): Promise<void> {
  const limite = new Date(ctx.maintenant.getTime() - CONSERVATION_MEMBRE_JOURS * 86_400_000).toISOString();
  await ctx.db.requete(
    `update fidelite_membres set prenom = 'Membre effacé', nom = '', email = '', offres = false, telephone = 'efface-' || id, supprime_le = $2, maj_le = $2
     where programme_id = $1 and supprime_le is null and coalesce(derniere_visite, inscrit_le) < $3`,
    [programmeId, ctx.maintenant.toISOString(), limite],
  );
}

export interface ActionAdmin {
  action: string;
  details: Record<string, unknown>;
}

/**
 * Routes de l'administration : programme de l'établissement (créer, rejoindre, quitter),
 * règles, membres (recherche, fiche, historique, ajustement, effacement).
 * Rend la réponse et l'action à journaliser.
 */
export async function routeFideliteAdmin(ctx: ContexteFidelite, requete: Request, admin: { id: string }, chemin: string): Promise<{ reponse: Response; journal?: ActionAdmin } | null> {
  const m = requete.method;
  const db = ctx.db;
  const maintenant = ctx.maintenant.toISOString();
  let p = /^\/api\/admin\/etablissements\/([a-z0-9-]+)\/fidelite$/.exec(chemin);
  if (p) {
    const etab = await ctx.etablissement(p[1]!);
    if (m === "GET") {
      const actuel = await programmeDe(db, etab.id);
      const autres = await db.requete<{ id: string; nom: string; enseigne: string }>(
        `select p.id, p.nom, e.enseigne from fidelite_programmes p join etablissements e on e.id = p.proprietaire where p.id is distinct from $1 order by e.enseigne`,
        [actuel?.id ?? null],
      );
      return { reponse: json(200, { programme: actuel ? await versAdmin(db, actuel) : null, autres }) };
    }
    if (m === "POST") {
      const c = await corps(requete);
      const actuel = await programmeDe(db, etab.id);
      if (c.action === "creer") {
        if (actuel) throw new ErreurHttp(409, "DEJA_PROGRAMME", "L'établissement a déjà un programme.");
        const id = identifiant("prg");
        const nom = texteCourt(c.nom, 40) || `Club ${etab.identite.enseigne}`;
        await db.lot([
          {
            texte: `insert into fidelite_programmes (id, nom, actif, regles, version, proprietaire, cree_le, maj_le, maj_par) values ($1, $2, false, $3::jsonb, 1, $4, $5, $5, $6)`,
            params: [id, nom, JSON.stringify(reglesParDefaut()), etab.id, maintenant, admin.id],
          },
          { texte: "update etablissements set programme_fidelite = $2, maj_le = $3 where id = $1", params: [etab.id, id, maintenant] },
        ]);
        return { reponse: json(201, { programme: await versAdmin(db, await programmeParId(db, id)) }), journal: { action: "fidelite_programme_cree", details: { etablissement: etab.id, programme: id } } };
      }
      if (c.action === "rejoindre") {
        if (actuel) throw new ErreurHttp(409, "DEJA_PROGRAMME", "Quittez d'abord le programme actuel.");
        const cible = await programmeParId(db, texteCourt(c.programmeId, 40));
        await db.requete("update etablissements set programme_fidelite = $2, maj_le = $3 where id = $1", [etab.id, cible.id, maintenant]);
        return { reponse: json(200, { programme: await versAdmin(db, cible) }), journal: { action: "fidelite_programme_rejoint", details: { etablissement: etab.id, programme: cible.id } } };
      }
      if (c.action === "quitter") {
        if (!actuel) throw new ErreurHttp(409, "SANS_PROGRAMME", "L'établissement n'a pas de programme.");
        if (actuel.proprietaire === etab.id) {
          const [autre] = await db.requete("select 1 from etablissements where programme_fidelite = $1 and id <> $2", [actuel.id, etab.id]);
          if (autre) throw new ErreurHttp(409, "PROGRAMME_PARTAGE", "D'autres établissements utilisent ce programme : ils doivent le quitter d'abord.");
        }
        await db.requete("update etablissements set programme_fidelite = null, maj_le = $2 where id = $1", [etab.id, maintenant]);
        return { reponse: json(200, { programme: null }), journal: { action: "fidelite_programme_quitte", details: { etablissement: etab.id, programme: actuel.id } } };
      }
      throw new ErreurHttp(400, "ACTION_INCONNUE", "Action inconnue.");
    }
    return null;
  }
  p = /^\/api\/admin\/fidelite\/(prg-[0-9a-f]{12})$/.exec(chemin);
  if (p && m === "PUT") {
    const actuel = await programmeParId(db, p[1]!);
    const c = await corps(requete);
    if (c.version !== actuel.version) throw new ErreurHttp(409, "VERSION", "Le programme a été modifié ailleurs entre-temps : rechargez-le.");
    const nom = texteCourt(c.nom, 40);
    if (!nom) throw new ErreurHttp(400, "NOM_MANQUANT", "Donnez un nom au programme.");
    const regles = reglesValides(c.regles);
    await db.requete("update fidelite_programmes set nom = $2, actif = $3, regles = $4::jsonb, version = version + 1, maj_le = $5, maj_par = $6 where id = $1", [
      actuel.id,
      nom,
      c.actif === true,
      JSON.stringify(regles),
      maintenant,
      admin.id,
    ]);
    const apres = await programmeParId(db, actuel.id);
    return {
      reponse: json(200, { programme: await versAdmin(db, apres) }),
      journal: { action: "fidelite_regles", details: { programme: apres.id, version: apres.version, actif: apres.actif, mode: regles.mode, recompenses: regles.recompenses.map((r) => `${r.libelle} (${r.seuil})`).join(", ") } },
    };
  }
  p = /^\/api\/admin\/fidelite\/(prg-[0-9a-f]{12})\/membres$/.exec(chemin);
  if (p && m === "GET") {
    const prog = await programmeParId(db, p[1]!);
    await anonymiserInactifs(ctx, prog.id);
    const q = (new URL(requete.url).searchParams.get("q") ?? "").trim().toLowerCase();
    const tel = q ? normaliserTelephone(q) : null;
    // Recherche par nom ou e-mail, ou par chiffres du téléphone (« 06 12 » trouve +33612…).
    const chiffres = tel ?? q.replace(/\D/g, "").replace(/^0/, "");
    const lignes = await db.requete<LigneMembre>(
      `select ${COLONNES_MEMBRE} from fidelite_membres where programme_id = $1 and supprime_le is null
         and ($2 = '' or lower(prenom || ' ' || nom || ' ' || email) like '%' || $2 || '%' or ($3 <> '' and telephone like '%' || $3 || '%'))
       order by coalesce(derniere_visite, inscrit_le) desc limit 300`,
      [prog.id, q, chiffres],
    );
    const s = await soldes(db, lignes.map((l) => l.id));
    return { reponse: json(200, { membres: lignes.map((l) => versMembre(l, s.get(l.id) ?? 0)) }) };
  }
  p = /^\/api\/admin\/fidelite\/(prg-[0-9a-f]{12})\/membres\/(mbr-[0-9a-f]{12})(\/ajustement|\/effacement)?$/.exec(chemin);
  if (p) {
    const prog = await programmeParId(db, p[1]!);
    const x = await membre(db, prog.id, p[2]!);
    if (!p[3] && m === "GET") {
      const mouvements = await db.requete<{ nature: NatureMouvement; points: number; horodatage: string; etablissement_id: string; caisse_id: string | null; numero: number | null; motif: string; auteur: string; recompense: RecompenseFidelite | null }>(
        "select nature, points, horodatage, etablissement_id, caisse_id, numero, motif, auteur, recompense from fidelite_mouvements where membre_id = $1 order by id desc limit 500",
        [x.id],
      );
      const liste: MouvementFidelite[] = mouvements.map((l) => ({
        nature: l.nature,
        points: l.points,
        horodatage: l.horodatage,
        etablissementId: l.etablissement_id,
        ticket: l.caisse_id && l.numero ? { caisseId: l.caisse_id, numero: l.numero } : null,
        motif: l.recompense?.libelle ? `${l.recompense.libelle}${l.motif ? ` · ${l.motif}` : ""}` : l.motif,
        auteur: l.auteur,
      }));
      return { reponse: json(200, { membre: await membreAvecSolde(db, x), mouvements: liste }) };
    }
    if (x.supprime_le) throw new ErreurHttp(409, "MEMBRE_EFFACE", "Ce membre a été effacé.");
    if (!p[3] && m === "PUT") {
      const c = await corps(requete);
      const telephone = telephoneValide(c.telephone);
      const prenom = texteCourt(c.prenom, 40);
      if (!prenom) throw new ErreurHttp(400, "PRENOM_MANQUANT", "Le prénom est demandé.");
      const email = texteCourt(c.email, 254).toLowerCase();
      if (email && !EMAIL_VALIDE.test(email)) throw new ErreurHttp(400, "EMAIL_INVALIDE", "Adresse e-mail invalide.");
      const autre = await membreParTelephone(db, prog.id, telephone);
      if (autre && autre.id !== x.id) throw new ErreurHttp(409, "TELEPHONE_PRIS", "Un autre membre a déjà ce numéro.");
      await db.requete("update fidelite_membres set telephone = $2, prenom = $3, nom = $4, email = $5, offres = $6, maj_le = $7 where id = $1", [
        x.id,
        telephone,
        prenom,
        texteCourt(c.nom, 60),
        email,
        c.offres === true,
        maintenant,
      ]);
      return { reponse: json(200, { membre: await membreAvecSolde(db, await membre(db, prog.id, x.id)) }), journal: { action: "fidelite_membre_modifie", details: { programme: prog.id, membre: x.id } } };
    }
    if (p[3] === "/ajustement" && m === "POST") {
      const c = await corps(requete);
      const points = Number(c.points);
      const motif = texteCourt(c.motif, 120);
      if (!Number.isSafeInteger(points) || points === 0 || Math.abs(points) > 100_000) throw new ErreurHttp(400, "POINTS_INVALIDES", "Indiquez un nombre entier de points, positif ou négatif.");
      if (motif.length < 3) throw new ErreurHttp(400, "MOTIF_OBLIGATOIRE", "Un ajustement demande un motif.");
      const solde = (await soldes(db, [x.id])).get(x.id) ?? 0;
      if (solde + points < 0) throw new ErreurHttp(400, "SOLDE_NEGATIF", `Le solde ne peut pas devenir négatif (solde actuel : ${solde}).`);
      await db.lot([mouvement({ programmeId: prog.id, membreId: x.id, etablissementId: prog.proprietaire, maintenant }, `adj:${hex(aleatoire(8))}`, "AJUSTEMENT", points, { motif, auteur: admin.id })]);
      return { reponse: json(200, { membre: await membreAvecSolde(db, x) }), journal: { action: "fidelite_ajustement", details: { programme: prog.id, membre: x.id, points, motif } } };
    }
    if (p[3] === "/effacement" && m === "POST") {
      await db.lot([
        {
          texte: `update fidelite_membres set prenom = 'Membre effacé', nom = '', email = '', offres = false, telephone = 'efface-' || id, supprime_le = $2, maj_le = $2 where id = $1`,
          params: [x.id, maintenant],
        },
        { texte: "update fidelite_liens set telephone = null where membre_id = $1", params: [x.id] },
      ]);
      return { reponse: json(200, { ok: true }), journal: { action: "fidelite_membre_efface", details: { programme: prog.id, membre: x.id } } };
    }
  }
  return null;
}

// ───────── Statistiques ─────────

/** Carte « Fidélité » des statistiques : membres, venues, part du CA, récompenses données. */
export async function statistiquesFidelite(db: Db, etablissementId: string, du: string, au: string, tickets: Ticket[]): Promise<StatFidelite | null> {
  const p = await programmeDe(db, etablissementId);
  if (!p) return null;
  const [n] = await db.requete<{ n: string | number; inscrits: string | number }>(
    `select count(*) filter (where supprime_le is null) as n,
            count(*) filter (where inscrit_etablissement = $2 and substr(inscrit_le, 1, 10) between $3 and $4) as inscrits
     from fidelite_membres where programme_id = $1`,
    [p.id, etablissementId, du, au],
  );
  const periode = tickets.filter((t) => t.dateComptable >= du && t.dateComptable <= au);
  const annulees = new Set(periode.filter((t) => t.type === "ANNULATION" && t.ticketOrigine).map((t) => `${t.caisseId}#${t.ticketOrigine!.numero}`));
  const conservees = periode.filter((t) => t.type === "VENTE" && !annulees.has(`${t.caisseId}#${t.numero}`));
  const liens = conservees.length
    ? await db.requete<{ caisse_id: string; numero: number; membre_id: string }>(
        "select caisse_id, numero, membre_id from fidelite_liens where etablissement_id = $1 and credite and membre_id is not null and caisse_id = any($2)",
        [etablissementId, [...new Set(conservees.map((t) => t.caisseId))]],
      )
    : [];
  const membreDe = new Map(liens.map((l) => [`${l.caisse_id}#${l.numero}`, l.membre_id]));
  const rattaches = conservees.filter((t) => membreDe.has(`${t.caisseId}#${t.numero}`));
  const remises = conservees.flatMap((t) => t.lignes.filter((l) => l.motifRemise === MOTIF_FIDELITE));
  const [g] = await db.requete<{ points: string | number | null }>(
    `select sum(m.points) as points from fidelite_mouvements m where m.etablissement_id = $1 and m.nature in ('GAIN', 'ANNULATION')
       and exists (select 1 from enregistrements e where e.caisse_id = m.caisse_id and e.chaine = 'tickets' and e.numero = m.numero and e.contenu->>'dateComptable' between $2 and $3)`,
    [etablissementId, du, au],
  );
  return {
    membres: Number(n?.n ?? 0),
    inscriptions: Number(n?.inscrits ?? 0),
    membresVenus: new Set(rattaches.map((t) => membreDe.get(`${t.caisseId}#${t.numero}`))).size,
    tickets: rattaches.length,
    ttc: rattaches.reduce((s, t) => s + t.totalTTC, 0),
    recompenses: new Set(conservees.filter((t) => t.lignes.some((l) => l.motifRemise === MOTIF_FIDELITE)).map((t) => `${t.caisseId}#${t.numero}`)).size,
    valeurRecompenses: remises.reduce((s, l) => s + l.remiseTTC, 0),
    points: Number(g?.points ?? 0),
  };
}
