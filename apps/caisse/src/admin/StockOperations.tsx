import { Couts, formaterEnUnite, LIBELLES_MOUVEMENT, lireDecimal, normaliserNom, type Referentiel } from "@matalon/stock";
import type { CleApi, DocumentStock, EtatStock, LigneFactureApi, MouvementApi, RapportFoodCost, ReponseStock } from "@matalon/serveur/partage";
import { ArrowRightLeft, Check, ChartPie, KeyRound, Plus, Receipt, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FormulaireInventaire, FormulairePerte, FormulaireReception, ListePieces, TableauStock } from "../stock/OperationsStock";
import { Modale } from "../ui/communs";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api } from "./api";
import { euros, eurosMicro, pourcent } from "./stock-commun";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const jour = (d = new Date()) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(d);
const decaler = (j: string, n: number) => {
  const d = new Date(`${j}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface Proprietes {
  stock: ReponseStock;
  couts: Couts;
  etab: string;
  nomEtab: string;
  onStock: (s: ReponseStock) => void;
}

// ───────── Stock théorique et pièces ─────────

export function OngletEtat(props: Proprietes) {
  const [etat, setEtat] = useState<EtatStock | null>(null);
  const [pieces, setPieces] = useState<DocumentStock[]>([]);
  const [produit, setProduit] = useState<string | null>(null);
  const [erreur, setErreur] = useState("");
  const charger = useCallback(async () => {
    try {
      const [e, d] = await Promise.all([api.etatStock(props.etab), api.documentsStock(props.etab)]);
      setEtat(e);
      setPieces(d.documents);
    } catch (x) {
      setErreur(message(x));
    }
  }, [props.etab]);
  useEffect(() => {
    void charger();
  }, [charger]);
  if (!etat) return <section className="admin-section">{erreur || "Chargement…"}</section>;
  return (
    <>
      <section className="admin-section">
        <h2>Stock théorique à {props.nomEtab}</h2>
        <TableauStock referentiel={props.stock.referentiel} etat={etat} onProduit={setProduit} />
      </section>
      <section className="admin-section">
        <h2>Pièces</h2>
        <ListePieces
          documents={pieces}
          referentiel={props.stock.referentiel}
          onAnnuler={(d) => {
            if (!window.confirm("Annuler cette réception ? Ses quantités ressortent du stock.")) return;
            void api.annulerReception(props.etab, d.id).then(charger, (x) => setErreur(message(x)));
          }}
        />
        {erreur && <p className="erreur">{erreur}</p>}
      </section>
      {produit && <ModaleMouvements referentiel={props.stock.referentiel} etab={props.etab} produitId={produit} onFermer={() => setProduit(null)} />}
    </>
  );
}

function ModaleMouvements(props: { referentiel: Referentiel; etab: string; produitId: string; onFermer: () => void }) {
  const p = props.referentiel.produits.find((x) => x.id === props.produitId)!;
  const [mouvements, setMouvements] = useState<MouvementApi[] | null>(null);
  useEffect(() => {
    void api.mouvementsStock(props.etab, { produit: props.produitId }).then((r) => setMouvements(r.mouvements));
  }, [props.etab, props.produitId]);
  const origine = (m: MouvementApi) => {
    const o = m.origine;
    if (o.libelle) return `${String(o.libelle)} · ticket ${String(o.ticket)}`;
    if (o.fournisseur) return `${String(o.fournisseur)}${o.numero ? ` · BL ${String(o.numero)}` : ""}${o.annulation ? " · annulée" : ""}`;
    if (o.motif) return `${String(o.motif)} · ${String(o.composant ?? "")}`;
    if (o.zone !== undefined) return o.zone ? `Zone ${String(o.zone)}` : "Inventaire";
    if (o.vers) return `Vers ${String(o.vers)}`;
    if (o.de) return `Depuis ${String(o.de)}`;
    return "";
  };
  return (
    <Modale large titre={`Mouvements : ${p.nom}`} onFermer={props.onFermer}>
      {!mouvements ? (
        <p>Chargement…</p>
      ) : (
        <table className="tableau admin-tableau stock-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Mouvement</th>
              <th className="nombre">Quantité</th>
              <th className="nombre">Valeur HT</th>
            </tr>
          </thead>
          <tbody>
            {mouvements.map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>
                  {LIBELLES_MOUVEMENT[m.type]}
                  <small>{origine(m)}</small>
                </td>
                <td className="nombre">{`${m.quantite > 0 ? "+" : ""}${formaterEnUnite(m.quantite, p.unite)}`}</td>
                <td className="nombre">{m.valeurMicro == null ? "sans prix" : eurosMicro(m.valeurMicro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modale>
  );
}

// ───────── Réception, inventaire, perte (formulaires partagés avec la caisse) ─────────

export function OngletPiece(props: Proprietes & { type: "reception" | "inventaire" | "perte" }) {
  const [etat, setEtat] = useState<EtatStock | null>(null);
  useEffect(() => {
    void api.etatStock(props.etab).then(setEtat);
  }, [props.etab]);
  const envoyer = (type: "receptions" | "inventaires" | "pertes") => async (corps: Record<string, unknown>) => {
    const r = await api.operationStock(type, { ...corps, etablissementId: props.etab });
    setEtat(r.etat);
    if (type === "receptions") props.onStock(await api.stock());
  };
  return (
    <section className="admin-section">
      <p className="surtitre">{props.nomEtab}</p>
      {props.type === "reception" && <FormulaireReception referentiel={props.stock.referentiel} prix={props.stock.prix} etablissementId={props.etab} onEnregistrer={envoyer("receptions")} />}
      {props.type === "inventaire" && (etat ? <FormulaireInventaire key={props.etab} referentiel={props.stock.referentiel} etat={etat} onEnregistrer={envoyer("inventaires")} /> : <p>Chargement…</p>)}
      {props.type === "perte" && <FormulairePerte referentiel={props.stock.referentiel} couts={props.couts} onEnregistrer={envoyer("pertes")} />}
    </section>
  );
}

// ───────── Transfert ─────────

export function OngletTransfert(props: Proprietes) {
  const autres = props.stock.etablissements.filter((e) => e.id !== props.etab);
  const [vers, setVers] = useState(autres[0]?.id ?? "");
  const [lignes, setLignes] = useState<Array<{ cle: number; produitId: string; texte: string }>>([{ cle: 1, produitId: "", texte: "" }]);
  const [etat, setEtat] = useState<{ erreur: string; ok: string }>({ erreur: "", ok: "" });
  const produits = props.stock.referentiel.produits.filter((p) => p.actif).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  if (!autres.length) return <section className="admin-section">Un transfert va d'un établissement à un autre : créez d'abord un second établissement.</section>;
  const valides = lignes
    .map((l) => ({ ...l, p: produits.find((x) => x.id === l.produitId), q: lireDecimal(l.texte) }))
    .filter((l) => l.p && l.q != null && l.q > 0);
  const envoyer = async () => {
    try {
      await api.operationStock("transferts", { etablissementId: props.etab, vers, lignes: valides.map((l) => ({ produitId: l.p!.id, quantite: Math.round(l.q! * 1000) })) });
      setEtat({ erreur: "", ok: `Transfert enregistré : ${valides.length} produit(s) vers ${autres.find((e) => e.id === vers)?.enseigne}.` });
      setLignes([{ cle: 1, produitId: "", texte: "" }]);
    } catch (e) {
      setEtat({ erreur: message(e), ok: "" });
    }
  };
  return (
    <section className="admin-section operation-stock">
      <h2 className="titre-icone">
        <AvecIcone icone={ArrowRightLeft} taille={22}>Transfert depuis {props.nomEtab}</AvecIcone>
      </h2>
      <p className="explication">Les produits sortent du stock de {props.nomEtab} et entrent chez le destinataire, valorisés au coût de {props.nomEtab}.</p>
      <label className="champ">
        <span>Vers</span>
        <select value={vers} onChange={(e) => setVers(e.target.value)}>
          {autres.map((e) => (
            <option key={e.id} value={e.id}>
              {e.enseigne}
            </option>
          ))}
        </select>
      </label>
      <ul className="perte-lignes">
        {lignes.map((l, i) => {
          const p = produits.find((x) => x.id === l.produitId);
          return (
            <li key={l.cle}>
              <select value={l.produitId} aria-label={`Transfert ${i + 1} : produit`} onChange={(e) => setLignes((ls) => ls.map((x) => (x.cle === l.cle ? { ...x, produitId: e.target.value } : x)))}>
                <option value="">Produit…</option>
                {produits.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nom}
                  </option>
                ))}
              </select>
              <input value={l.texte} inputMode="decimal" placeholder={p ? `Quantité en ${p.unite === "piece" ? "pièces" : p.unite}` : "Quantité"} aria-label={`Transfert ${i + 1} : quantité`} onChange={(e) => setLignes((ls) => ls.map((x) => (x.cle === l.cle ? { ...x, texte: e.target.value } : x)))} />
              <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer la ligne ${i + 1}`} onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((x) => x.cle !== l.cle) : ls))} />
            </li>
          );
        })}
      </ul>
      <button className="bouton discret" onClick={() => setLignes((ls) => [...ls, { cle: Math.max(...ls.map((x) => x.cle)) + 1, produitId: "", texte: "" }])}>
        <AvecIcone icone={Plus}>Ligne</AvecIcone>
      </button>
      {etat.erreur && <p className="erreur">{etat.erreur}</p>}
      {etat.ok && <p className="admin-ok">{etat.ok}</p>}
      <button className="bouton principal" disabled={!valides.length || !vers} onClick={() => void envoyer()}>
        <AvecIcone icone={Check}>Transférer</AvecIcone>
      </button>
    </section>
  );
}

