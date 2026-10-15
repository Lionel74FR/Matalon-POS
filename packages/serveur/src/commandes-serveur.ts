import { COURRIEL, ficheFournisseur, journeeParis, normaliserNom, type Referentiel } from "@matalon/stock";
import { ErreurHttp, type Db } from "./db.js";
import type { CommandeFournisseur, EtablissementApi, LigneCommandeFournisseur, ReglagesCommandes, ReponseCommandes, StatutCommandeFournisseur } from "./partage.js";
import { dateLisible, echapper, lireReglages, preparerEnvoi, type ContexteResa } from "./reservations-serveur.js";
import { derniersPrix, lireReferentiel } from "./stock-serveur.js";

/**
 * Commandes fournisseurs (hors fiscal) : un bon numéroté par établissement,
 * modifiable tant qu'il est en brouillon (écriture conditionnelle par version),
 * puis envoyé — par e-mail à l'adresse de la fiche du fournisseur, ou marqué
 * envoyé quand il est passé par téléphone ou sur un portail. La livraison se
 * réceptionne contre la commande : les quantités reçues se lisent dans les
 * réceptions (une réception annulée ne compte plus), jamais recopiées.
 */

interface LigneBase {
  id: string;
  etablissement_id: string;
  numero: number;
  fournisseur: string;
  statut: StatutCommandeFournisseur;
  contenu: Contenu;
  version: number;
  cree_le: string;
  cree_par: string;
  maj_le: string;
}

type Contenu = Pick<CommandeFournisseur, "lignes" | "historique" | "livraison" | "message" | "envoi">;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID_COMMANDE = /^cf-[0-9a-f]{8}$/;
export const LIGNES_MAX_COMMANDE = 300;

const nouvelId = () => `cf-${crypto.randomUUID().slice(0, 8)}`;

function texteLibre(v: unknown, ou: string, max: number): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(v)) throw new ErreurHttp(400, "CHAMP_INVALIDE", `${ou} : texte de ${max} caractères au plus.`);
  return v.trim() || undefined;
}

export function idCommandeValide(id: string): boolean {
  return ID_COMMANDE.test(id);
}

// ───────── Réglages d'envoi ─────────

export async function lireReglagesCommandes(db: Db, etablissementId: string): Promise<ReglagesCommandes> {
  const [l] = await db.requete<{ contenu: ReglagesCommandes }>("select contenu from stock_reglages where etablissement_id = $1", [etablissementId]);
  return l?.contenu ?? {};
}

export async function enregistrerReglagesCommandes(db: Db, etablissementId: string, corps: Record<string, unknown>, par: string, maintenant: string): Promise<ReglagesCommandes> {
  const courriel = (v: unknown, ou: string) => {
    const t = texteLibre(v, ou, 120);
    if (t && !COURRIEL.test(t)) throw new ErreurHttp(400, "CHAMP_INVALIDE", `${ou} « ${t} » invalide.`);
    return t?.toLowerCase();
  };
  const r: ReglagesCommandes = {};
  const expediteur = courriel(corps.expediteur, "Adresse d'expédition");
  const email = courriel(corps.email, "E-mail de l'établissement");
  const livraison = texteLibre(corps.livraison, "Livraison", 300);
  if (expediteur) r.expediteur = expediteur;
  if (email) r.email = email;
  if (livraison) r.livraison = livraison;
  await db.requete(
    `insert into stock_reglages (etablissement_id, contenu, maj_le, maj_par) values ($1, $2::jsonb, $3, $4)
     on conflict (etablissement_id) do update set contenu = excluded.contenu, maj_le = excluded.maj_le, maj_par = excluded.maj_par`,
    [etablissementId, JSON.stringify(r), maintenant, par],
  );
  return r;
}

