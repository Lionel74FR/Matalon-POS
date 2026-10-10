/**
 * Réservations de tables, côté serveur : réglages par établissement, module
 * public du site (créneaux, réservation, annulation par lien), administration
 * et caisse (jour, statut, table). Hors périmètre fiscal.
 */
import {
  attribuerTable,
  conflitsTable,
  controler,
  creneauxDuJour,
  decalerJour,
  dureeDe,
  HEURE_VALIDE,
  JOUR_VALIDE,
  joursLibres,
  maintenantParis,
  MESSAGES_REFUS,
  REGLAGES_DEFAUT,
  serviceDe,
  validerCoordonnees,
  validerReglages,
  type Civilite,
  type ReglagesReservation,
  type Reservation,
  type SourceReservation,
  type StatutReservation,
} from "@matalon/reservations";
import { ErreurHttp, type Db } from "./db.js";
import type { ConfigPublique, EtablissementApi, ResumePublic } from "./partage.js";
import { aleatoire, base32, nouveauJeton, sha256 } from "./securite.js";

/** Message à envoyer par e-mail (service d'envoi branché par l'hébergement ; absent : rien n'est envoyé). */
export interface Courriel {
  a: string;
  nomA?: string;
  /** Adresse d'expédition réglée pour l'établissement ; absente : celle de l'hébergement, s'il y en a une. */
  de?: string;
  deNom: string;
  repondreA?: string;
  sujet: string;
  html: string;
  texte: string;
}
export type EnvoiCourriel = (c: Courriel) => Promise<void>;

export interface ContexteResa {
  db: Db;
  maintenant: Date;
  etablissement: (id: string) => Promise<EtablissementApi>;
  envoyer?: EnvoiCourriel;
  /** Origine publique (https://…) pour les liens des e-mails. */
  origine: string;
}

/** Données personnelles gardées un an après la date de la réservation, puis effacées (nom, téléphone, e-mail, commentaire). */
export const CONSERVATION_JOURS = 365;
/** Jours au plus demandés d'un coup au calendrier du module. */
const JOURS_MAX_CALENDRIER = 62;

// ───────── Lecture et écriture ─────────

interface LigneReglages {
  contenu: ReglagesReservation;
  version: number;
}

export async function lireReglages(db: Db, etablissementId: string): Promise<{ reglages: ReglagesReservation; version: number }> {
  const [l] = await db.requete<LigneReglages>("select contenu, version from reservations_reglages where etablissement_id = $1", [etablissementId]);
  return l ? { reglages: { ...REGLAGES_DEFAUT, ...l.contenu }, version: l.version } : { reglages: REGLAGES_DEFAUT, version: 0 };
}

async function reservationsDu(db: Db, etablissementId: string, du: string, au: string): Promise<Reservation[]> {
  const l = await db.requete<{ contenu: Reservation }>(
    "select contenu from reservations where etablissement_id = $1 and date between $2 and $3 order by date, contenu->>'heure', seq",
    [etablissementId, du, au],
  );
  return l.map((x) => x.contenu);
}

async function lireReservation(db: Db, etablissementId: string, id: string): Promise<Reservation> {
  const [l] = await db.requete<{ contenu: Reservation }>("select contenu from reservations where etablissement_id = $1 and id = $2", [etablissementId, id]);
  if (!l) throw new ErreurHttp(404, "RESERVATION_INCONNUE", "Réservation introuvable.");
  return l.contenu;
}

async function ecrire(db: Db, r: Reservation): Promise<void> {
  await db.requete("update reservations set contenu = $3::jsonb, statut = $4, date = $5, maj_le = $6 where etablissement_id = $1 and id = $2", [
    r.etablissementId,
    r.id,
    JSON.stringify(r),
    r.statut,
    r.date,
    r.majLe,
  ]);
}

/** Efface les coordonnées des réservations passées depuis plus d'un an (RGPD). */
async function purger(db: Db, maintenant: Date): Promise<void> {
  const limite = decalerJour(maintenantParis(maintenant).jour, -CONSERVATION_JOURS);
  await db.requete(
    `update reservations set contenu = (contenu - 'email' - 'commentaire' - 'civilite') || '{"prenom":"","nom":"(effacé)","telephone":""}'::jsonb, jeton_hash = null
     where date < $1 and contenu->>'telephone' <> ''`,
    [limite],
  );
}

// ───────── Création et modification ─────────

export interface SaisieReservation {
  date: string;
  heure: string;
  couverts: number;
  civilite?: Civilite;
  prenom: string;
  nom: string;
  telephone: string;
  email?: string;
  commentaire?: string;
  zone?: string;
  tables?: string[];
  offresEmail?: boolean;
  offresSms?: boolean;
}

