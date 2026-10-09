import { clesDeFormule, ficheDeCle, tousLesArticles, type Catalogue } from "@matalon/catalogue";
import type { Ticket } from "@matalon/noyau-fiscal";
import {
  consommationFiche,
  consommationQuantite,
  Couts,
  ecartsInventaire,
  journeeParis,
  MOTIFS_PERTE,
  mouvementsDeSortie,
  normaliserNom,
  prixHT,
  REFERENTIEL_VIDE,
  valoriser,
  type Fiche,
  type Mouvement,
  type PrixAchat,
  type Referentiel,
  type TypeComposant,
  type TypeMouvement,
} from "@matalon/stock";
import { ErreurHttp, type Db } from "./db.js";
import type {
  DocumentStock,
  EtatStock,
  LigneFactureApi,
  MouvementApi,
  RapportFoodCost,
} from "./partage.js";
import { sha256 } from "./securite.js";

/**
 * Stock côté serveur (sous-lots 4b à 4d) : consommation à la réception des
 * ventes, réceptions, inventaires, pertes, transferts, food cost réel, prix
 * fournis par l'agent de factures. Rien de tout cela n'est fiscal : les
 * tickets sont lus, jamais modifiés.
 */

type Requete = { texte: string; params: unknown[] };

export async function lireReferentiel(db: Db): Promise<{ referentiel: Referentiel; version: number; majLe: string; majPar: string | null }> {
  const [r] = await db.requete<{ contenu: Referentiel; version: number; maj_le: string; maj_par: string | null }>(
    "select contenu, version, maj_le, maj_par from stock_referentiel where id = 'groupe'",
  );
  if (!r) return { referentiel: REFERENTIEL_VIDE, version: 0, majLe: "", majPar: null };
  return { referentiel: { ...REFERENTIEL_VIDE, ...r.contenu }, version: r.version, majLe: r.maj_le, majPar: r.maj_par };
}

/** Dernier prix de chaque article fournisseur, dans chaque établissement. */
export async function derniersPrix(db: Db): Promise<PrixAchat[]> {
  const prix = await db.requete<{ article_id: string; etablissement_id: string; prix_ht: number; le: string; source: PrixAchat["source"] }>(
    `select distinct on (article_id, etablissement_id) article_id, etablissement_id, prix_ht, le, source
     from prix_achats order by article_id, etablissement_id, le desc, id desc`,
  );
  return prix.map((p) => ({ articleId: p.article_id, etablissementId: p.etablissement_id, prixHT: p.prix_ht, le: p.le, source: p.source }));
}

async function contexteCouts(db: Db, etablissementId: string): Promise<{ referentiel: Referentiel; couts: Couts }> {
  const { referentiel } = await lireReferentiel(db);
  return { referentiel, couts: new Couts(referentiel, await derniersPrix(db), etablissementId) };
}