/** Expéditeur et e-mail de l'établissement réellement utilisés : ceux des commandes, sinon ceux des réservations. */
async function expedition(ctx: ContexteResa, etablissementId: string): Promise<{ reglages: ReglagesCommandes; expediteur: string | null; email: string | null; envoi: { cle?: string } | null }> {
  const reglages = await lireReglagesCommandes(ctx.db, etablissementId);
  const resa = (await lireReglages(ctx.db, etablissementId)).reglages;
  return {
    reglages,
    expediteur: reglages.expediteur ?? resa.expediteur ?? null,
    email: reglages.email ?? resa.email ?? null,
    envoi: await preparerEnvoi(ctx, etablissementId),
  };
}

// ───────── Lecture ─────────

/** Commandes d'un établissement, les plus récentes d'abord, avec ce qui en a été reçu. */
export async function listeCommandes(ctx: ContexteResa, etablissementId: string, limite = 200): Promise<ReponseCommandes> {
  const lignes = await ctx.db.requete<LigneBase>(
    `select * from commandes_fournisseurs where etablissement_id = $1
     order by (statut in ('brouillon', 'envoyee')) desc, numero desc limit $2`,
    [etablissementId, limite],
  );
  const e = await expedition(ctx, etablissementId);
  return {
    commandes: await completer(ctx.db, etablissementId, lignes),
    reglages: e.reglages,
    envoi: { possible: !!e.envoi && !!ctx.envoyer, expediteur: e.expediteur, email: e.email },
  };
}

export async function lireCommande(db: Db, etablissementId: string, id: string): Promise<CommandeFournisseur> {
  const [l] = await db.requete<LigneBase>("select * from commandes_fournisseurs where id = $1 and etablissement_id = $2", [id, etablissementId]);
  if (!l) throw new ErreurHttp(404, "COMMANDE_INCONNUE", "Commande introuvable.");
  return (await completer(db, etablissementId, [l]))[0]!;
}

async function completer(db: Db, etablissementId: string, lignes: LigneBase[]): Promise<CommandeFournisseur[]> {
  if (!lignes.length) return [];
  const receptions = await db.requete<{ id: string; le: string; contenu: { commande?: { id: string }; numero?: string; totalHT?: number; lignes: Array<{ articleId: string; nombre: number }> }; annule_le: string | null }>(
    `select id, le, contenu, annule_le from stock_documents
     where etablissement_id = $1 and type = 'reception' and contenu->'commande'->>'id' = any($2::text[]) order by le`,
    [etablissementId, lignes.map((l) => l.id)],
  );
  return lignes.map((l) => {
    const recu: Record<string, number> = {};
    const siennes = receptions.filter((r) => r.contenu.commande?.id === l.id);
    for (const r of siennes) if (!r.annule_le) for (const x of r.contenu.lignes) recu[x.articleId] = (recu[x.articleId] ?? 0) + x.nombre;
    return {
      id: l.id,
      numero: l.numero,
      etablissementId: l.etablissement_id,
      fournisseur: l.fournisseur,
      statut: l.statut,
      version: l.version,
      lignes: l.contenu.lignes,
      ...(l.contenu.livraison ? { livraison: l.contenu.livraison } : {}),
      ...(l.contenu.message ? { message: l.contenu.message } : {}),
      ...(l.contenu.envoi ? { envoi: l.contenu.envoi } : {}),
      historique: l.contenu.historique,
      creeLe: l.cree_le,
      creePar: l.cree_par,
      majLe: l.maj_le,
      recu,
      receptions: siennes.map((r) => ({ id: r.id, le: r.le, numero: r.contenu.numero ?? "", totalHT: r.contenu.totalHT ?? 0, annulee: !!r.annule_le })),
    };
  });
}

/** Commande entièrement reçue : chaque ligne a reçu au moins la quantité commandée. */
export function commandeRecue(c: Pick<CommandeFournisseur, "lignes" | "recu">): boolean {
  return c.lignes.every((l) => (c.recu[l.articleId] ?? 0) >= l.nombre);
}

// ───────── Saisie ─────────

