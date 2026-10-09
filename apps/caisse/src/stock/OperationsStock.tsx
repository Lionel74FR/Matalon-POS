import {
  Couts,
  formaterEnUnite,
  lireDecimal,
  MOTIFS_PERTE,
  normaliserNom,
  type ArticleFournisseur,
  type PrixAchat,
  type Produit,
  type Quantite,
  type Referentiel,
} from "@matalon/stock";
import type { DocumentStock, EtatStock } from "@matalon/serveur/partage";
import { Check, ClipboardList, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ChampQuantite, ChoixComposant, composants, euros, eurosMicro, type Composant } from "../admin/stock-commun";
import { centimesDepuisSaisie } from "../ui/communs";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import "./stock.css";

/**
 * Pièces du stock communes à la caisse (iPad, iPhone) et à l'administration :
 * inventaire par zone, réception fournisseur, perte. Chaque formulaire rend
 * le corps de la requête ; l'appelant l'envoie au serveur.
 */

const parUnite = (p: Pick<Produit, "unite">) => (p.unite === "piece" ? "pièce" : p.unite);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Saisie décimale à la française en millièmes (« 2,5 » → 2 500) ; null si vide ou illisible. */
function milliemes(texte: string): number | null {
  if (!texte.trim()) return null;
  const n = lireDecimal(texte);
  return n == null || n < 0 ? null : Math.round(n * 1000);
}

function useEnvoi(onEnregistrer: (corps: Record<string, unknown>) => Promise<unknown>) {
  const [etat, setEtat] = useState<{ enCours: boolean; erreur: string; ok: string }>({ enCours: false, erreur: "", ok: "" });
  const envoyer = async (corps: Record<string, unknown>, ok: string, apres?: () => void) => {
    setEtat({ enCours: true, erreur: "", ok: "" });
    try {
      await onEnregistrer(corps);
      setEtat({ enCours: false, erreur: "", ok });
      apres?.();
    } catch (e) {
      setEtat({ enCours: false, erreur: message(e), ok: "" });
    }
  };
  return { ...etat, envoyer };
}

// ───────── Inventaire ─────────

/**
 * Inventaire d'une zone : on compte en conditionnements (cartons, packs) et
 * en unités au détail ; seuls les produits saisis sont inventoriés. Le
 * théorique s'affiche pour repérer une erreur de comptage.
 */