// ───────── Food cost ─────────

export function OngletFoodCost(props: Proprietes) {
  const [periode, setPeriode] = useState(() => ({ du: decaler(jour(), -6), au: jour() }));
  const [rapport, setRapport] = useState<RapportFoodCost | null>(null);
  const [erreur, setErreur] = useState("");
  const [recalcul, setRecalcul] = useState("");
  const charger = useCallback(async () => {
    try {
      setRapport(await api.foodCost(props.etab, periode.du, periode.au));
      setErreur("");
    } catch (e) {
      setErreur(message(e));
    }
  }, [props.etab, periode]);
  useEffect(() => {
    void charger();
  }, [charger]);
  const presets: Array<[string, () => { du: string; au: string }]> = [
    ["7 jours", () => ({ du: decaler(jour(), -6), au: jour() })],
    ["30 jours", () => ({ du: decaler(jour(), -29), au: jour() })],
    ["Ce mois", () => ({ du: `${jour().slice(0, 7)}-01`, au: jour() })],
    ["Mois dernier", () => {
      const fin = decaler(`${jour().slice(0, 7)}-01`, -1);
      return { du: `${fin.slice(0, 7)}-01`, au: fin };
    }],
  ];
  const r = rapport;
  return (
    <section className="admin-section">
      <h2 className="titre-icone">
        <AvecIcone icone={ChartPie} taille={22}>Food cost à {props.nomEtab}</AvecIcone>
      </h2>
      <div className="admin-ligne stock-filtres">
        {presets.map(([libelle, f]) => (
          <button key={libelle} className="option" onClick={() => setPeriode(f())}>
            {libelle}
          </button>
        ))}
        <input type="date" value={periode.du} aria-label="Du" onChange={(e) => setPeriode((p) => ({ ...p, du: e.target.value }))} />
        <input type="date" value={periode.au} aria-label="Au" onChange={(e) => setPeriode((p) => ({ ...p, au: e.target.value }))} />
        <BoutonIcone icone={RefreshCw} variante="discret" libelle="Actualiser" onClick={() => void charger()} />
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      {r && (
        <>
          <div className="foodcost-tuiles">
            <div>
              <span>CA HT</span>
              <strong>{euros(r.caHT)}</strong>
            </div>
            <div>
              <span>Food cost théorique</span>
              <strong>{pourcent(r.foodCostTheorique)}</strong>
              <small>{eurosMicro(r.theoriqueMicro)} de fiches</small>
            </div>
            <div>
              <span>Food cost réel</span>
              <strong>{pourcent(r.foodCostReel)}</strong>
              <small>
                + pertes {eurosMicro(r.pertesMicro)} · écarts {eurosMicro(r.ecartsMicro)}
              </small>
            </div>
            <div>
              <span>Achats reçus</span>
              <strong>{eurosMicro(r.achatsMicro)}</strong>
              {r.transfertsMicro !== 0 && <small>transferts nets {eurosMicro(r.transfertsMicro)}</small>}
              {r.ouvertureMicro !== 0 && <small>stock d'ouverture {eurosMicro(r.ouvertureMicro)} (premier inventaire, hors food cost)</small>}
            </div>
          </div>
          {(!r.inventaireAvant || !r.inventaireApres) && (
            <p className="admin-alerte">
              Le food cost réel suppose un inventaire au début et à la fin de la période. Il manque celui{" "}
              {!r.inventaireAvant && !r.inventaireApres ? "du début et celui de la fin" : !r.inventaireAvant ? "du début" : "de la fin"} : sans
              eux, il ne compte que les pertes et les écarts déjà constatés.
            </p>
          )}
          {r.sansFiche.caHT > 0 && (
            <p className="explication">
              <span className="cout-manquant">{euros(r.sansFiche.caHT)} HT</span> de ventes sans fiche technique ({r.caHT ? Math.round((r.sansFiche.caHT / r.caHT) * 100) : 0} % du CA) ne
              comptent pas dans le théorique : {r.sansFiche.articles.slice(0, 8).map((a) => a.libelle).join(", ")}
              {r.sansFiche.articles.length > 8 ? "…" : ""}.
            </p>
          )}
          {r.mouvementsSansValeur > 0 && <p className="explication">{r.mouvementsSansValeur} mouvement(s) sans prix d'achat ne sont pas valorisés.</p>}
          <div className="stat-grille-cartes foodcost-cartes">
            <div>
              <h3>Par article</h3>
              <table className="tableau admin-tableau stock-table">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th className="nombre">Vendus</th>
                    <th className="nombre">CA HT</th>
                    <th className="nombre">Coût</th>
                    <th className="nombre">Food cost</th>
                  </tr>
                </thead>
                <tbody>
                  {r.parArticle.map((a) => (
                    <tr key={a.cle}>
                      <td>{a.libelle}</td>
                      <td className="nombre">{a.quantite}</td>
                      <td className="nombre">{euros(a.caHT)}</td>
                      <td className="nombre">{eurosMicro(a.coutMicro)}</td>
                      <td className="nombre">{pourcent(a.foodCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>Par famille</h3>
              <table className="tableau admin-tableau stock-table">
                <thead>
                  <tr>
                    <th>Famille</th>
                    <th className="nombre">Théorique</th>
                    <th className="nombre">Pertes</th>
                    <th className="nombre">Écarts</th>
                  </tr>
                </thead>
                <tbody>
                  {r.parFamille.map((f) => (
                    <tr key={f.famille}>
                      <td>{f.famille}</td>
                      <td className="nombre">{eurosMicro(f.theorique)}</td>
                      <td className="nombre">{eurosMicro(f.pertes)}</td>
                      <td className="nombre">{eurosMicro(f.ecarts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.ecartsProduits.length > 0 && (
                <>
                  <h3>Plus gros écarts d'inventaire</h3>
                  <table className="tableau admin-tableau stock-table">
                    <tbody>
                      {r.ecartsProduits.map((e) => {
                        const p = props.stock.referentiel.produits.find((x) => x.id === e.produitId);
                        return (
                          <tr key={e.produitId}>
                            <td>{e.nom}</td>
                            <td className="nombre">{p ? formaterEnUnite(e.quantite, p.unite) : e.quantite}</td>
                            <td className="nombre">{eurosMicro(e.valeurMicro)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
          <p className="explication">
            Une fiche ajoutée après coup ? Les ventes de la période peuvent être décomptées à nouveau (seul ce qui manque s'ajoute).{" "}
            <button
              className="bouton discret"
              onClick={() =>
                void api.recalculerConsommation(props.etab, periode.du, periode.au).then(
                  (x) => (setRecalcul(`${x.mouvements} mouvement(s) ajouté(s).`), void charger()),
                  (e) => setRecalcul(message(e)),
                )
              }
            >
              <AvecIcone icone={RefreshCw}>Recalculer la consommation</AvecIcone>
            </button>{" "}
            {recalcul}
          </p>
        </>
      )}
    </section>
  );
}

// ───────── Factures (agent) ─────────

export function OngletFactures(props: Proprietes) {
  const [cles, setCles] = useState<CleApi[]>([]);
  const [nouvelle, setNouvelle] = useState<string | null>(null);
  const [nom, setNom] = useState("Agent de factures");
  const [lignes, setLignes] = useState<LigneFactureApi[]>([]);
  const [choix, setChoix] = useState<Record<number, string>>({});
  const [erreur, setErreur] = useState("");
  const charger = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([api.clesApi(), api.lignesFacture(props.etab)]);
      setCles(c.cles);
      setLignes(l.lignes);
    } catch (e) {
      setErreur(message(e));
    }
  }, [props.etab]);
  useEffect(() => {
    void charger();
  }, [charger]);
  const ref = props.stock.referentiel;
  const nomProduit = (id: string) => ref.produits.find((p) => p.id === id)?.nom ?? id;
  const traiter = async (l: LigneFactureApi, articleId: string | null) => {
    try {
      const r = await api.rapprocherLigne(l.id, articleId);
      props.onStock(r.stock);
      await charger();
    } catch (e) {
      setErreur(message(e));
    }
  };
  return (
    <>
      <section className="admin-section">
        <h2 className="titre-icone">
          <AvecIcone icone={Receipt} taille={22}>Factures à rapprocher ({props.nomEtab})</AvecIcone>
        </h2>
        <p className="explication">
          L'agent de factures dépose les lignes de chaque facture fournisseur. Une ligne reconnue (même fournisseur et même référence, ou libellé déjà rapproché) devient un prix
          d'achat ; les autres attendent ici. Rapprochée une fois, une ligne est reconnue d'elle-même ensuite.
        </p>
        {!lignes.length ? (
          <p className="explication">Rien à rapprocher.</p>
        ) : (
          <table className="tableau admin-tableau stock-table">
            <thead>
              <tr>
                <th>Ligne de facture</th>
                <th className="nombre">Prix HT</th>
                <th>Article fournisseur</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const candidats = ref.articles
                  .filter((a) => a.actif)
                  .sort((a, b) => Number(normaliserNom(b.fournisseur) === normaliserNom(l.fournisseur)) - Number(normaliserNom(a.fournisseur) === normaliserNom(l.fournisseur)) || nomProduit(a.produitId).localeCompare(nomProduit(b.produitId), "fr"));
                return (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.designation}</strong>
                      <small>
                        {l.fournisseur} · facture {l.numero} du {new Date(`${l.date}T12:00:00Z`).toLocaleDateString("fr-FR")}
                        {l.reference ? ` · réf. ${l.reference}` : ""}
                      </small>
                    </td>
                    <td className="nombre">{euros(l.prixHT)}</td>
                    <td>
                      <select value={choix[l.id] ?? ""} aria-label={`Article pour ${l.designation}`} onChange={(e) => setChoix((c) => ({ ...c, [l.id]: e.target.value }))}>
                        <option value="">Choisir…</option>
                        {candidats.map((a) => (
                          <option key={a.id} value={a.id}>
                            {nomProduit(a.produitId)} · {a.fournisseur} · {a.conditionnement || formaterEnUnite(a.quantite, ref.produits.find((p) => p.id === a.produitId)?.unite ?? "piece")}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="stock-actions">
                      <button className="bouton" disabled={!choix[l.id]} onClick={() => void traiter(l, choix[l.id]!)}>
                        <AvecIcone icone={Check}>Rapprocher</AvecIcone>
                      </button>
                      <button className="bouton discret" onClick={() => void traiter(l, null)}>
                        Ignorer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="admin-section">
        <h2 className="titre-icone">
          <AvecIcone icone={KeyRound} taille={22}>Clés d'accès de l'agent</AvecIcone>
        </h2>
        <p className="explication">
          L'agent envoie <code>POST /api/stock/factures</code> avec l'en-tête <code>Authorization: Bearer &lt;clé&gt;</code> et le corps{" "}
          <code>{'{ etablissementId, fournisseur, numero, date, lignes: [{ reference, designation, prixUnitaireHT }] }'}</code> (prix en centimes HT). La clé ne s'affiche qu'à sa création ;
          seule son empreinte est gardée.
        </p>
        {nouvelle && (
          <p className="admin-alerte">
            Clé créée, à copier maintenant dans la configuration de l'agent : <code className="cle-api">{nouvelle}</code>
          </p>
        )}
        <table className="tableau admin-tableau stock-table">
          <tbody>
            {cles.map((c) => (
              <tr key={c.id} className={c.revoqueeLe ? "annule" : ""}>
                <td>
                  {c.nom}
                  <small>
                    créée le {new Date(c.creeLe).toLocaleDateString("fr-FR")}
                    {c.utiliseeLe ? ` · utilisée le ${new Date(c.utiliseeLe).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : " · jamais utilisée"}
                    {c.revoqueeLe ? " · révoquée" : ""}
                  </small>
                </td>
                <td className="stock-actions">
                  {!c.revoqueeLe && (
                    <button className="bouton danger" onClick={() => window.confirm(`Révoquer « ${c.nom} » ? L'agent ne pourra plus envoyer de factures avec cette clé.`) && void api.revoquerCleApi(c.id).then(charger)}>
                      Révoquer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="admin-ligne">
          <input value={nom} maxLength={80} aria-label="Nom de la clé" onChange={(e) => setNom(e.target.value)} />
          <button className="bouton" onClick={() => void api.creerCleApi(nom).then((r) => (setNouvelle(r.cle), void charger()), (e) => setErreur(message(e)))}>
            <AvecIcone icone={Plus}>Créer une clé</AvecIcone>
          </button>
        </div>
        {erreur && <p className="erreur">{erreur}</p>}
      </section>
    </>
  );
}