/** Lignes d'un bon, contrôlées : articles actifs de ce fournisseur, une ligne par article ; prix indicatif = dernier prix de l'établissement. */
async function lireLignes(db: Db, referentiel: Referentiel, etablissementId: string, fournisseur: string, v: unknown): Promise<LigneCommandeFournisseur[]> {
  if (!Array.isArray(v) || v.length > LIGNES_MAX_COMMANDE) throw new ErreurHttp(400, "CHAMP_INVALIDE", `${LIGNES_MAX_COMMANDE} lignes au plus.`);
  const prix = (await derniersPrix(db)).filter((p) => p.etablissementId === etablissementId);
  const vus = new Set<string>();
  return v.map((x, i) => {
    const o = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
    const article = referentiel.articles.find((a) => a.id === o.articleId);
    if (!article || !article.actif) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Ligne ${i + 1} : article fournisseur inconnu ou archivé.`);
    if (normaliserNom(article.fournisseur) !== normaliserNom(fournisseur)) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Ligne ${i + 1} : cet article n'est pas vendu par ${fournisseur}.`);
    if (vus.has(article.id)) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Ligne ${i + 1} : article en double, regroupez les quantités.`);
    vus.add(article.id);
    const nombre = o.nombre;
    if (typeof nombre !== "number" || !Number.isSafeInteger(nombre) || nombre < 1 || nombre > 1_000_000_000) {
      throw new ErreurHttp(400, "CHAMP_INVALIDE", `Ligne ${i + 1} : nombre de conditionnements (millièmes) entre 1 et 1 000 000 000.`);
    }
    return { articleId: article.id, produitId: article.produitId, nombre, prixHT: prix.find((p) => p.articleId === article.id)?.prixHT ?? null };
  });
}

function lireEntete(corps: Record<string, unknown>): Pick<Contenu, "livraison" | "message"> {
  const livraison = corps.livraison;
  if (livraison !== undefined && livraison !== null && livraison !== "" && (typeof livraison !== "string" || !DATE.test(livraison))) {
    throw new ErreurHttp(400, "CHAMP_INVALIDE", "Date de livraison souhaitée invalide.");
  }
  const message = texteLibre(corps.message, "Message au fournisseur", 1000);
  return { ...(livraison ? { livraison: livraison as string } : {}), ...(message ? { message } : {}) };
}

/** Nouveau bon en brouillon, numéroté à la suite des bons de l'établissement. */
export async function creerCommande(db: Db, etablissementId: string, corps: Record<string, unknown>, par: string, maintenant: string): Promise<CommandeFournisseur> {
  const { referentiel } = await lireReferentiel(db);
  const nom = texteLibre(corps.fournisseur, "Fournisseur", 80);
  if (!nom) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Fournisseur obligatoire.");
  // Orthographe de la fiche, sinon celle des articles.
  const fournisseur = ficheFournisseur(referentiel, nom)?.nom ?? referentiel.articles.find((a) => normaliserNom(a.fournisseur) === normaliserNom(nom))?.fournisseur;
  if (!fournisseur) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Fournisseur inconnu : ${nom}.`);
  const contenu: Contenu = {
    lignes: await lireLignes(db, referentiel, etablissementId, fournisseur, corps.lignes ?? []),
    ...lireEntete(corps),
    historique: [{ le: maintenant, par, action: "créée" }],
  };
  for (let essai = 0; essai < 4; essai++) {
    const id = nouvelId();
    try {
      await db.requete(
        `insert into commandes_fournisseurs (id, etablissement_id, numero, fournisseur, statut, contenu, version, cree_le, cree_par, maj_le)
         select $1, $2, coalesce(max(numero), 0) + 1, $3, 'brouillon', $4::jsonb, 1, $5, $6, $5 from commandes_fournisseurs where etablissement_id = $2`,
        [id, etablissementId, fournisseur, JSON.stringify(contenu), maintenant, par],
      );
      return await lireCommande(db, etablissementId, id);
    } catch (e) {
      // Deux bons créés au même instant : le numéro est déjà pris, on recommence.
      if (essai === 3 || !/unique|duplicate/i.test(String(e))) throw e;
    }
  }
  throw new ErreurHttp(409, "NUMERO_PRIS", "Réessayez.");
}

function attendreVersion(corps: Record<string, unknown>): number {
  const v = corps.version;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Version de la commande attendue.");
  return v;
}