/** Insertion de mouvements ; une clé déjà vue est ignorée (renvoi, recalcul). */
export function requetesMouvements(etablissementId: string, mouvements: Mouvement[], par: string | null, creeLe: string): Requete[] {
  const requetes: Requete[] = [];
  for (let i = 0; i < mouvements.length; i += 200) {
    const tranche = mouvements.slice(i, i + 200);
    const valeurs: string[] = [];
    const params: unknown[] = [];
    for (const m of tranche) {
      const b = params.length;
      valeurs.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::jsonb, $${b + 9}, $${b + 10}, $${b + 11})`);
      params.push(etablissementId, m.produitId, m.quantite, m.valeurMicro, m.type, m.le, m.dateComptable, JSON.stringify(m.origine), m.cle ?? null, par, creeLe);
    }
    requetes.push({
      texte: `insert into stock_mouvements (etablissement_id, produit_id, quantite, valeur_micro, type, le, date_comptable, origine, cle, par, cree_le)
              values ${valeurs.join(", ")} on conflict (cle) do nothing`,
      params,
    });
  }
  return requetes;
}

// ───────── 4b : consommation à la vente ─────────

interface CartesVente {
  actuelle: Catalogue | null;
  versions: Array<{ contenu: Catalogue; publiee_le: string }>;
}

async function cartesDe(db: Db, etablissementId: string): Promise<CartesVente> {
  const [e] = await db.requete<{ carte_id: string }>("select carte_id from etablissements where id = $1", [etablissementId]);
  if (!e) return { actuelle: null, versions: [] };
  const [actuelle] = await db.requete<{ contenu: Catalogue }>("select contenu from cartes where id = $1", [e.carte_id]);
  const versions = await db.requete<{ contenu: Catalogue; publiee_le: string }>(
    "select contenu, publiee_le from cartes_versions where carte_id = $1 order by version desc limit 60",
    [e.carte_id],
  );
  return { actuelle: actuelle?.contenu ?? null, versions };
}

/**
 * Fiches consommées par une ligne de ticket : celle de la carte en vigueur à
 * la vente, sinon celle d'aujourd'hui (une fiche ajoutée après coup vaut pour
 * les ventes passées) ; une formule ajoute la fiche de chaque article choisi.
 */
export function fichesDeLigne(cartes: Catalogue[], articleId: string, libelle: string): { fiches: Fiche[]; sansFiche: boolean } {
  const fiche = (cle: string) => cartes.map((c) => ficheDeCle(c, cle)).find(Boolean);
  const fiches: Fiche[] = [];
  const propre = fiche(articleId);
  if (propre) fiches.push(propre);
  const formule = cartes.find((c) => tousLesArticles(c).some((a) => a.id === articleId && a.formule?.length));
  if (formule) {
    const cles = cartes.map((c) => clesDeFormule(c, articleId, libelle)).find(Boolean) ?? null;
    if (!cles) return { fiches, sansFiche: true };
    let manque = false;
    for (const cle of cles) {
      const f = fiche(cle);
      if (f) fiches.push(f);
      else manque = true;
    }
    return { fiches, sansFiche: manque };
  }
  return { fiches, sansFiche: !propre };
}

function mouvementsDesTickets(caisseId: string, tickets: Ticket[], cartes: CartesVente, referentiel: Referentiel, couts: Couts): Mouvement[] {
  const mouvements: Mouvement[] = [];
  for (const t of tickets) {
    if (t.type !== "VENTE" && t.type !== "ANNULATION") continue;
    const enVigueur = cartes.versions.find((v) => v.publiee_le <= t.horodatage)?.contenu;
    const ordre = [enVigueur, cartes.actuelle].filter((c): c is Catalogue => !!c);
    for (const [i, l] of t.lignes.entries()) {
      const { fiches } = fichesDeLigne(ordre, l.articleId, l.libelle);
      if (!fiches.length) continue;
      const total = new Map<string, number>();
      for (const f of fiches) {
        for (const [pid, q] of consommationFiche(referentiel, f, l.quantite).produits) total.set(pid, (total.get(pid) ?? 0) + q);
      }
      mouvements.push(
        ...mouvementsDeSortie(
          couts,
          total,
          {
            type: t.type === "ANNULATION" ? "annulation" : "vente",
            le: t.horodatage,
            dateComptable: t.dateComptable,
            origine: { caisse: caisseId, ticket: t.numero, ligne: i, article: l.articleId, libelle: l.libelle },
          },
          `t:${caisseId}:${t.numero}:${i}`,
        ),
      );
    }
  }
  return mouvements;
}

/** Mouvements de consommation des tickets reçus, à écrire dans le même lot que les tickets. */
export async function consommationDesTickets(db: Db, etablissementId: string, caisseId: string, tickets: Ticket[], maintenant: string): Promise<Requete[]> {
  const ventes = tickets.filter((t) => (t.type === "VENTE" || t.type === "ANNULATION") && t.lignes.length);
  if (!ventes.length) return [];
  const { referentiel, couts } = await contexteCouts(db, etablissementId);
  if (!referentiel.produits.length) return [];
  const cartes = await cartesDe(db, etablissementId);
  return requetesMouvements(etablissementId, mouvementsDesTickets(caisseId, ventes, cartes, referentiel, couts), null, maintenant);
}

/**
 * Recalcule la consommation des ventes d'une période (fiches ajoutées après
 * coup, tickets reçus avant le module) ; seuls les mouvements manquants
 * s'ajoutent. Rend le nombre de mouvements créés.
 */
export async function recalculerConsommation(db: Db, etablissementId: string, du: string, au: string, maintenant: string): Promise<number> {
  const lignes = await db.requete<{ caisse_id: string; contenu: Ticket }>(
    `select e.caisse_id, e.contenu from enregistrements e join caisses c on c.id = e.caisse_id
     where c.etablissement_id = $1 and e.chaine = 'tickets' and e.contenu->>'dateComptable' between $2 and $3 order by e.caisse_id, e.numero`,
    [etablissementId, du, au],
  );
  const { referentiel, couts } = await contexteCouts(db, etablissementId);
  const cartes = await cartesDe(db, etablissementId);
  const parCaisse = new Map<string, Ticket[]>();
  for (const l of lignes) parCaisse.set(l.caisse_id, [...(parCaisse.get(l.caisse_id) ?? []), l.contenu]);
  const mouvements = [...parCaisse].flatMap(([caisse, tickets]) => mouvementsDesTickets(caisse, tickets, cartes, referentiel, couts));
  if (!mouvements.length) return 0;
  const [avant] = await db.requete<{ n: string }>("select count(*) as n from stock_mouvements where etablissement_id = $1", [etablissementId]);
  await db.lot(requetesMouvements(etablissementId, mouvements, null, maintenant));
  const [apres] = await db.requete<{ n: string }>("select count(*) as n from stock_mouvements where etablissement_id = $1", [etablissementId]);
  return Number(apres!.n) - Number(avant!.n);
}

// ───────── Pièces : réceptions, inventaires, pertes, transferts ─────────

const nouvelId = (prefixe: string) => `${prefixe}-${crypto.randomUUID().slice(0, 8)}`;

function entier(v: unknown, ou: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) throw new ErreurHttp(400, "CHAMP_INVALIDE", `${ou} : entier entre ${min} et ${max} attendu.`);
  return v;
}
function texteCourt(v: unknown, ou: string, max: number, requis = false): string {
  if (v === undefined || v === null || v === "") {
    if (requis) throw new ErreurHttp(400, "CHAMP_INVALIDE", `${ou} obligatoire.`);
    return "";
  }
  if (typeof v !== "string" || v.length > max || /[\u0000-\u001f]/.test(v)) throw new ErreurHttp(400, "CHAMP_INVALIDE", `${ou} : texte de ${max} caractères au plus.`);
  return v.trim();
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const lignesDe = (v: unknown, max = 500): Record<string, unknown>[] => {
  if (!Array.isArray(v) || !v.length || v.length > max) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Entre 1 et ${max} lignes.`);
  return v.map((x) => (typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {}));
};