const CIVILITES: Civilite[] = ["Mme", "M.", "Mx"];

function lireSaisie(corps: Record<string, unknown>, emailObligatoire: boolean): SaisieReservation {
  const date = String(corps.date ?? "");
  const heure = String(corps.heure ?? "");
  const couverts = Number(corps.couverts);
  if (!JOUR_VALIDE.test(date) || !HEURE_VALIDE.test(heure)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Date ou heure invalide.");
  if (!Number.isInteger(couverts) || couverts < 1 || couverts > 200) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Nombre de personnes invalide.");
  const civilite = CIVILITES.includes(corps.civilite as Civilite) ? (corps.civilite as Civilite) : undefined;
  const c = validerCoordonnees(
    {
      ...(civilite ? { civilite } : {}),
      prenom: String(corps.prenom ?? ""),
      nom: String(corps.nom ?? ""),
      telephone: String(corps.telephone ?? ""),
      email: String(corps.email ?? ""),
      commentaire: String(corps.commentaire ?? ""),
    },
    { emailObligatoire },
  );
  if ("erreurs" in c) throw new ErreurHttp(400, "COORDONNEES_INVALIDES", c.erreurs.join(" "));
  const tables = Array.isArray(corps.tables) ? corps.tables.map(String).slice(0, 8) : undefined;
  return {
    date,
    heure,
    couverts,
    ...c.ok,
    ...(typeof corps.zone === "string" && corps.zone ? { zone: corps.zone.slice(0, 60) } : {}),
    ...(tables ? { tables } : {}),
    ...(corps.offresEmail === true ? { offresEmail: true } : {}),
    ...(corps.offresSms === true ? { offresSms: true } : {}),
  };
}

function nouvelId(): string {
  return `r-${base32(aleatoire(8)).toLowerCase().slice(0, 12)}`;
}

/**
 * Crée une réservation contrôlée (capacités ; en ligne : délai, horizon, groupe)
 * et lui attribue une table. Deux demandes simultanées : chacune revérifie
 * après son écriture contre celles écrites avant elle, la seconde est retirée.
 */
export async function creerReservation(
  ctx: ContexteResa,
  etab: EtablissementApi,
  s: SaisieReservation,
  options: { source: SourceReservation; par: string; forcer?: boolean },
): Promise<{ reservation: Reservation; jeton: string; conflits: Reservation[] }> {
  const { reglages } = await lireReglages(ctx.db, etab.id);
  const enLigne = options.source === "en_ligne";
  if (enLigne && !reglages.actif) throw new ErreurHttp(403, "RESERVATION_FERMEE", "La réservation en ligne n'est pas ouverte.");
  const service = serviceDe(reglages, s.date, s.heure);
  const du = await reservationsDu(ctx.db, etab.id, s.date, s.date);
  const verifier = (liste: Reservation[]) => controler(reglages, liste, s, { maintenant: ctx.maintenant, enLigne });
  const refus = verifier(du);
  // L'équipe peut passer outre (« Enregistrer quand même ») ; le client en ligne jamais.
  if (refus && !(options.forcer && !enLigne)) throw new ErreurHttp(409, refus, MESSAGES_REFUS[refus]);
  if (enLigne && du.some((r) => r.telephone === s.telephone && (r.statut === "confirmee" || r.statut === "arrivee"))) {
    throw new ErreurHttp(409, "DEJA_RESERVE", "Vous avez déjà une réservation ce jour-là. Pour la modifier, utilisez le lien reçu par e-mail ou appelez-nous.");
  }
  const le = ctx.maintenant.toISOString();
  const base: Reservation = {
    id: nouvelId(),
    etablissementId: etab.id,
    date: s.date,
    heure: s.heure,
    couverts: s.couverts,
    dureeMinutes: dureeDe(reglages, service),
    serviceId: service?.id ?? "hors-service",
    ...(s.civilite ? { civilite: s.civilite } : {}),
    prenom: s.prenom,
    nom: s.nom,
    telephone: s.telephone,
    ...(s.email ? { email: s.email } : {}),
    ...(s.commentaire ? { commentaire: s.commentaire } : {}),
    statut: "confirmee",
    source: options.source,
    tables: [],
    ...(s.zone ? { zoneSouhaitee: s.zone } : {}),
    ...(s.offresEmail ? { offresEmail: true } : {}),
    ...(s.offresSms ? { offresSms: true } : {}),
    creeLe: le,
    majLe: le,
    historique: [{ le, par: options.par, action: refus ? `créée en dépassement (${MESSAGES_REFUS[refus]})` : "créée" }],
  };
  const tablesVisibles = etab.tables.filter((t) => !t.masquee);
  base.tables = s.tables?.length ? s.tables.filter((id) => tablesVisibles.some((t) => t.id === id)) : attribuerTable(tablesVisibles, du, base);
  const jeton = nouveauJeton();
  const [ecrite] = await ctx.db.requete<{ seq: string }>(
    `insert into reservations (id, etablissement_id, date, contenu, statut, jeton_hash, cree_le, maj_le)
     values ($1, $2, $3, $4::jsonb, 'confirmee', $5, $6, $6) returning seq`,
    [base.id, etab.id, base.date, JSON.stringify(base), await sha256(jeton), le],
  );
  // Course entre deux demandes : on revérifie contre les réservations écrites avant celle-ci.
  if (!refus) {
    const avant = (
      await ctx.db.requete<{ contenu: Reservation }>("select contenu from reservations where etablissement_id = $1 and date = $2 and seq < $3", [
        etab.id,
        base.date,
        ecrite!.seq,
      ])
    ).map((x) => x.contenu);
    const tard = verifier(avant);
    const tablePrise = base.tables.length > 0 && !s.tables?.length && conflitsTable(avant, base).length > 0;
    if (tard && !options.forcer) {
      await ctx.db.requete("delete from reservations where id = $1", [base.id]);
      throw new ErreurHttp(409, tard, MESSAGES_REFUS[tard]);
    }
    if (tablePrise) {
      base.tables = attribuerTable(tablesVisibles, avant, base);
      await ecrire(ctx.db, base);
    }
  }
  await purger(ctx.db, ctx.maintenant);
  if (base.email) await envoyerConfirmation(ctx, etab, reglages, base, jeton);
  if (enLigne && reglages.email) await prevenirEtablissement(ctx, etab, reglages, base, "Nouvelle réservation");
  return { reservation: base, jeton, conflits: conflitsTable(await reservationsDu(ctx.db, etab.id, base.date, base.date), base) };
}

const STATUTS: StatutReservation[] = ["confirmee", "arrivee", "absente", "annulee"];
const LIBELLES_STATUT: Record<StatutReservation, string> = { confirmee: "confirmée", arrivee: "arrivée", absente: "absente", annulee: "annulée" };

/** Modification par l'équipe : statut, table(s), heure, date, couverts, coordonnées, note. */
export async function modifierReservation(
  ctx: ContexteResa,
  etab: EtablissementApi,
  id: string,
  corps: Record<string, unknown>,
  par: string,
): Promise<{ reservation: Reservation; conflits: Reservation[] }> {
  const { reglages } = await lireReglages(ctx.db, etab.id);
  const r = await lireReservation(ctx.db, etab.id, id);
  const avant = structuredClone(r);
  const actions: string[] = [];
  const statut = corps.statut as StatutReservation | undefined;
  if (statut !== undefined && !STATUTS.includes(statut)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Statut invalide.");
  const date = corps.date === undefined ? r.date : String(corps.date);
  const heure = corps.heure === undefined ? r.heure : String(corps.heure);
  const couverts = corps.couverts === undefined ? r.couverts : Number(corps.couverts);
  if (!JOUR_VALIDE.test(date) || !HEURE_VALIDE.test(heure) || !Number.isInteger(couverts) || couverts < 1 || couverts > 200) {
    throw new ErreurHttp(400, "CHAMP_INVALIDE", "Date, heure ou nombre de personnes invalide.");
  }
  const deplacee = date !== r.date || heure !== r.heure || couverts !== r.couverts;
  const reactivee = statut === "confirmee" && (r.statut === "annulee" || r.statut === "absente");
  if (deplacee || reactivee) {
    const du = await reservationsDu(ctx.db, etab.id, date, date);
    const refus = controler(reglages, du, { date, heure, couverts }, { maintenant: ctx.maintenant, enLigne: false, ignorer: r.id });
    if (refus && corps.forcer !== true) throw new ErreurHttp(409, refus, `${MESSAGES_REFUS[refus]} Enregistrer quand même ?`);
    if (deplacee) {
      const service = serviceDe(reglages, date, heure);
      actions.push(`déplacée : ${r.date} ${r.heure} × ${r.couverts} → ${date} ${heure} × ${couverts}`);
      Object.assign(r, { date, heure, couverts, serviceId: service?.id ?? "hors-service", dureeMinutes: dureeDe(reglages, service) });
    }
  }
  if (statut && statut !== r.statut) {
    actions.push(LIBELLES_STATUT[statut]);
    r.statut = statut;
  }
  if (Array.isArray(corps.tables)) {
    const ids = corps.tables.map(String).filter((t) => etab.tables.some((x) => x.id === t));
    if (ids.join() !== r.tables.join()) {
      actions.push(ids.length ? `table ${ids.map((t) => etab.tables.find((x) => x.id === t)?.nom ?? t).join(" + ")}` : "à placer");
      r.tables = ids;
    }
  } else if (deplacee) {
    const du = await reservationsDu(ctx.db, etab.id, r.date, r.date);
    const places = r.tables.reduce((n, t) => n + (etab.tables.find((x) => x.id === t)?.chaises ?? 4), 0);
    if (r.tables.length === 0 || places < r.couverts || conflitsTable(du, r).length > 0) {
      r.tables = attribuerTable(etab.tables.filter((t) => !t.masquee), du, r);
    }
  }
  if (corps.dureeMinutes !== undefined) {
    const d = Number(corps.dureeMinutes);
    if (!Number.isInteger(d) || d < 15 || d > 480) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Durée invalide.");
    if (d !== r.dureeMinutes) actions.push(`durée ${d} min`);
    r.dureeMinutes = d;
  }
  for (const champ of ["prenom", "nom", "telephone", "email", "commentaire"] as const) {
    if (corps[champ] === undefined) continue;
    const c = validerCoordonnees({ prenom: r.prenom, nom: r.nom, telephone: r.telephone, email: r.email ?? "", commentaire: r.commentaire ?? "", [champ]: String(corps[champ]) }, { emailObligatoire: false });
    if ("erreurs" in c) throw new ErreurHttp(400, "COORDONNEES_INVALIDES", c.erreurs.join(" "));
    Object.assign(r, { prenom: c.ok.prenom, nom: c.ok.nom, telephone: c.ok.telephone });
    if (c.ok.email) r.email = c.ok.email;
    else delete r.email;
    if (c.ok.commentaire) r.commentaire = c.ok.commentaire;
    else delete r.commentaire;
    if (JSON.stringify([avant[champ]]) !== JSON.stringify([r[champ]])) actions.push(`${champ} modifié`);
  }
  if (actions.length === 0) return { reservation: r, conflits: conflitsTable(await reservationsDu(ctx.db, etab.id, r.date, r.date), r) };
  r.majLe = ctx.maintenant.toISOString();
  r.historique.push({ le: r.majLe, par, action: actions.join(" · ") });
  await ecrire(ctx.db, r);
  if (r.email && r.statut === "annulee" && avant.statut !== "annulee") await envoyerAnnulation(ctx, etab, reglages, r, "etablissement");
  else if (r.email && deplacee && r.statut === "confirmee") await envoyerConfirmation(ctx, etab, reglages, r, null);
  return { reservation: r, conflits: conflitsTable(await reservationsDu(ctx.db, etab.id, r.date, r.date), r) };
}

// ───────── Annulation par le client ─────────

async function parJeton(db: Db, jeton: string): Promise<Reservation> {
  const [l] = await db.requete<{ contenu: Reservation }>("select contenu from reservations where jeton_hash = $1", [await sha256(jeton)]);
  if (!l) throw new ErreurHttp(404, "RESERVATION_INCONNUE", "Ce lien de réservation n'est plus valable.");
  return l.contenu;
}


function resume(etab: EtablissementApi, r: Reservation, maintenant: Date): ResumePublic {
  const ici = maintenantParis(maintenant);
  const aVenir = r.date > ici.jour || (r.date === ici.jour && Number(r.heure.slice(0, 2)) * 60 + Number(r.heure.slice(3)) > ici.minute);
  return {
    id: r.id,
    date: r.date,
    heure: r.heure,
    couverts: r.couverts,
    prenom: r.prenom,
    nom: r.nom,
    statut: r.statut,
    etablissement: {
      id: etab.id,
      nom: etab.identite.enseigne,
      adresse: etab.identite.adresse,
      codePostalVille: etab.identite.codePostalVille,
      telephone: etab.identite.telephone,
    },
    annulable: r.statut === "confirmee" && aVenir,
  };
}

// ───────── E-mails ─────────

const echapper = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const dateLisible = (jour: string) =>
  new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const personnes = (n: number) => `${n} personne${n > 1 ? "s" : ""}`;

function gabarit(etab: EtablissementApi, titre: string, lignes: string[], bouton?: { texte: string; url: string }): string {
  const i = etab.identite;
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f1ec;font-family:Helvetica,Arial,sans-serif;color:#2b2420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px" cellpadding="0" cellspacing="0">
<tr><td style="background:#2b2b2b;color:#ffffff;border-radius:12px 12px 0 0;padding:20px 28px;font-size:18px;font-weight:bold">${echapper(i.enseigne)}</td></tr>
<tr><td style="padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${echapper(titre)}</h1>
${lignes.map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.5">${l}</p>`).join("\n")}
${bouton ? `<p style="margin:24px 0 0"><a href="${echapper(bouton.url)}" style="display:inline-block;padding:12px 20px;border:1px solid #2b2b2b;border-radius:8px;color:#2b2b2b;text-decoration:none">${echapper(bouton.texte)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #eee;font-size:13px;color:#6b625b">${echapper(i.enseigne)} · ${echapper(i.adresse)}, ${echapper(i.codePostalVille)}${i.telephone ? ` · ${echapper(i.telephone)}` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Expéditeur des e-mails aux clients : l'établissement (nom, adresse réglée), réponses vers son e-mail. */
function expedition(etab: EtablissementApi, reglages: ReglagesReservation): Pick<Courriel, "de" | "deNom" | "repondreA"> {
  return {
    ...(reglages.expediteur ? { de: reglages.expediteur } : {}),
    deNom: etab.identite.enseigne,
    ...(reglages.email ? { repondreA: reglages.email } : {}),
  };
}

/**
 * E-mail d'essai à l'établissement, avec l'expéditeur réglé : vérifie la clé
 * d'envoi, l'adresse d'expédition et son domaine chez Resend.
 */
export async function essaiCourriel(ctx: ContexteResa, etab: EtablissementApi): Promise<{ a: string; de: string | null }> {
  const { reglages } = await lireReglages(ctx.db, etab.id);
  if (!ctx.envoyer) throw new ErreurHttp(503, "ENVOI_NON_CONFIGURE", "L'envoi d'e-mails n'est pas branché : la clé Resend (RESEND_API_KEY) manque dans Vercel.");
  if (!reglages.email) throw new ErreurHttp(400, "EMAIL_MANQUANT", "Indiquez d'abord l'e-mail de l'établissement et enregistrez : l'essai lui est envoyé.");
  try {
    await ctx.envoyer({
      a: reglages.email,
      ...expedition(etab, reglages),
      sujet: `E-mail d'essai · réservations ${etab.identite.enseigne}`,
      html: gabarit(etab, "L'envoi des e-mails fonctionne", [
        "Cet e-mail d'essai part avec les réglages des réservations : les clients recevront leurs confirmations de cette adresse.",
        `Expéditeur : ${echapper(reglages.expediteur ?? "adresse par défaut de l'hébergement")}`,
      ]),
      texte: `E-mail d'essai : les confirmations de réservation de ${etab.identite.enseigne} partiront de ${reglages.expediteur ?? "l'adresse par défaut"}.`,
    });
  } catch (e) {
    throw new ErreurHttp(502, "ENVOI_REFUSE", `L'e-mail d'essai n'est pas parti : ${e instanceof Error ? e.message : String(e)}`);
  }
  return { a: reglages.email, de: reglages.expediteur ?? null };
}

async function envoyer(ctx: ContexteResa, r: Reservation, c: Courriel, action: string): Promise<void> {
  if (!ctx.envoyer) return;
  let resultat = action;
  try {
    await ctx.envoyer(c);
  } catch (e) {
    resultat = `${action} : échec (${String(e).slice(0, 120)})`;
  }
  r.historique.push({ le: ctx.maintenant.toISOString(), par: "serveur", action: resultat });
  await ecrire(ctx.db, r);
}

async function envoyerConfirmation(ctx: ContexteResa, etab: EtablissementApi, reglages: ReglagesReservation, r: Reservation, jeton: string | null): Promise<void> {
  if (!r.email) return;
  // Un nouveau lien d'annulation à chaque confirmation (l'ancien cesse de valoir).
  const lien = jeton ?? nouveauJeton();
  if (!jeton) await ctx.db.requete("update reservations set jeton_hash = $2 where id = $1", [r.id, await sha256(lien)]);
  const url = `${ctx.origine}/reserver/annuler?j=${encodeURIComponent(lien)}`;
  const quand = `${dateLisible(r.date)} à ${r.heure.replace(":", " h ")}`;
  const lignes = [
    `Bonjour ${echapper(r.prenom)},`,
    `Votre table est réservée le <b>${echapper(quand)}</b> pour <b>${personnes(r.couverts)}</b>.`,
    ...(r.commentaire ? [`Votre message : « ${echapper(r.commentaire)} »`] : []),
    `Un empêchement ? Annulez en un clic, ou appelez-nous${etab.identite.telephone ? ` au ${echapper(etab.identite.telephone)}` : ""}.`,
  ];
  await envoyer(
    ctx,
    r,
    {
      a: r.email,
      nomA: `${r.prenom} ${r.nom}`,
      ...expedition(etab, reglages),
      sujet: `Réservation confirmée · ${etab.identite.enseigne} · ${quand}`,
      html: gabarit(etab, "Votre réservation est confirmée", lignes, { texte: "Annuler ma réservation", url }),
      texte: `Bonjour ${r.prenom},\nVotre table est réservée le ${quand} pour ${personnes(r.couverts)}.\nPour annuler : ${url}\n${etab.identite.enseigne}, ${etab.identite.adresse}, ${etab.identite.codePostalVille}`,
    },
    "e-mail de confirmation envoyé",
  );
}

async function envoyerAnnulation(ctx: ContexteResa, etab: EtablissementApi, reglages: ReglagesReservation, r: Reservation, par: "client" | "etablissement"): Promise<void> {
  if (!r.email) return;
  const quand = `${dateLisible(r.date)} à ${r.heure.replace(":", " h ")}`;
  await envoyer(
    ctx,
    r,
    {
      a: r.email,
      nomA: `${r.prenom} ${r.nom}`,
      ...expedition(etab, reglages),
      sujet: `Réservation annulée · ${etab.identite.enseigne} · ${quand}`,
      html: gabarit(etab, "Votre réservation est annulée", [
        `Bonjour ${echapper(r.prenom)},`,
        par === "client"
          ? `Nous avons bien noté l'annulation de votre table du <b>${echapper(quand)}</b>. À bientôt !`
          : `Votre table du <b>${echapper(quand)}</b> a été annulée. Pour toute question, répondez à cet e-mail ou appelez-nous.`,
      ]),
      texte: `Bonjour ${r.prenom},\nVotre réservation du ${quand} est annulée.\n${etab.identite.enseigne}`,
    },
    "e-mail d'annulation envoyé",
  );
}

async function prevenirEtablissement(ctx: ContexteResa, etab: EtablissementApi, reglages: ReglagesReservation, r: Reservation, titre: string): Promise<void> {
  if (!ctx.envoyer || !reglages.email) return;
  const quand = `${dateLisible(r.date)} à ${r.heure}`;
  try {
    await ctx.envoyer({
      a: reglages.email,
      ...(reglages.expediteur ? { de: reglages.expediteur } : {}),
      deNom: `Réservations ${etab.identite.enseigne}`,
      ...(r.email ? { repondreA: r.email } : {}),
      sujet: `${titre} · ${quand} · ${r.couverts} pers. · ${r.prenom} ${r.nom}`,
      html: gabarit(etab, titre, [
        `<b>${echapper(quand)}</b> · ${personnes(r.couverts)}`,
        `${echapper(`${r.civilite ?? ""} ${r.prenom} ${r.nom}`.trim())} · ${echapper(r.telephone)}${r.email ? ` · ${echapper(r.email)}` : ""}`,
        ...(r.commentaire ? [`« ${echapper(r.commentaire)} »`] : []),
        r.tables.length ? `Table ${echapper(r.tables.map((t) => etab.tables.find((x) => x.id === t)?.nom ?? t).join(" + "))}` : "Table à placer",
      ]),
      texte: `${titre} : ${quand}, ${personnes(r.couverts)}, ${r.prenom} ${r.nom}, ${r.telephone}`,
    });
  } catch {
    /* la réservation reste valable ; l'équipe la voit dans la caisse et l'administration */
  }
}

// ───────── Routes ─────────

function json(statut: number, corps: unknown): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function corpsJson(requete: Request): Promise<Record<string, unknown>> {
  const t = await requete.text();
  if (t.length > 20_000) throw new ErreurHttp(413, "TROP_VOLUMINEUX", "Requête trop volumineuse.");
  try {
    const v = JSON.parse(t || "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new ErreurHttp(400, "JSON_INVALIDE", "Corps de requête illisible.");
  }
}

/** Zones du plan qui ont des tables visibles (préférence proposée au client s'il y en a plusieurs). */
const zonesDe = (etab: EtablissementApi) => [...new Set(etab.tables.filter((t) => !t.masquee).map((t) => t.zone))];


/** Module du site : config, jours libres, créneaux, réservation, annulation par lien. */
export async function routePublique(ctx: ContexteResa, requete: Request, chemin: string): Promise<Response | null> {
  const m = requete.method;
  const url = new URL(requete.url);
  const a = /^\/api\/public\/reservation\/annulation\/([A-Za-z0-9_-]{20,80})$/.exec(chemin);
  if (a) {
    const r = await parJeton(ctx.db, a[1]!);
    const etab = await ctx.etablissement(r.etablissementId);
    if (m === "GET") return json(200, { reservation: resume(etab, r, ctx.maintenant) });
    if (m === "POST") {
      if (!resume(etab, r, ctx.maintenant).annulable) throw new ErreurHttp(409, "NON_ANNULABLE", "Cette réservation ne peut plus être annulée en ligne : appelez-nous.");
      r.statut = "annulee";
      r.majLe = ctx.maintenant.toISOString();
      r.historique.push({ le: r.majLe, par: "client", action: "annulée par le client (lien)" });
      await ecrire(ctx.db, r);
      const { reglages } = await lireReglages(ctx.db, etab.id);
      await envoyerAnnulation(ctx, etab, reglages, r, "client");
      await prevenirEtablissement(ctx, etab, reglages, r, "Réservation annulée par le client");
      return json(200, { reservation: resume(etab, r, ctx.maintenant) });
    }
    return null;
  }
  const p = /^\/api\/public\/reservation\/([a-z0-9-]{1,40})(\/jours|\/creneaux)?$/.exec(chemin);
  if (!p) return null;
  const etab = await ctx.etablissement(p[1]!).catch(() => {
    throw new ErreurHttp(404, "RESERVATION_FERMEE", "Réservation en ligne indisponible.");
  });
  const { reglages } = await lireReglages(ctx.db, etab.id);
  if (!reglages.actif) throw new ErreurHttp(404, "RESERVATION_FERMEE", "La réservation en ligne n'est pas ouverte pour cet établissement.");
  const aujourdhui = maintenantParis(ctx.maintenant).jour;
  const couverts = Math.max(1, Math.min(reglages.groupeMax, Number(url.searchParams.get("couverts") ?? 2) || 2));
  if (!p[2] && m === "GET") {
    const config: ConfigPublique = {
      etablissement: resume(etab, { statut: "confirmee", date: aujourdhui, heure: "00:00" } as Reservation, ctx.maintenant).etablissement,
      accueil: reglages.accueil,
      groupeMax: reglages.groupeMax,
      horizonJours: reglages.horizonJours,
      ...(reglages.telephone ? { telephone: reglages.telephone } : {}),
      ...(reglages.email ? { email: reglages.email } : {}),
      ...(reglages.conditions ? { conditions: reglages.conditions } : {}),
      ...(reglages.confidentialite ? { confidentialite: reglages.confidentialite } : {}),
      zones: zonesDe(etab).length > 1 ? zonesDe(etab) : [],
      aujourdhui,
    };
    return json(200, config);
  }
  if (p[2] === "/jours" && m === "GET") {
    const du = url.searchParams.get("du") ?? aujourdhui;
    const au = url.searchParams.get("au") ?? decalerJour(du, 30);
    if (!JOUR_VALIDE.test(du) || !JOUR_VALIDE.test(au) || au < du) throw new ErreurHttp(400, "PERIODE_INVALIDE", "Période invalide.");
    const debut = du < aujourdhui ? aujourdhui : du;
    const fin = [au, decalerJour(debut, JOURS_MAX_CALENDRIER), decalerJour(aujourdhui, reglages.horizonJours)].sort()[0]!;
    if (fin < debut) return json(200, { jours: [] });
    const resas = await reservationsDu(ctx.db, etab.id, debut, fin);
    return json(200, { jours: joursLibres(reglages, resas, debut, fin, couverts, ctx.maintenant) });
  }
  if (p[2] === "/creneaux" && m === "GET") {
    const date = url.searchParams.get("date") ?? "";
    if (!JOUR_VALIDE.test(date)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Date invalide.");
    const resas = await reservationsDu(ctx.db, etab.id, date, date);
    return json(200, { services: creneauxDuJour(reglages, resas, date, couverts, ctx.maintenant) });
  }
  if (!p[2] && m === "POST") {
    const corps = await corpsJson(requete);
    // Champ piège invisible : rempli, c'est un robot (réponse banale, rien n'est écrit).
    if (typeof corps.site === "string" && corps.site) return json(400, { code: "REFUSE", message: "Demande refusée." });
    if (corps.conditions !== true) throw new ErreurHttp(400, "CONDITIONS", "Merci d'accepter les conditions d'utilisation du service.");
    const s = lireSaisie(corps, true);
    delete s.tables;
    if (s.zone && !zonesDe(etab).includes(s.zone)) delete s.zone;
    const { reservation, jeton } = await creerReservation(ctx, etab, s, { source: "en_ligne", par: "client (en ligne)" });
    return json(201, { reservation: resume(etab, reservation, ctx.maintenant), annulation: jeton });
  }
  return null;
}

/** Liste et saisie par l'équipe (administration ou caisse). */
export async function listeReservations(ctx: ContexteResa, etablissementId: string, du: string, au: string): Promise<Reservation[]> {
  if (!JOUR_VALIDE.test(du) || !JOUR_VALIDE.test(au) || au < du || decalerJour(du, 366) < au) throw new ErreurHttp(400, "PERIODE_INVALIDE", "Période invalide.");
  return reservationsDu(ctx.db, etablissementId, du, au);
}

export async function saisieEquipe(ctx: ContexteResa, etab: EtablissementApi, corps: Record<string, unknown>, par: string) {
  const s = lireSaisie(corps, false);
  const source: SourceReservation = corps.source === "sur_place" ? "sur_place" : "telephone";
  return creerReservation(ctx, etab, s, { source, par, forcer: corps.forcer === true });
}

export async function enregistrerReglages(db: Db, etablissementId: string, corps: Record<string, unknown>, par: string, maintenant: Date) {
  const r = corps.reglages as ReglagesReservation | undefined;
  if (!r || typeof r !== "object") throw new ErreurHttp(400, "CHAMP_INVALIDE", "Réglages manquants.");
  const propres: ReglagesReservation = {
    actif: r.actif === true,
    services: (Array.isArray(r.services) ? r.services : []).map((s) => ({
      id: String(s.id).slice(0, 40),
      nom: String(s.nom ?? "").trim().slice(0, 40),
      jours: (Array.isArray(s.jours) ? s.jours : []).map(Number).sort(),
      debut: String(s.debut),
      fin: String(s.fin),
      couvertsMax: Number(s.couvertsMax),
      simultanesMax: s.simultanesMax === null || s.simultanesMax === undefined ? null : Number(s.simultanesMax),
      arriveesMax: s.arriveesMax === null || s.arriveesMax === undefined ? null : Number(s.arriveesMax),
      ...(s.dureeMinutes ? { dureeMinutes: Number(s.dureeMinutes) } : {}),
    })),
    dureeMinutes: Number(r.dureeMinutes),
    pasMinutes: Number(r.pasMinutes) as 15 | 30,
    delaiMinutes: Number(r.delaiMinutes),
    horizonJours: Number(r.horizonJours),
    groupeMax: Number(r.groupeMax),
    fermetures: (Array.isArray(r.fermetures) ? r.fermetures : []).map(String).sort(),
    accueil: String(r.accueil ?? "").trim(),
    ...(r.telephone ? { telephone: String(r.telephone).trim().slice(0, 30) } : {}),
    ...(r.email ? { email: String(r.email).trim().toLowerCase().slice(0, 120) } : {}),
    ...(r.expediteur ? { expediteur: String(r.expediteur).trim().toLowerCase().slice(0, 120) } : {}),
    ...(r.conditions ? { conditions: String(r.conditions).trim() } : {}),
    ...(r.confidentialite ? { confidentialite: String(r.confidentialite).trim() } : {}),
  };
  const erreurs = validerReglages(propres);
  if (propres.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(propres.email)) erreurs.push("E-mail de l'établissement invalide.");
  if (propres.expediteur && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(propres.expediteur)) erreurs.push("Adresse d'expédition invalide.");
  if (erreurs.length) throw new ErreurHttp(400, "REGLAGES_INVALIDES", erreurs.join(" "));
  const version = Number(corps.version ?? 0);
  const le = maintenant.toISOString();
  const lignes = await db.requete<{ version: number }>(
    `insert into reservations_reglages (etablissement_id, contenu, version, maj_le, maj_par) values ($1, $2::jsonb, 1, $3, $4)
     on conflict (etablissement_id) do update set contenu = excluded.contenu, version = reservations_reglages.version + 1, maj_le = excluded.maj_le, maj_par = excluded.maj_par
     where reservations_reglages.version = $5
     returning version`,
    [etablissementId, JSON.stringify(propres), le, par, version],
  );
  if (!lignes[0]) throw new ErreurHttp(409, "VERSION", "Les réglages ont été modifiés ailleurs entre-temps : rechargez la page.");
  return { reglages: propres, version: lignes[0].version };
}