/** Écriture conditionnelle : refusée si quelqu'un a modifié la commande entre-temps. */
async function ecrire(db: Db, c: CommandeFournisseur, version: number, statut: StatutCommandeFournisseur, contenu: Contenu, maintenant: string): Promise<CommandeFournisseur> {
  const [maj] = await db.requete<{ version: number }>(
    `update commandes_fournisseurs set statut = $3, contenu = $4::jsonb, version = version + 1, maj_le = $5
     where id = $1 and etablissement_id = $2 and version = $6 returning version`,
    [c.id, c.etablissementId, statut, JSON.stringify(contenu), maintenant, version],
  );
  if (!maj) throw new ErreurHttp(409, "COMMANDE_MODIFIEE", `La commande n° ${c.numero} vient d'être modifiée ailleurs : rechargez-la.`);
  return lireCommande(db, c.etablissementId, c.id);
}

const contenuDe = (c: CommandeFournisseur): Contenu => ({
  lignes: c.lignes,
  historique: c.historique,
  ...(c.livraison ? { livraison: c.livraison } : {}),
  ...(c.message ? { message: c.message } : {}),
  ...(c.envoi ? { envoi: c.envoi } : {}),
});

async function verifiee(db: Db, etablissementId: string, id: string, corps: Record<string, unknown>, statuts: StatutCommandeFournisseur[], quoi: string): Promise<{ c: CommandeFournisseur; version: number }> {
  const version = attendreVersion(corps);
  const c = await lireCommande(db, etablissementId, id);
  if (c.version !== version) throw new ErreurHttp(409, "COMMANDE_MODIFIEE", `La commande n° ${c.numero} vient d'être modifiée ailleurs : rechargez-la.`);
  if (!statuts.includes(c.statut)) throw new ErreurHttp(409, "STATUT_COMMANDE", `La commande n° ${c.numero} est ${LIBELLES_STATUT[c.statut]} : ${quoi} impossible.`);
  return { c, version };
}

const LIBELLES_STATUT: Record<StatutCommandeFournisseur, string> = { brouillon: "en brouillon", envoyee: "déjà envoyée", soldee: "soldée", annulee: "annulée" };

/** Modifie un brouillon (lignes, livraison souhaitée, message). */
export async function modifierCommande(db: Db, etablissementId: string, id: string, corps: Record<string, unknown>, par: string, maintenant: string): Promise<CommandeFournisseur> {
  const { c, version } = await verifiee(db, etablissementId, id, corps, ["brouillon"], "modification");
  const { referentiel } = await lireReferentiel(db);
  const contenu: Contenu = {
    lignes: await lireLignes(db, referentiel, etablissementId, c.fournisseur, corps.lignes ?? []),
    ...lireEntete(corps),
    historique: [...c.historique, { le: maintenant, par, action: "modifiée" }].slice(-100),
  };
  return ecrire(db, c, version, "brouillon", contenu, maintenant);
}

// ───────── Envoi ─────────