/** Horodatage d'une pièce datée (réception d'hier) : maintenant si c'est aujourd'hui, sinon midi ce jour-là. */
function horodatageDe(date: string, maintenant: string): string {
  const calendrier = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date(maintenant));
  if (date === journeeParis(maintenant) || date === calendrier) return maintenant;
  // Jamais dans le futur : une date à venir prend l'heure réelle.
  const midi = `${date}T12:00:00.000Z`;
  return midi < maintenant ? midi : maintenant;
}

async function enregistrerDocument(db: Db, doc: DocumentStock, mouvements: Mouvement[], autres: Requete[] = []): Promise<void> {
  await db.lot([
    {
      texte: "insert into stock_documents (id, type, etablissement_id, contenu, le, cree_le, par) values ($1, $2, $3, $4::jsonb, $5, $6, $7)",
      params: [doc.id, doc.type, doc.etablissementId, JSON.stringify(doc.contenu), doc.le, doc.creeLe, doc.par],
    },
    ...requetesMouvements(doc.etablissementId, mouvements, doc.par, doc.creeLe),
    ...autres,
  ]);
}

/**
 * Réception fournisseur : chaque ligne entre en stock (nombre de
 * conditionnements × quantité du conditionnement) et son prix devient le
 * dernier prix payé par l'établissement.
 */
export async function receptionner(db: Db, etablissementId: string, corps: Record<string, unknown>, par: string, maintenant: string): Promise<DocumentStock> {
  const { referentiel } = await lireReferentiel(db);
  const fournisseur = texteCourt(corps.fournisseur, "Fournisseur", 80, true);
  const date = typeof corps.date === "string" && DATE.test(corps.date) ? corps.date : journeeParis(maintenant);
  const numero = texteCourt(corps.numero, "Numéro de bon de livraison", 60);
  const le = horodatageDe(date, maintenant);
  const id = nouvelId("rx");
  const lignes = lignesDe(corps.lignes).map((l, i) => {
    const article = referentiel.articles.find((a) => a.id === l.articleId);
    if (!article) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Ligne ${i + 1} : article fournisseur inconnu.`);
    return {
      articleId: article.id,
      produitId: article.produitId,
      /** Nombre de conditionnements, en millièmes (2,5 cartons = 2 500). */
      nombre: entier(l.nombre, `Ligne ${i + 1} : nombre de conditionnements`, 1, 1_000_000_000),
      prixHT: entier(l.prixHT, `Ligne ${i + 1} : prix HT`, 0, 10_000_000),
      quantite: Math.round((article.quantite * Number(l.nombre)) / 1000),
    };
  });
  const totalHT = lignes.reduce((s, l) => s + Math.round((l.prixHT * l.nombre) / 1000), 0);
  const doc: DocumentStock = { id, type: "reception", etablissementId, contenu: { fournisseur, numero, date, lignes, totalHT }, le, creeLe: maintenant, par, annuleLe: null };
  const mouvements: Mouvement[] = lignes.map((l, i) => ({
    produitId: l.produitId,
    quantite: l.quantite,
    valeurMicro: Math.round(l.prixHT * l.nombre * 10),
    type: "reception",
    le,
    dateComptable: date,
    origine: { reception: id, fournisseur, numero, ligne: i },
    cle: `rx:${id}:${i}`,
  }));
  const prix = lignes.map((l) => ({
    texte: "insert into prix_achats (article_id, etablissement_id, prix_ht, le, source, par) values ($1, $2, $3, $4, 'reception', $5)",
    params: [l.articleId, etablissementId, l.prixHT, le, par],
  }));
  await enregistrerDocument(db, doc, mouvements, prix);
  return doc;
}

/** Annule une réception saisie par erreur : les quantités ressortent (les prix restent dans l'historique). */
export async function annulerReception(db: Db, etablissementId: string, id: string, par: string, maintenant: string): Promise<void> {
  const [d] = await db.requete<{ contenu: { lignes: Array<{ produitId: string; quantite: number; prixHT: number; nombre: number }>; date: string }; annule_le: string | null }>(
    "select contenu, annule_le from stock_documents where id = $1 and etablissement_id = $2 and type = 'reception'",
    [id, etablissementId],
  );
  if (!d) throw new ErreurHttp(404, "INTROUVABLE", "Réception introuvable.");
  if (d.annule_le) throw new ErreurHttp(409, "DEJA_ANNULEE", "Cette réception est déjà annulée.");
  const mouvements: Mouvement[] = d.contenu.lignes.map((l, i) => ({
    produitId: l.produitId,
    quantite: -l.quantite,
    valeurMicro: -Math.round(l.prixHT * l.nombre * 10),
    type: "reception",
    le: maintenant,
    dateComptable: journeeParis(maintenant),
    origine: { reception: id, annulation: true, ligne: i },
    cle: `rx:${id}:annule:${i}`,
  }));
  await db.lot([
    { texte: "update stock_documents set annule_le = $2, annule_par = $3 where id = $1 and annule_le is null", params: [id, maintenant, par] },
    ...requetesMouvements(etablissementId, mouvements, par, maintenant),
  ]);
}

/** Stock théorique de l'établissement par produit (quantité et valeur), à l'instant. */
async function theorique(db: Db, etablissementId: string): Promise<Map<string, { quantite: number; valeur: number }>> {
  const lignes = await db.requete<{ produit_id: string; q: string; v: string | null }>(
    "select produit_id, sum(quantite) as q, sum(valeur_micro) as v from stock_mouvements where etablissement_id = $1 group by produit_id",
    [etablissementId],
  );
  return new Map(lignes.map((l) => [l.produit_id, { quantite: Number(l.q), valeur: Number(l.v ?? 0) }]));
}

/**
 * Inventaire (d'une zone, ou de quelques produits) : le compté remplace le
 * théorique ; l'écart devient un mouvement, valorisé au coût du jour.
 * Les produits non comptés ne bougent pas.
 */
export async function inventorier(db: Db, etablissementId: string, corps: Record<string, unknown>, par: string, maintenant: string): Promise<DocumentStock> {
  const { referentiel, couts } = await contexteCouts(db, etablissementId);
  const zone = texteCourt(corps.zone, "Zone", 60);
  const comptes = new Map<string, number>();
  for (const [i, l] of lignesDe(corps.lignes, 5000).entries()) {
    const p = referentiel.produits.find((x) => x.id === l.produitId);
    if (!p) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Ligne ${i + 1} : produit inconnu.`);
    comptes.set(p.id, entier(l.compte, `« ${p.nom} » : quantité comptée`, 0, 1_000_000_000));
  }
  const stock = await theorique(db, etablissementId);
  const theo = new Map([...comptes.keys()].map((pid) => [pid, stock.get(pid)?.quantite ?? 0]));
  const ecarts = ecartsInventaire(comptes, theo);
  // Premier inventaire d'un produit : son écart est le stock d'ouverture (inconnu jusque-là), pas une perte ni un gain.
  const deja = new Set(
    (
      await db.requete<{ produit_id: string }>("select distinct produit_id from stock_mouvements where etablissement_id = $1 and type = 'inventaire' and produit_id = any($2)", [
        etablissementId,
        [...comptes.keys()],
      ])
    ).map((x) => x.produit_id),
  );
  const id = nouvelId("inv");
  const date = journeeParis(maintenant);
  const lignes = [...comptes].map(([produitId, compte]) => ({
    produitId,
    compte,
    theorique: theo.get(produitId) ?? 0,
    ecart: ecarts.get(produitId) ?? 0,
    valeurEcart: valoriser(couts, produitId, ecarts.get(produitId) ?? 0),
    ...(deja.has(produitId) ? {} : { ouverture: true }),
  }));
  const doc: DocumentStock = {
    id,
    type: "inventaire",
    etablissementId,
    contenu: { zone, lignes, valeurEcart: lignes.filter((l) => !l.ouverture).reduce((s, l) => s + (l.valeurEcart ?? 0), 0) },
    le: maintenant,
    creeLe: maintenant,
    par,
    annuleLe: null,
  };
  const mouvements: Mouvement[] = [...ecarts].map(([produitId, ecart]) => ({
    produitId,
    quantite: ecart,
    valeurMicro: valoriser(couts, produitId, ecart),
    type: "inventaire",
    le: maintenant,
    dateComptable: date,
    origine: { inventaire: id, zone, ...(deja.has(produitId) ? {} : { ouverture: true }) },
    cle: `inv:${id}:${produitId}`,
  }));
  await enregistrerDocument(db, doc, mouvements);
  return doc;
}