export function FormulaireInventaire(props: { referentiel: Referentiel; etat: EtatStock; onEnregistrer: (corps: Record<string, unknown>) => Promise<unknown> }) {
  const ref = props.referentiel;
  const zones = [...new Set(ref.produits.filter((p) => p.actif).map((p) => p.zone || "Sans zone"))].sort((a, b) => a.localeCompare(b, "fr"));
  const [zone, setZone] = useState(zones[0] ?? "");
  const [recherche, setRecherche] = useState("");
  const [saisies, setSaisies] = useState<Record<string, { colis: string; detail: string }>>({});
  const { enCours, erreur, ok, envoyer } = useEnvoi(props.onEnregistrer);
  const theorique = new Map(props.etat.produits.map((p) => [p.produitId, p.quantite]));
  const n = normaliserNom(recherche);
  const produits = ref.produits
    .filter((p) => p.actif && (n ? normaliserNom(p.nom).includes(n) : (p.zone || "Sans zone") === zone))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  /** Conditionnement de comptage d'un produit : celui de son premier article fournisseur actif. */
  const colisDe = (p: Produit): ArticleFournisseur | undefined => ref.articles.find((a) => a.produitId === p.id && a.actif && a.quantite > 0 && a.conditionnement);
  const compte = (p: Produit): number | null => {
    const s = saisies[p.id];
    if (!s) return null;
    const c = colisDe(p);
    const colis = s.colis.trim() ? milliemes(s.colis) : 0;
    const detail = s.detail.trim() ? milliemes(s.detail) : 0;
    if (colis == null || detail == null) return null;
    if (!s.colis.trim() && !s.detail.trim()) return null;
    return Math.round(((colis ?? 0) * (c?.quantite ?? 0)) / 1000) + (detail ?? 0);
  };
  const comptes = ref.produits.map((p) => [p, compte(p)] as const).filter(([, c]) => c != null) as Array<[Produit, number]>;
  const illisibles = Object.entries(saisies).filter(([id, s]) => (s.colis.trim() || s.detail.trim()) && compte(ref.produits.find((p) => p.id === id)!) == null);

  return (
    <section className="operation-stock">
      <h2 className="titre-icone">
        <AvecIcone icone={ClipboardList} taille={22}>Inventaire</AvecIcone>
      </h2>
      <p className="explication">Comptez ce qui est en stock, zone par zone. Seuls les produits saisis sont inventoriés ; le compté remplace le stock théorique.</p>
      <div className="operation-filtres">
        <div className="options" role="tablist" aria-label="Zone">
          {zones.map((z) => (
            <button key={z} role="tab" aria-selected={z === zone && !recherche} className={`option${z === zone && !recherche ? " active" : ""}`} onClick={() => (setZone(z), setRecherche(""))}>
              {z}
            </button>
          ))}
        </div>
        <label className="operation-recherche">
          <Search className="icone" size={18} aria-hidden="true" />
          <input placeholder="Chercher un produit" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label="Chercher un produit" />
        </label>
      </div>
      <ul className="inventaire-liste">
        {produits.map((p) => {
          const c = colisDe(p);
          const s = saisies[p.id] ?? { colis: "", detail: "" };
          const total = compte(p);
          const maj = (cle: "colis" | "detail", v: string) => setSaisies((x) => ({ ...x, [p.id]: { ...s, [cle]: v } }));
          return (
            <li key={p.id} className={total != null ? "compte" : ""}>
              <span className="inventaire-nom">
                <strong>{p.nom}</strong>
                <small>Théorique : {formaterEnUnite(theorique.get(p.id) ?? 0, p.unite)}</small>
              </span>
              {c && (
                <label className="inventaire-saisie">
                  <input value={s.colis} inputMode="decimal" placeholder="0" aria-label={`${p.nom} : nombre de ${c.conditionnement}`} onChange={(e) => maj("colis", e.target.value)} />
                  <small>× {c.conditionnement}</small>
                </label>
              )}
              <label className="inventaire-saisie">
                <input value={s.detail} inputMode="decimal" placeholder="0" aria-label={`${p.nom} : ${parUnite(p)} au détail`} onChange={(e) => maj("detail", e.target.value)} />
                <small>{c ? `+ ${parUnite(p)}` : parUnite(p)}</small>
              </label>
              <span className="inventaire-total">{total != null ? formaterEnUnite(total, p.unite) : ""}</span>
            </li>
          );
        })}
        {!produits.length && <li className="explication">Aucun produit dans cette zone.</li>}
      </ul>
      {illisibles.length > 0 && <p className="erreur">Quantité illisible pour {illisibles.length} produit(s) : saisissez par exemple 2 ou 1,5.</p>}
      {erreur && <p className="erreur">{erreur}</p>}
      {ok && <p className="admin-ok succes">{ok}</p>}
      <button
        className="bouton principal"
        disabled={enCours || !comptes.length || illisibles.length > 0}
        onClick={() =>
          void envoyer(
            { zone: recherche ? "" : zone, lignes: comptes.map(([p, c]) => ({ produitId: p.id, compte: c })) },
            `Inventaire enregistré : ${comptes.length} produit${comptes.length > 1 ? "s" : ""}.`,
            () => setSaisies({}),
          )
        }
      >
        <AvecIcone icone={Check}>{`Valider l'inventaire (${comptes.length} produit${comptes.length > 1 ? "s" : ""})`}</AvecIcone>
      </button>
    </section>
  );
}

// ───────── Réception ─────────