const milliemes = (n: number) => (n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const eurosTexte = (centimes: number) => `${(centimes / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const montantLigne = (l: LigneCommandeFournisseur) => (l.prixHT == null ? null : Math.round((l.prixHT * l.nombre) / 1000));

/** Bon de commande en HTML et en texte, tel qu'il part chez le fournisseur. */
export function bonDeCommande(
  c: CommandeFournisseur,
  referentiel: Referentiel,
  etab: EtablissementApi,
  options: { numeroClient?: string; livraison?: string; email?: string | null },
): { sujet: string; html: string; texte: string } {
  const i = etab.identite;
  const lignes = c.lignes.map((l) => {
    const a = referentiel.articles.find((x) => x.id === l.articleId);
    const p = referentiel.produits.find((x) => x.id === l.produitId);
    return { reference: a?.reference ?? "", designation: p?.nom ?? l.produitId, conditionnement: a?.conditionnement ?? "", quantite: milliemes(l.nombre), prix: l.prixHT, montant: montantLigne(l) };
  });
  const total = c.lignes.reduce((s, l) => s + (montantLigne(l) ?? 0), 0);
  const prixManquants = c.lignes.some((l) => l.prixHT == null);
  const client = options.numeroClient ? ` · client ${options.numeroClient}` : "";
  const quand = c.livraison ? dateLisible(c.livraison) : null;
  const sujet = `Commande n° ${c.numero} · ${i.enseigne}${client}${quand ? ` · livraison souhaitée le ${quand}` : ""}`;
  const adresse = `${i.adresse}, ${i.codePostalVille}`;
  const cellule = 'style="padding:8px;border-bottom:1px solid #eee;font-size:14px;vertical-align:top"';
  const droite = 'style="padding:8px;border-bottom:1px solid #eee;font-size:14px;text-align:right;white-space:nowrap;vertical-align:top"';
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;background:#f6f3ef;font-family:Helvetica,Arial,sans-serif;color:#2b2b2b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:720px;background:#ffffff;border-radius:12px" cellpadding="0" cellspacing="0">
<tr><td style="background:#2b2b2b;color:#ffffff;border-radius:12px 12px 0 0;padding:18px 24px;font-size:18px;font-weight:bold">Bon de commande n° ${c.numero} · ${echapper(i.enseigne)}</td></tr>
<tr><td style="padding:20px 24px;font-size:14px;line-height:1.5">
<p style="margin:0 0 12px">Bonjour,<br>Merci de bien vouloir nous livrer la commande suivante.</p>
<p style="margin:0 0 12px"><b>Client :</b> ${echapper(i.raisonSociale || i.enseigne)}${options.numeroClient ? ` · n° client <b>${echapper(options.numeroClient)}</b>` : ""}<br>
<b>Livraison :</b> ${echapper(i.enseigne)}, ${echapper(adresse)}${quand ? ` · <b>souhaitée le ${echapper(quand)}</b>` : ""}${options.livraison ? `<br>${echapper(options.livraison)}` : ""}</p>
${c.message ? `<p style="margin:0 0 12px;padding:10px 12px;background:#f6f3ef;border-radius:8px">${echapper(c.message).replace(/\n/g, "<br>")}</p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0">
<tr style="background:#f6f3ef"><th align="left" ${cellule}>Réf.</th><th align="left" ${cellule}>Désignation</th><th ${droite}>Quantité</th><th ${droite}>Prix HT</th><th ${droite}>Montant HT</th></tr>
${lignes
  .map(
    (l) =>
      `<tr><td ${cellule}>${echapper(l.reference)}</td><td ${cellule}>${echapper(l.designation)}${l.conditionnement ? `<br><span style="color:#6b625b">${echapper(l.conditionnement)}</span>` : ""}</td><td ${droite}><b>${l.quantite}</b></td><td ${droite}>${l.prix == null ? "—" : eurosTexte(l.prix)}</td><td ${droite}>${l.montant == null ? "—" : eurosTexte(l.montant)}</td></tr>`,
  )
  .join("\n")}
<tr><td colspan="4" ${droite}><b>Total HT${prixManquants ? " (lignes chiffrées)" : ""}</b></td><td ${droite}><b>${eurosTexte(total)}</b></td></tr>
</table>
<p style="margin:12px 0 0;font-size:13px;color:#6b625b">Quantités en conditionnements (bouteille, carton, fût…). Prix HT indicatifs : notre dernier prix connu, droits compris. Merci de confirmer la commande et de nous signaler toute rupture ou tout changement de prix en répondant à cet e-mail.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:13px;color:#6b625b">${echapper(i.enseigne)} · ${echapper(adresse)}${i.telephone ? ` · ${echapper(i.telephone)}` : ""}${options.email ? ` · ${echapper(options.email)}` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  const texte = [
    `Bon de commande n° ${c.numero} · ${i.enseigne}`,
    `Client : ${i.raisonSociale || i.enseigne}${options.numeroClient ? ` · n° client ${options.numeroClient}` : ""}`,
    `Livraison : ${i.enseigne}, ${adresse}${quand ? ` · souhaitée le ${quand}` : ""}`,
    ...(options.livraison ? [options.livraison] : []),
    ...(c.message ? ["", c.message] : []),
    "",
    ...lignes.map((l) => `- ${l.quantite} × ${l.designation}${l.conditionnement ? ` (${l.conditionnement})` : ""}${l.reference ? ` · réf. ${l.reference}` : ""}${l.montant == null ? "" : ` · ${eurosTexte(l.montant)} HT`}`),
    "",
    `Total HT indicatif : ${eurosTexte(total)}`,
    "Merci de confirmer la commande et de signaler toute rupture en répondant à cet e-mail.",
    `${i.enseigne} · ${adresse}${i.telephone ? ` · ${i.telephone}` : ""}`,
  ].join("\n");
  return { sujet, html, texte };
}