/** Perte, casse, repas du personnel : un produit ou une préparation, décomposée en produits. */
export async function declarerPerte(db: Db, etablissementId: string, corps: Record<string, unknown>, par: string, maintenant: string): Promise<DocumentStock> {
  const { referentiel, couts } = await contexteCouts(db, etablissementId);
  const motif = texteCourt(corps.motif, "Motif", 60, true);
  if (!(MOTIFS_PERTE as readonly string[]).includes(motif)) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Motif : ${MOTIFS_PERTE.join(", ")}.`);
  const note = texteCourt(corps.note, "Précision", 200);
  const id = nouvelId("pe");
  const date = journeeParis(maintenant);
  const mouvements: Mouvement[] = [];
  const lignes = lignesDe(corps.lignes, 100).map((l, i) => {
    const type = l.type === "recette" ? "recette" : "produit";
    const q = l.quantite as { valeur?: unknown; unite?: unknown } | undefined;
    if (!q || typeof q !== "object" || !["g", "mL", "piece"].includes(String(q.unite))) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Ligne ${i + 1} : quantité invalide.`);
    const quantite = { valeur: entier(q.valeur, `Ligne ${i + 1} : quantité`, 1, 1_000_000_000), unite: q.unite as "g" | "mL" | "piece" };
    const id2 = String(l.id ?? "");
    const comp = type === "produit" ? referentiel.produits.find((p) => p.id === id2) : referentiel.recettes.find((r) => r.id === id2);
    if (!comp) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Ligne ${i + 1} : ${type} inconnu(e).`);
    const { produits, erreurs } = consommationQuantite(referentiel, type as TypeComposant, id2, quantite);
    if (erreurs.length || !produits.size) throw new ErreurHttp(400, "CHAMP_INVALIDE", `« ${comp.nom} » : ${erreurs[0] ?? "quantité inconvertible"}.`);
    mouvements.push(...mouvementsDeSortie(couts, produits, { type: "perte", le: maintenant, dateComptable: date, origine: { perte: id, motif, composant: comp.nom } }, `pe:${id}:${i}`));
    return { type, id: id2, nom: comp.nom, quantite };
  });
  const doc: DocumentStock = {
    id,
    type: "perte",
    etablissementId,
    contenu: { motif, note, lignes, valeur: -mouvements.reduce((s, m) => s + (m.valeurMicro ?? 0), 0) },
    le: maintenant,
    creeLe: maintenant,
    par,
    annuleLe: null,
  };
  await enregistrerDocument(db, doc, mouvements);
  return doc;
}

/** Transfert de produits d'un établissement à un autre, valorisé au coût de l'expéditeur. */
export async function transferer(db: Db, de: string, corps: Record<string, unknown>, par: string, maintenant: string): Promise<DocumentStock> {
  const vers = texteCourt(corps.vers, "Établissement destinataire", 60, true);
  if (vers === de) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Un transfert va vers un autre établissement.");
  const [existe] = await db.requete("select 1 from etablissements where id = $1", [vers]);
  if (!existe) throw new ErreurHttp(404, "ETABLISSEMENT_INCONNU", "Établissement destinataire introuvable.");
  const { referentiel, couts } = await contexteCouts(db, de);
  const id = nouvelId("tr");
  const date = journeeParis(maintenant);
  const lignes = lignesDe(corps.lignes, 200).map((l, i) => {
    const p = referentiel.produits.find((x) => x.id === l.produitId);
    if (!p) throw new ErreurHttp(400, "CHAMP_INVALIDE", `Ligne ${i + 1} : produit inconnu.`);
    return { produitId: p.id, quantite: entier(l.quantite, `« ${p.nom} » : quantité`, 1, 1_000_000_000), valeur: valoriser(couts, p.id, Number(l.quantite)) };
  });
  const doc: DocumentStock = { id, type: "transfert", etablissementId: de, contenu: { vers, lignes }, le: maintenant, creeLe: maintenant, par, annuleLe: null };
  const sorties: Mouvement[] = lignes.map((l) => ({ produitId: l.produitId, quantite: -l.quantite, valeurMicro: l.valeur == null ? null : -l.valeur, type: "transfert", le: maintenant, dateComptable: date, origine: { transfert: id, vers }, cle: `tr:${id}:sortie:${l.produitId}` }));
  const entrees: Mouvement[] = lignes.map((l) => ({ produitId: l.produitId, quantite: l.quantite, valeurMicro: l.valeur, type: "transfert", le: maintenant, dateComptable: date, origine: { transfert: id, de }, cle: `tr:${id}:entree:${l.produitId}` }));
  await enregistrerDocument(db, doc, sorties, requetesMouvements(vers, entrees, par, maintenant));
  return doc;
}

export async function documents(db: Db, etablissementId: string, type: string | null, limite = 100): Promise<DocumentStock[]> {
  const lignes = await db.requete<{ id: string; type: DocumentStock["type"]; etablissement_id: string; contenu: Record<string, unknown>; le: string; cree_le: string; par: string | null; annule_le: string | null }>(
    `select id, type, etablissement_id, contenu, le, cree_le, par, annule_le from stock_documents
     where etablissement_id = $1 and ($2::text is null or type = $2) order by le desc, cree_le desc limit $3`,
    [etablissementId, type, limite],
  );
  return lignes.map((l) => ({ id: l.id, type: l.type, etablissementId: l.etablissement_id, contenu: l.contenu, le: l.le, creeLe: l.cree_le, par: l.par, annuleLe: l.annule_le }));
}

// ───────── État du stock, mouvements ─────────

export async function etatStock(db: Db, etablissementId: string): Promise<EtatStock> {
  const stock = await theorique(db, etablissementId);
  const { referentiel, couts } = await contexteCouts(db, etablissementId);
  const derniers = await db.requete<{ produit_id: string; le: string }>(
    "select produit_id, max(le) as le from stock_mouvements where etablissement_id = $1 and type = 'inventaire' group by produit_id",
    [etablissementId],
  );
  const [inv] = await db.requete<{ le: string | null }>("select max(le) as le from stock_documents where etablissement_id = $1 and type = 'inventaire'", [etablissementId]);
  const dernierParProduit = new Map(derniers.map((d) => [d.produit_id, d.le]));
  return {
    etablissementId,
    dernierInventaire: inv?.le ?? null,
    produits: referentiel.produits
      .filter((p) => p.actif || stock.has(p.id))
      .map((p) => {
        const q = stock.get(p.id)?.quantite ?? 0;
        return { produitId: p.id, quantite: q, valeurMicro: valoriser(couts, p.id, q), dernierInventaire: dernierParProduit.get(p.id) ?? null };
      }),
  };
}

export async function listeMouvements(db: Db, etablissementId: string, f: { du?: string; au?: string; produit?: string; type?: string }, limite = 500): Promise<MouvementApi[]> {
  const lignes = await db.requete<{ id: string; produit_id: string; quantite: string; valeur_micro: string | null; type: TypeMouvement; le: string; date_comptable: string; origine: Record<string, unknown>; par: string | null }>(
    `select id, produit_id, quantite, valeur_micro, type, le, date_comptable, origine, par from stock_mouvements
     where etablissement_id = $1 and ($2::text is null or date_comptable >= $2) and ($3::text is null or date_comptable <= $3)
       and ($4::text is null or produit_id = $4) and ($5::text is null or type = $5)
     order by le desc, id desc limit $6`,
    [etablissementId, f.du ?? null, f.au ?? null, f.produit ?? null, f.type ?? null, limite],
  );
  return lignes.map((l) => ({
    id: Number(l.id),
    produitId: l.produit_id,
    quantite: Number(l.quantite),
    valeurMicro: l.valeur_micro == null ? null : Number(l.valeur_micro),
    type: l.type,
    le: l.le,
    dateComptable: l.date_comptable,
    origine: l.origine,
    par: l.par,
  }));
}

// ───────── 4d : food cost réel ─────────

/**
 * Food cost d'une période : le théorique est le coût des fiches des articles
 * vendus (ventes moins annulations) ; le réel y ajoute pertes et écarts
 * d'inventaire — il n'a de sens qu'avec un inventaire en début et en fin de
 * période. Chiffre d'affaires HT des ventes, net des annulations.
 */
export async function rapportFoodCost(db: Db, etablissementId: string, du: string, au: string): Promise<RapportFoodCost> {
  const { referentiel } = await lireReferentiel(db);
  const tickets = (
    await db.requete<{ contenu: Ticket }>(
      `select e.contenu from enregistrements e join caisses c on c.id = e.caisse_id
       where c.etablissement_id = $1 and e.chaine = 'tickets' and e.contenu->>'type' in ('VENTE', 'ANNULATION') and e.contenu->>'dateComptable' between $2 and $3`,
      [etablissementId, du, au],
    )
  ).map((l) => l.contenu);
  const cartes = await cartesDe(db, etablissementId);
  const toutes = await db.requete<{ produit_id: string; type: TypeMouvement; q: string; v: string | null; n_sans_valeur: string; article: string | null; ouverture: string | null }>(
    `select produit_id, type, origine->>'article' as article, origine->>'ouverture' as ouverture, sum(quantite) as q, sum(valeur_micro) as v,
       count(*) filter (where valeur_micro is null) as n_sans_valeur
     from stock_mouvements where etablissement_id = $1 and date_comptable between $2 and $3 group by produit_id, type, origine->>'article', origine->>'ouverture'`,
    [etablissementId, du, au],
  );
  // Stock d'ouverture (premier inventaire de chaque produit) : ni perte ni gain, hors food cost.
  const mouvements = toutes.filter((m) => m.ouverture !== "true");
  const ouvertureMicro = toutes.filter((m) => m.ouverture === "true").reduce((s, m) => s + Number(m.v ?? 0), 0);
  const familleDe = new Map(referentiel.produits.map((p) => [p.id, p.famille || "Sans famille"]));
  const nomDe = new Map(referentiel.produits.map((p) => [p.id, p.nom]));

  // Chiffre d'affaires HT par clé de vente (une formule compte à son propre nom).
  let caHT = 0;
  const ventes = new Map<string, { libelle: string; quantite: number; caHT: number; avecFiche: boolean }>();
  for (const t of tickets) {
    const enVigueur = cartes.versions.find((v) => v.publiee_le <= t.horodatage)?.contenu;
    const ordre = [enVigueur, cartes.actuelle].filter((c): c is Catalogue => !!c);
    for (const l of t.lignes) {
      const ht = prixHT(l.montantTTC, l.tauxTVA);
      caHT += ht;
      const v = ventes.get(l.articleId) ?? { libelle: l.libelle.replace(/ \(.*\)$/, ""), quantite: 0, caHT: 0, avecFiche: !fichesDeLigne(ordre, l.articleId, l.libelle).sansFiche };
      v.quantite += l.quantite;
      v.caHT += ht;
      ventes.set(l.articleId, v);
    }
  }
  const somme = (types: TypeMouvement[]) => -mouvements.filter((m) => types.includes(m.type)).reduce((s, m) => s + Number(m.v ?? 0), 0);
  const theorique = somme(["vente", "annulation"]);
  const pertes = somme(["perte"]);
  const ecarts = somme(["inventaire"]);
  const achats = -somme(["reception"]);
  const transferts = -somme(["transfert"]);
  const familles = new Map<string, { theorique: number; pertes: number; ecarts: number }>();
  const coutArticle = new Map<string, number>();
  const ecartsProduit = new Map<string, { quantite: number; valeur: number }>();
  for (const m of mouvements) {
    const f = familles.get(familleDe.get(m.produit_id) ?? "Sans famille") ?? { theorique: 0, pertes: 0, ecarts: 0 };
    const v = -Number(m.v ?? 0);
    if (m.type === "vente" || m.type === "annulation") {
      f.theorique += v;
      if (m.article) coutArticle.set(m.article, (coutArticle.get(m.article) ?? 0) + v);
    } else if (m.type === "perte") f.pertes += v;
    else if (m.type === "inventaire") {
      f.ecarts += v;
      const e = ecartsProduit.get(m.produit_id) ?? { quantite: 0, valeur: 0 };
      e.quantite += Number(m.q);
      e.valeur += Number(m.v ?? 0);
      ecartsProduit.set(m.produit_id, e);
    } else continue;
    familles.set(familleDe.get(m.produit_id) ?? "Sans famille", f);
  }
  const [avant] = await db.requete<{ le: string | null }>(
    "select max(le) as le from stock_documents where etablissement_id = $1 and type = 'inventaire' and le < $2",
    [etablissementId, `${du}T05:00:00`],
  );
  const [apres] = await db.requete<{ le: string | null }>(
    "select max(le) as le from stock_documents where etablissement_id = $1 and type = 'inventaire' and le >= $2",
    [etablissementId, `${au}T03:00:00`],
  );
  const sansFiche = [...ventes].filter(([, v]) => !v.avecFiche);
  return {
    du,
    au,
    caHT,
    theoriqueMicro: theorique,
    pertesMicro: pertes,
    ecartsMicro: ecarts,
    achatsMicro: achats,
    transfertsMicro: transferts,
    ouvertureMicro,
    foodCostTheorique: caHT > 0 ? foodCostSurHT(theorique, caHT) : null,
    foodCostReel: caHT > 0 ? foodCostSurHT(theorique + pertes + ecarts, caHT) : null,
    mouvementsSansValeur: mouvements.reduce((s, m) => s + Number(m.n_sans_valeur), 0),
    inventaireAvant: avant?.le ?? null,
    inventaireApres: apres?.le ?? null,
    parFamille: [...familles].map(([famille, f]) => ({ famille, ...f })).sort((a, b) => b.theorique + b.pertes + b.ecarts - (a.theorique + a.pertes + a.ecarts)),
    parArticle: [...ventes]
      .filter(([, v]) => v.avecFiche)
      .map(([cle, v]) => ({ cle, libelle: v.libelle, quantite: v.quantite, caHT: v.caHT, coutMicro: coutArticle.get(cle) ?? 0, foodCost: v.caHT > 0 ? foodCostSurHT(coutArticle.get(cle) ?? 0, v.caHT) : null }))
      .sort((a, b) => b.caHT - a.caHT),
    sansFiche: { caHT: sansFiche.reduce((s, [, v]) => s + v.caHT, 0), articles: sansFiche.map(([cle, v]) => ({ cle, libelle: v.libelle, caHT: v.caHT })).sort((a, b) => b.caHT - a.caHT).slice(0, 30) },
    ecartsProduits: [...ecartsProduit]
      .map(([produitId, e]) => ({ produitId, nom: nomDe.get(produitId) ?? produitId, quantite: e.quantite, valeurMicro: e.valeur }))
      .sort((a, b) => Math.abs(b.valeurMicro) - Math.abs(a.valeurMicro))
      .slice(0, 20),
  };
}

/** Food cost en points de base d'un coût en micro-euros sur un CA HT en centimes. */
const foodCostSurHT = (micro: number, caHT: number) => Math.round(micro / caHT);

// ───────── 4d : agent de factures ─────────

/** Clé d'accès de l'agent : « mpk_ » + 40 caractères ; seule son empreinte est gardée. */
export async function creerCleApi(db: Db, nom: string, maintenant: string): Promise<{ id: string; cle: string }> {
  const octets = crypto.getRandomValues(new Uint8Array(30));
  const cle = `mpk_${[...octets].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 40)}`;
  const id = nouvelId("cle");
  await db.requete("insert into cles_api (id, nom, empreinte, cree_le) values ($1, $2, $3, $4)", [id, nom, await sha256(cle), maintenant]);
  return { id, cle };
}

export async function authentifierCleApi(db: Db, requete: Request, maintenant: string): Promise<{ id: string; nom: string }> {
  const cle = /^Bearer (mpk_[a-z0-9]{40})$/.exec(requete.headers.get("Authorization") ?? "")?.[1];
  if (!cle) throw new ErreurHttp(401, "NON_AUTHENTIFIE", "Clé d'accès manquante.");
  const [c] = await db.requete<{ id: string; nom: string; revoquee_le: string | null }>("select id, nom, revoquee_le from cles_api where empreinte = $1", [await sha256(cle)]);
  if (!c || c.revoquee_le) throw new ErreurHttp(401, "NON_AUTHENTIFIE", "Clé d'accès inconnue ou révoquée.");
  await db.requete("update cles_api set utilisee_le = $2 where id = $1", [c.id, maintenant]);
  return { id: c.id, nom: c.nom };
}

/** Article fournisseur d'une ligne de facture : même fournisseur, puis même référence, sinon libellé déjà rapproché. */
function rapprocher(referentiel: Referentiel, fournisseur: string, reference: string, designation: string) {
  const f = normaliserNom(fournisseur);
  const candidats = referentiel.articles.filter((a) => a.actif && normaliserNom(a.fournisseur) === f);
  if (reference) {
    const parRef = candidats.find((a) => a.reference && normaliserNom(a.reference) === normaliserNom(reference));
    if (parRef) return parRef;
  }
  const d = normaliserNom(designation);
  return candidats.find((a) => a.designations?.some((x) => normaliserNom(x) === d)) ?? null;
}

/**
 * Facture reçue de l'agent : chaque ligne reconnue donne un prix d'achat
 * (source « facture ») ; les autres attendent un rapprochement dans
 * l'administration. Une même ligne de facture ne compte qu'une fois.
 */
export async function recevoirFacture(db: Db, corps: Record<string, unknown>, agent: string, maintenant: string): Promise<{ rapprochees: number; aRapprocher: number; dejaRecues: number }> {
  const etablissementId = texteCourt(corps.etablissementId, "etablissementId", 60, true);
  const [e] = await db.requete("select 1 from etablissements where id = $1", [etablissementId]);
  if (!e) throw new ErreurHttp(404, "ETABLISSEMENT_INCONNU", "Établissement inconnu.");
  const fournisseur = texteCourt(corps.fournisseur, "fournisseur", 80, true);
  const numero = texteCourt(corps.numero, "numero", 60, true);
  const date = typeof corps.date === "string" && DATE.test(corps.date) ? corps.date : (() => {
    throw new ErreurHttp(400, "CHAMP_INVALIDE", "date au format AAAA-MM-JJ.");
  })();
  const { referentiel } = await lireReferentiel(db);
  const requetes: Requete[] = [];
  const bilan = { rapprochees: 0, aRapprocher: 0, dejaRecues: 0 };
  const le = horodatageDe(date, maintenant);
  for (const [i, l] of lignesDe(corps.lignes, 300).entries()) {
    const designation = texteCourt(l.designation, `Ligne ${i + 1} : désignation`, 200, true);
    const reference = texteCourt(l.reference, `Ligne ${i + 1} : référence`, 60);
    const prix = entier(l.prixUnitaireHT, `Ligne ${i + 1} : prix unitaire HT (centimes)`, 0, 10_000_000);
    const cle = `f:${normaliserNom(fournisseur)}:${numero}:${i}`;
    const [deja] = await db.requete("select 1 from factures_lignes where cle = $1", [cle]);
    if (deja) {
      bilan.dejaRecues++;
      continue;
    }
    const article = rapprocher(referentiel, fournisseur, reference, designation);
    requetes.push({
      texte: `insert into factures_lignes (etablissement_id, fournisseur, reference, designation, prix_ht, facture, cle, article_id, statut, recu_le)
              values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) on conflict (cle) do nothing`,
      params: [etablissementId, fournisseur, reference, designation, prix, JSON.stringify({ numero, date, agent }), cle, article?.id ?? null, article ? "rapprochee" : "a_rapprocher", maintenant],
    });
    if (article) {
      requetes.push({
        texte: "insert into prix_achats (article_id, etablissement_id, prix_ht, le, source, par, cle) values ($1, $2, $3, $4, 'facture', $5, $6) on conflict do nothing",
        params: [article.id, etablissementId, prix, le, agent, cle],
      });
      bilan.rapprochees++;
    } else bilan.aRapprocher++;
  }
  if (requetes.length) await db.lot(requetes);
  return bilan;
}

export async function lignesFacture(db: Db, etablissementId: string, toutes: boolean): Promise<LigneFactureApi[]> {
  const lignes = await db.requete<{ id: string; fournisseur: string; reference: string; designation: string; prix_ht: number; facture: { numero: string; date: string }; article_id: string | null; statut: LigneFactureApi["statut"]; recu_le: string }>(
    `select id, fournisseur, reference, designation, prix_ht, facture, article_id, statut, recu_le from factures_lignes
     where etablissement_id = $1 and ($2 or statut = 'a_rapprocher') order by recu_le desc, id limit 300`,
    [etablissementId, toutes],
  );
  return lignes.map((l) => ({ id: Number(l.id), fournisseur: l.fournisseur, reference: l.reference, designation: l.designation, prixHT: l.prix_ht, numero: l.facture.numero, date: l.facture.date, articleId: l.article_id, statut: l.statut, recuLe: l.recu_le }));
}

/**
 * Rapproche une ligne de facture d'un article fournisseur : le prix est
 * enregistré et le libellé retenu (avec la référence si l'article n'en a pas),
 * pour que la ligne soit reconnue d'elle-même la prochaine fois.
 */
export async function rapprocherLigne(
  db: Db,
  id: number,
  articleId: string | null,
  par: string,
  maintenant: string,
  modifierReferentiel: (f: (r: Referentiel) => Referentiel) => Promise<void>,
): Promise<void> {
  const [l] = await db.requete<{ etablissement_id: string; designation: string; reference: string; prix_ht: number; facture: { date: string }; cle: string; statut: string }>(
    "select etablissement_id, designation, reference, prix_ht, facture, cle, statut from factures_lignes where id = $1",
    [id],
  );
  if (!l) throw new ErreurHttp(404, "INTROUVABLE", "Ligne de facture introuvable.");
  if (l.statut !== "a_rapprocher") throw new ErreurHttp(409, "DEJA_TRAITEE", "Cette ligne est déjà traitée.");
  if (!articleId) {
    await db.requete("update factures_lignes set statut = 'ignoree', traite_le = $2, traite_par = $3 where id = $1", [id, maintenant, par]);
    return;
  }
  const { referentiel } = await lireReferentiel(db);
  if (!referentiel.articles.some((a) => a.id === articleId)) throw new ErreurHttp(400, "CHAMP_INVALIDE", "Article fournisseur inconnu.");
  await modifierReferentiel((r) => ({
    ...r,
    articles: r.articles.map((a) => {
      if (a.id !== articleId) return a;
      const designations = [...new Set([...(a.designations ?? []), l.designation])].slice(-20);
      return { ...a, designations, ...(!a.reference && l.reference ? { reference: l.reference } : {}) };
    }),
  }));
  await db.lot([
    { texte: "update factures_lignes set statut = 'rapprochee', article_id = $2, traite_le = $3, traite_par = $4 where id = $1", params: [id, articleId, maintenant, par] },
    {
      texte: "insert into prix_achats (article_id, etablissement_id, prix_ht, le, source, par, cle) values ($1, $2, $3, $4, 'facture', $5, $6) on conflict do nothing",
      params: [articleId, l.etablissement_id, l.prix_ht, horodatageDe(l.facture.date, maintenant), par, l.cle],
    },
  ]);
}