/** Réception d'une livraison : un fournisseur, ses articles, le nombre de colis et le prix payé. */
export function FormulaireReception(props: { referentiel: Referentiel; prix: PrixAchat[]; etablissementId: string; onEnregistrer: (corps: Record<string, unknown>) => Promise<unknown> }) {
  const ref = props.referentiel;
  const fournisseurs = [...new Set(ref.articles.filter((a) => a.actif).map((a) => a.fournisseur))].sort((a, b) => a.localeCompare(b, "fr"));
  const [fournisseur, setFournisseur] = useState(fournisseurs[0] ?? "");
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date()));
  const [saisies, setSaisies] = useState<Record<string, { nombre: string; prix: string }>>({});
  const { enCours, erreur, ok, envoyer } = useEnvoi(props.onEnregistrer);
  const produit = (id: string) => ref.produits.find((p) => p.id === id);
  const dernier = (articleId: string) => props.prix.filter((p) => p.articleId === articleId && p.etablissementId === props.etablissementId).sort((a, b) => b.le.localeCompare(a.le))[0];
  const articles = ref.articles.filter((a) => a.actif && a.fournisseur === fournisseur).sort((a, b) => (produit(a.produitId)?.nom ?? "").localeCompare(produit(b.produitId)?.nom ?? "", "fr"));
  const lignes = articles
    .map((a) => {
      const s = saisies[a.id];
      const nb = s ? milliemes(s.nombre) : null;
      const prixHT = s?.prix.trim() ? centimesDepuisSaisie(s.prix) : (dernier(a.id)?.prixHT ?? null);
      return { a, nb, prixHT };
    })
    .filter((l) => l.nb != null && l.nb > 0);
  const incompletes = lignes.filter((l) => l.prixHT == null);
  const total = lignes.reduce((s, l) => s + (l.prixHT == null ? 0 : Math.round((l.prixHT * l.nb!) / 1000)), 0);

  return (
    <section className="operation-stock">
      <h2 className="titre-icone">
        <AvecIcone icone={PackagePlus} taille={22}>Réception</AvecIcone>
      </h2>
      <p className="explication">Ce qui est livré entre en stock ; le prix saisi devient le dernier prix payé.</p>
      <div className="operation-entete">
        <label className="champ">
          <span>Fournisseur</span>
          <select value={fournisseur} onChange={(e) => (setFournisseur(e.target.value), setSaisies({}))}>
            {fournisseurs.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="champ">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="champ">
          <span>Bon de livraison</span>
          <input value={numero} maxLength={60} placeholder="N° (facultatif)" onChange={(e) => setNumero(e.target.value)} />
        </label>
      </div>
      {!fournisseurs.length ? (
        <p className="explication">Aucun fournisseur : ajoutez-en aux produits dans l'administration.</p>
      ) : (
        <ul className="inventaire-liste">
          {articles.map((a) => {
            const p = produit(a.produitId);
            const d = dernier(a.id);
            const s = saisies[a.id] ?? { nombre: "", prix: "" };
            return (
              <li key={a.id} className={milliemes(s.nombre) ? "compte" : ""}>
                <span className="inventaire-nom">
                  <strong>{p?.nom ?? a.produitId}</strong>
                  <small>
                    {a.conditionnement || "Conditionnement"} · {p ? formaterEnUnite(a.quantite, p.unite) : ""}
                    {a.reference ? ` · réf. ${a.reference}` : ""}
                  </small>
                </span>
                <label className="inventaire-saisie">
                  <input value={s.nombre} inputMode="decimal" placeholder="0" aria-label={`${p?.nom ?? a.id} : nombre reçu`} onChange={(e) => setSaisies((x) => ({ ...x, [a.id]: { ...s, nombre: e.target.value } }))} />
                  <small>reçu(s)</small>
                </label>
                <label className="inventaire-saisie prix">
                  <input
                    value={s.prix}
                    inputMode="decimal"
                    placeholder={d ? (d.prixHT / 100).toFixed(2).replace(".", ",") : "Prix HT"}
                    aria-label={`${p?.nom ?? a.id} : prix HT du conditionnement`}
                    onChange={(e) => setSaisies((x) => ({ ...x, [a.id]: { ...s, prix: e.target.value } }))}
                  />
                  <small>€ HT</small>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {incompletes.length > 0 && <p className="erreur">Prix HT à saisir pour {incompletes.map((l) => produit(l.a.produitId)?.nom).join(", ")}.</p>}
      {erreur && <p className="erreur">{erreur}</p>}
      {ok && <p className="admin-ok succes">{ok}</p>}
      <button
        className="bouton principal"
        disabled={enCours || !lignes.length || incompletes.length > 0}
        onClick={() =>
          void envoyer(
            { fournisseur, numero, date, lignes: lignes.map((l) => ({ articleId: l.a.id, nombre: l.nb, prixHT: l.prixHT })) },
            `Réception enregistrée : ${lignes.length} article${lignes.length > 1 ? "s" : ""}, ${euros(total)} HT.`,
            () => (setSaisies({}), setNumero("")),
          )
        }
      >
        <AvecIcone icone={Check}>{`Réceptionner · ${euros(total)} HT`}</AvecIcone>
      </button>
    </section>
  );
}

// ───────── Perte ─────────

interface LignePerte {
  cle: number;
  composant: Composant | null;
  quantite: Quantite | null;
}

/** Perte, casse, repas du personnel : produits ou préparations, avec un motif. */
export function FormulairePerte(props: { referentiel: Referentiel; couts: Couts; onEnregistrer: (corps: Record<string, unknown>) => Promise<unknown> }) {
  const liste = useMemo(() => composants(props.referentiel), [props.referentiel]);
  const [motif, setMotif] = useState<string>("");
  const [note, setNote] = useState("");
  const [lignes, setLignes] = useState<LignePerte[]>([{ cle: 1, composant: null, quantite: null }]);
  const { enCours, erreur, ok, envoyer } = useEnvoi(props.onEnregistrer);
  const valides = lignes.filter((l) => l.composant && l.quantite);
  const valeur = valides.reduce((s, l) => s + props.couts.coutFiche({ type: l.composant!.type, id: l.composant!.id, quantite: l.quantite! }).micro, 0);
  const maj = (cle: number, f: (l: LignePerte) => LignePerte) => setLignes((ls) => ls.map((l) => (l.cle === cle ? f(l) : l)));

  return (
    <section className="operation-stock">
      <h2 className="titre-icone">
        <AvecIcone icone={Trash2} taille={22}>Perte</AvecIcone>
      </h2>
      <p className="explication">Ce qui sort du stock sans être vendu. Une préparation (recette) se décompose en ses produits.</p>
      <div className="options" role="radiogroup" aria-label="Motif">
        {MOTIFS_PERTE.map((m) => (
          <button key={m} role="radio" aria-checked={motif === m} className={`option${motif === m ? " active" : ""}`} onClick={() => setMotif(m)}>
            {m}
          </button>
        ))}
      </div>
      <ul className="perte-lignes">
        {lignes.map((l, i) => (
          <li key={l.cle}>
            <ChoixComposant liste={liste} valeur={l.composant} libelle={`Perte ${i + 1} : produit ou recette`} onChange={(c) => maj(l.cle, (x) => ({ ...x, composant: c }))} />
            <ChampQuantite valeur={l.quantite} unite={l.composant?.unite ?? null} libelle={`Perte ${i + 1} : quantité`} onChange={(q) => maj(l.cle, (x) => ({ ...x, quantite: q }))} />
            <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer la ligne ${i + 1}`} onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((x) => x.cle !== l.cle) : ls))} />
          </li>
        ))}
      </ul>
      <button className="bouton discret" onClick={() => setLignes((ls) => [...ls, { cle: Math.max(...ls.map((x) => x.cle)) + 1, composant: null, quantite: null }])}>
        <AvecIcone icone={Plus}>Ligne</AvecIcone>
      </button>
      <label className="champ">
        <span>Précision</span>
        <input value={note} maxLength={200} placeholder="Facultatif" onChange={(e) => setNote(e.target.value)} />
      </label>
      {erreur && <p className="erreur">{erreur}</p>}
      {ok && <p className="admin-ok succes">{ok}</p>}
      <button
        className="bouton principal"
        disabled={enCours || !motif || !valides.length}
        onClick={() =>
          void envoyer(
            { motif, note, lignes: valides.map((l) => ({ type: l.composant!.type, id: l.composant!.id, quantite: l.quantite })) },
            `Perte enregistrée (${motif.toLowerCase()}) : ${eurosMicro(valeur)} HT.`,
            () => (setLignes([{ cle: 1, composant: null, quantite: null }]), setNote("")),
          )
        }
      >
        <AvecIcone icone={Check}>{motif ? `Enregistrer la perte · ${eurosMicro(valeur)} HT` : "Choisissez un motif"}</AvecIcone>
      </button>
    </section>
  );
}

// ───────── Stock théorique ─────────

export function TableauStock(props: { referentiel: Referentiel; etat: EtatStock; onProduit?: (produitId: string) => void }) {
  const [recherche, setRecherche] = useState("");
  const n = normaliserNom(recherche);
  const produits = new Map(props.referentiel.produits.map((p) => [p.id, p]));
  const lignes = props.etat.produits
    .map((l) => ({ ...l, p: produits.get(l.produitId) }))
    .filter((l) => l.p && (!n || normaliserNom(l.p.nom).includes(n)))
    .sort((a, b) => (a.p!.zone ?? "").localeCompare(b.p!.zone ?? "", "fr") || a.p!.nom.localeCompare(b.p!.nom, "fr"));
  const valeur = props.etat.produits.reduce((s, l) => s + Math.max(0, l.valeurMicro ?? 0), 0);
  return (
    <section className="operation-stock">
      <div className="operation-filtres">
        <p className="explication">
          Valeur du stock théorique : <strong>{eurosMicro(valeur)} HT</strong>
          {props.etat.dernierInventaire ? ` · dernier inventaire le ${new Date(props.etat.dernierInventaire).toLocaleDateString("fr-FR")}` : " · aucun inventaire encore"}
        </p>
        <label className="operation-recherche">
          <Search className="icone" size={18} aria-hidden="true" />
          <input placeholder="Chercher un produit" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label="Chercher un produit" />
        </label>
      </div>
      <table className="tableau tableau-stock">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Zone</th>
            <th className="nombre">Stock théorique</th>
            <th className="nombre">Valeur HT</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.produitId} className={l.quantite < 0 ? "negatif" : ""} onClick={() => props.onProduit?.(l.produitId)}>
              <td>
                <strong>{l.p!.nom}</strong>
                {l.dernierInventaire && <small>inventorié le {new Date(l.dernierInventaire).toLocaleDateString("fr-FR")}</small>}
              </td>
              <td>{l.p!.zone ?? "—"}</td>
              <td className="nombre">{formaterEnUnite(l.quantite, l.p!.unite)}</td>
              <td className="nombre">{l.valeurMicro == null ? "sans prix" : eurosMicro(l.valeurMicro)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lignes.some((l) => l.quantite < 0) && <p className="explication">Un stock négatif veut dire des ventes sans réception ni inventaire : faites un premier inventaire.</p>}
    </section>
  );
}

/** Dernières pièces (réceptions, inventaires, pertes, transferts). */
export function ListePieces(props: { documents: DocumentStock[]; referentiel: Referentiel; onAnnuler?: (d: DocumentStock) => void }) {
  const LIBELLES: Record<DocumentStock["type"], string> = { reception: "Réception", inventaire: "Inventaire", perte: "Perte", transfert: "Transfert" };
  const resume = (d: DocumentStock): string => {
    const c = d.contenu as Record<string, unknown>;
    const lignes = (c.lignes as unknown[] | undefined)?.length ?? 0;
    if (d.type === "reception") return `${String(c.fournisseur)}${c.numero ? ` · BL ${String(c.numero)}` : ""} · ${lignes} article(s) · ${euros(Number(c.totalHT ?? 0))} HT`;
    if (d.type === "inventaire") return `${c.zone ? String(c.zone) : "Produits choisis"} · ${lignes} produit(s) · écart ${eurosMicro(Number(c.valeurEcart ?? 0))}`;
    if (d.type === "perte") return `${String(c.motif)} · ${eurosMicro(Number(c.valeur ?? 0))} HT`;
    return `Vers ${String(c.vers)} · ${lignes} produit(s)`;
  };
  if (!props.documents.length) return <p className="explication">Aucune pièce pour l'instant.</p>;
  return (
    <ul className="pieces-liste">
      {props.documents.map((d) => (
        <li key={d.id} className={d.annuleLe ? "annulee" : ""}>
          <span>
            <span>
              <strong>{LIBELLES[d.type]}</strong> · {new Date(d.le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
            </span>
            <small>
              {resume(d)}
              {d.par ? ` · ${d.par}` : ""}
              {d.annuleLe ? " · annulée" : ""}
            </small>
          </span>
          {props.onAnnuler && d.type === "reception" && !d.annuleLe && (
            <button className="bouton discret" onClick={() => props.onAnnuler!(d)}>
              Annuler
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