/**
 * Envoie un brouillon. Par e-mail : à l'adresse de la fiche du fournisseur,
 * en copie celles de la fiche et l'e-mail de l'établissement, réponses vers
 * l'établissement. La commande passe d'abord « envoyée » (deux appareils ne
 * l'envoient pas deux fois) ; si l'e-mail échoue, elle redevient brouillon.
 */
export async function envoyerCommande(ctx: ContexteResa, etab: EtablissementApi, id: string, corps: Record<string, unknown>, par: string): Promise<CommandeFournisseur> {
  const maintenant = ctx.maintenant.toISOString();
  const { c, version } = await verifiee(ctx.db, etab.id, id, corps, ["brouillon"], "envoi");
  if (!c.lignes.length) throw new ErreurHttp(400, "COMMANDE_VIDE", "La commande est vide.");
  const mode = corps.mode === "manuel" ? "manuel" : "courriel";
  if (mode === "manuel") {
    const contenu = { ...contenuDe(c), envoi: { le: maintenant, par, mode }, historique: [...c.historique, { le: maintenant, par, action: "marquée envoyée (téléphone, portail…)" }] } satisfies Contenu;
    return ecrire(ctx.db, c, version, "envoyee", contenu, maintenant);
  }
  const { referentiel } = await lireReferentiel(ctx.db);
  const fiche = ficheFournisseur(referentiel, c.fournisseur);
  if (!fiche?.courriel) throw new ErreurHttp(400, "FOURNISSEUR_SANS_EMAIL", `Aucun e-mail de commande dans la fiche de ${c.fournisseur} : complétez-la (Stock et recettes › Fournisseurs) ou marquez la commande envoyée.`);
  const e = await expedition(ctx, etab.id);
  if (!e.envoi || !ctx.envoyer) throw new ErreurHttp(503, "ENVOI_NON_CONFIGURE", "Aucune clé d'envoi d'e-mails pour cet établissement (administration › Réservations › Services et réglages).");
  const copies = [...new Set([...(fiche.copies ?? []), ...(e.email ? [e.email] : [])])].filter((x) => x !== fiche.courriel);
  const envoi = { le: maintenant, par, mode, a: fiche.courriel, ...(copies.length ? { copies } : {}) } as const;
  const aEnvoyer = { ...c, envoi };
  const enCours = await ecrire(ctx.db, c, version, "envoyee", { ...contenuDe(c), envoi, historique: [...c.historique, { le: maintenant, par, action: `envoyée par e-mail à ${fiche.courriel}${copies.length ? ` (copie : ${copies.join(", ")})` : ""}` }] }, maintenant);
  const bon = bonDeCommande(aEnvoyer, referentiel, etab, {
    ...(fiche.comptes?.find((x) => x.etablissementId === etab.id) ? { numeroClient: fiche.comptes.find((x) => x.etablissementId === etab.id)!.numeroClient } : {}),
    ...(e.reglages.livraison ? { livraison: e.reglages.livraison } : {}),
    email: e.email,
  });
  try {
    await ctx.envoyer({
      ...e.envoi,
      a: fiche.courriel,
      ...(fiche.contact ? { nomA: fiche.contact } : {}),
      ...(copies.length ? { copies } : {}),
      ...(e.expediteur ? { de: e.expediteur } : {}),
      deNom: `${etab.identite.enseigne} · commandes`,
      ...(e.email ? { repondreA: e.email } : {}),
      sujet: bon.sujet,
      html: bon.html,
      texte: bon.texte,
    });
    return enCours;
  } catch (err) {
    const raison = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    // Rien n'est parti : la commande redevient un brouillon, l'échec reste à l'historique.
    const sansEnvoi = contenuDe(enCours);
    delete sansEnvoi.envoi;
    await ecrire(ctx.db, enCours, enCours.version, "brouillon", { ...sansEnvoi, historique: [...enCours.historique, { le: maintenant, par: "serveur", action: `échec de l'envoi : ${raison}` }] }, maintenant).catch(() => undefined);
    throw new ErreurHttp(502, "ENVOI_REFUSE", `La commande n'est pas partie : ${raison}`);
  }
}

/** Le reste ne sera pas livré : la commande se ferme avec ce qui a été reçu. */
export async function solderCommande(db: Db, etablissementId: string, id: string, corps: Record<string, unknown>, par: string, maintenant: string): Promise<CommandeFournisseur> {
  const { c, version } = await verifiee(db, etablissementId, id, corps, ["envoyee"], "solde");
  return ecrire(db, c, version, "soldee", { ...contenuDe(c), historique: [...c.historique, { le: maintenant, par, action: commandeRecue(c) ? "close (tout est reçu)" : "soldée : le reste ne sera pas livré" }] }, maintenant);
}

/**
 * Annule un brouillon, ou une commande envoyée dont rien n'a été reçu (une
 * livraison partielle se solde). Une commande partie par e-mail : le
 * fournisseur est prévenu par e-mail si `prevenir`.
 */
export async function annulerCommande(ctx: ContexteResa, etab: EtablissementApi, id: string, corps: Record<string, unknown>, par: string): Promise<CommandeFournisseur> {
  const maintenant = ctx.maintenant.toISOString();
  const { c, version } = await verifiee(ctx.db, etab.id, id, corps, ["brouillon", "envoyee"], "annulation");
  if (c.receptions.some((r) => !r.annulee)) throw new ErreurHttp(409, "COMMANDE_RECUE", `La commande n° ${c.numero} a déjà été reçue en partie : soldez-la plutôt.`);
  const historique = [...c.historique, { le: maintenant, par, action: "annulée" }];
  let annulee = await ecrire(ctx.db, c, version, "annulee", { ...contenuDe(c), historique }, maintenant);
  if (corps.prevenir === true && c.envoi?.mode === "courriel" && c.envoi.a) {
    const e = await expedition(ctx, etab.id);
    let action = `annulation envoyée par e-mail à ${c.envoi.a}`;
    try {
      if (!e.envoi || !ctx.envoyer) throw new Error("aucune clé d'envoi");
      await ctx.envoyer({
        ...e.envoi,
        a: c.envoi.a,
        ...(c.envoi.copies?.length ? { copies: c.envoi.copies } : {}),
        ...(e.expediteur ? { de: e.expediteur } : {}),
        deNom: `${etab.identite.enseigne} · commandes`,
        ...(e.email ? { repondreA: e.email } : {}),
        sujet: `Annulation · commande n° ${c.numero} · ${etab.identite.enseigne}`,
        html: `<p>Bonjour,</p><p>Merci de <b>ne pas livrer</b> notre commande n° ${c.numero} du ${echapper(dateLisible(journeeParis(c.envoi.le)))} : elle est annulée.</p><p>${echapper(etab.identite.enseigne)} · ${echapper(etab.identite.adresse)}, ${echapper(etab.identite.codePostalVille)}</p>`,
        texte: `Bonjour,\nMerci de ne pas livrer notre commande n° ${c.numero} du ${dateLisible(journeeParis(c.envoi.le))} : elle est annulée.\n${etab.identite.enseigne}`,
      });
    } catch (err) {
      action = `échec de l'e-mail d'annulation : ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`;
    }
    annulee = await ecrire(ctx.db, annulee, annulee.version, "annulee", { ...contenuDe(annulee), historique: [...annulee.historique, { le: maintenant, par: "serveur", action }] }, maintenant);
  }
  return annulee;
}
