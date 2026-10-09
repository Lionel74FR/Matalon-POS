import {
  Couts,
  formaterEnUnite,
  formaterQuantite,
  identifiantStock,
  lireDecimal,
  lireLignesImport,
  lireTableau,
  quantiteBrute,
  normaliserNom,
  utilisations,
  versBase,
  type ArticleFournisseur,
  type LigneRecette,
  type Produit,
  type Quantite,
  type RapportImport,
  type Recette,
  type UniteStock,
} from "@matalon/stock";
import type { ReponseStock } from "@matalon/serveur/partage";
import { Archive, Check, ChefHat, FileUp, History, Package, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Modale } from "../ui/communs";
import { centimesDepuisSaisie } from "../ui/communs";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api } from "./api";
import {
  AlertesCout,
  ChampQuantite,
  ChoixComposant,
  composantDe,
  composants,
  coutUnitaire,
  euros,
  eurosMicro,
  LIBELLES_UNITE,
  type Composant,
} from "./stock-commun";
import { lireFichierTableau } from "./tableur";

/** « 1 produit créé », « 5 produits créés », « 2 prix à enregistrer ». */
function nombre(n: number, nom: string, participe: string): string {
  const pluriel = n > 1;
  const accord = pluriel && !participe.startsWith("à ") ? `${participe}s` : participe;
  return `${n} ${pluriel && !nom.endsWith("x") ? `${nom}s` : nom} ${accord}`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const UNITES: UniteStock[] = ["kg", "L", "piece"];
const parUnite = (u: UniteStock) => (u === "piece" ? "pièce" : u);

/**
 * Stock et fiches techniques (lot 4a) : produits et leurs articles
 * fournisseurs, recettes, import des premiers produits. Les produits et
 * recettes sont communs au groupe ; les prix et les coûts affichés sont
 * ceux de l'établissement choisi.
 */
export function Stock() {
  const [stock, setStock] = useState<ReponseStock | null>(null);
  const [erreur, setErreur] = useState("");
  const [onglet, setOnglet] = useState<"produits" | "recettes" | "import">("produits");
  const [etab, setEtab] = useState("");
  useEffect(() => {
    api
      .stock()
      .then((s) => {
        setStock(s);
        setEtab((x) => x || s.etablissements.find((e) => e.id === "moka")?.id || s.etablissements[0]?.id || "");
      })
      .catch((e) => setErreur(message(e)));
  }, []);
  const couts = useMemo(() => (stock ? new Couts(stock.referentiel, stock.prix, etab) : null), [stock, etab]);
  if (!stock || !couts) return <p>{erreur || "Chargement du stock…"}</p>;
  const nomEtab = stock.etablissements.find((e) => e.id === etab)?.enseigne ?? etab;
  const ref = stock.referentiel;

  return (
    <div className="stock">
      <section className="admin-section">
        <div className="stock-tete">
          <h1 className="titre-icone">
            <AvecIcone icone={Package} taille={26}>Stock et fiches techniques</AvecIcone>
          </h1>
          <label className="champ stock-etab">
            <span>Prix et coûts de</span>
            <select value={etab} onChange={(e) => setEtab(e.target.value)}>
              {stock.etablissements.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.enseigne}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="explication">
          Produits et recettes sont communs à tous les établissements. Les prix d'achat sont ceux de chaque établissement : sans achat
          à {nomEtab}, le coût reprend le dernier prix payé ailleurs, signalé « emprunté ». Les fiches techniques se relient à la carte
          dans l'éditeur de carte.
        </p>
        <div className="options" role="tablist">
          {(
            [
              ["produits", `Produits (${ref.produits.filter((p) => p.actif).length})`],
              ["recettes", `Recettes (${ref.recettes.filter((r) => r.actif).length})`],
              ["import", "Importer des produits"],
            ] as const
          ).map(([id, libelle]) => (
            <button key={id} role="tab" aria-selected={onglet === id} className={`option${onglet === id ? " active" : ""}`} onClick={() => setOnglet(id)}>
              {libelle}
            </button>
          ))}
        </div>
      </section>
      {onglet === "produits" && <Produits stock={stock} couts={couts} etab={etab} nomEtab={nomEtab} onStock={setStock} />}
      {onglet === "recettes" && <Recettes stock={stock} couts={couts} nomEtab={nomEtab} onStock={setStock} />}
      {onglet === "import" && <Import etab={etab} nomEtab={nomEtab} onStock={setStock} onTermine={() => setOnglet("produits")} />}
    </div>
  );
}

interface ProprietesOnglet {
  stock: ReponseStock;
  couts: Couts;
  nomEtab: string;
  onStock: (s: ReponseStock) => void;
}

// ───────── Produits ─────────

function Produits(props: ProprietesOnglet & { etab: string }) {
  const ref = props.stock.referentiel;
  const [recherche, setRecherche] = useState("");
  const [famille, setFamille] = useState("");
  const [archives, setArchives] = useState(false);
  const [ouvert, setOuvert] = useState<Produit | null>(null);
  const familles = [...new Set(ref.produits.map((p) => p.famille).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "fr"));
  const n = normaliserNom(recherche);
  const liste = ref.produits
    .filter((p) => (archives || p.actif) && (!famille || p.famille === famille) && (!n || normaliserNom(p.nom).includes(n)))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  return (
    <section className="admin-section">
      <div className="admin-ligne stock-filtres">
        <label className="stock-recherche">
          <Search className="icone" size={18} aria-hidden="true" />
          <input placeholder="Rechercher un produit" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label="Rechercher un produit" />
        </label>
        <select value={famille} onChange={(e) => setFamille(e.target.value)} aria-label="Famille">
          <option value="">Toutes les familles</option>
          {familles.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <label className="case">
          <input type="checkbox" checked={archives} onChange={(e) => setArchives(e.target.checked)} />
          Archivés
        </label>
        <button className="bouton principal" onClick={() => setOuvert({ id: "", nom: recherche.trim(), unite: "kg", actif: true })}>
          <AvecIcone icone={Plus}>Nouveau produit</AvecIcone>
        </button>
      </div>
      {liste.length === 0 ? (
        <p className="explication">{ref.produits.length ? "Aucun produit ne correspond." : "Aucun produit pour l'instant : importez votre liste ou créez le premier."}</p>
      ) : (
        <table className="tableau admin-tableau stock-table">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Compté en</th>
              <th className="nombre">Prix ({props.nomEtab})</th>
              <th className="nombre">Fournisseurs</th>
              <th className="nombre">Recettes</th>
            </tr>
          </thead>
          <tbody>
            {liste.map((p) => {
              const prix = props.couts.prixProduit(p.id);
              const nbArticles = ref.articles.filter((a) => a.produitId === p.id && a.actif).length;
              const enseigne = props.stock.etablissements.find((e) => e.id === prix?.etablissementId)?.enseigne;
              return (
                <tr key={p.id} className={p.actif ? "" : "annule"}>
                  <td>
                    <button className="lien-article" onClick={() => setOuvert(p)}>
                      {p.nom}
                    </button>
                    <small>{[p.famille, p.zone, !p.actif && "archivé"].filter(Boolean).join(" · ")}</small>
                  </td>
                  <td>{LIBELLES_UNITE[p.unite]}</td>
                  <td className="nombre">
                    {prix ? (
                      <>
                        {eurosMicro(coutUnitaire(props.couts, "produit", p.id).micro)} / {parUnite(p.unite)}
                        {prix.source === "emprunte" && <small className="cout-emprunte">emprunté ({enseigne})</small>}
                      </>
                    ) : (
                      <span className="cout-manquant">sans prix</span>
                    )}
                  </td>
                  <td className="nombre">{nbArticles}</td>
                  <td className="nombre">{utilisations(ref, "produit", p.id).length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {ouvert && (
        <ModaleProduit
          key={ouvert.id || "nouveau"}
          produit={ouvert}
          {...props}
          onEnregistre={(s, id) => {
            props.onStock(s);
            setOuvert(s.referentiel.produits.find((x) => x.id === id) ?? null);
          }}
          onFermer={() => setOuvert(null)}
        />
      )}
    </section>
  );
}

function ModaleProduit(props: ProprietesOnglet & { etab: string; produit: Produit; onEnregistre: (s: ReponseStock, id: string) => void; onFermer: () => void }) {
  const ref = props.stock.referentiel;
  const nouveau = !props.produit.id;
  const [p, setP] = useState<Produit>(props.produit);
  const [contenance, setContenance] = useState<Quantite | null>(props.produit.contenance ?? null);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const familles = [...new Set(ref.produits.map((x) => x.famille).filter(Boolean) as string[])];
  const zones = [...new Set(ref.produits.map((x) => x.zone).filter(Boolean) as string[])];
  // Doublons possibles : un nom proche d'un produit existant (accents, casse et ponctuation ignorés).
  const n = normaliserNom(p.nom);
  const proches = n.length >= 3 ? ref.produits.filter((x) => x.id !== p.id && (normaliserNom(x.nom).includes(n) || n.includes(normaliserNom(x.nom)))) : [];
  const usages = p.id ? utilisations(ref, "produit", p.id) : [];
  const articles = ref.articles.filter((a) => a.produitId === p.id);

  const enregistrer = async () => {
    if (!p.nom.trim()) return setErreur("Le nom est obligatoire.");
    if (contenance && contenance.unite === "piece") return setErreur("Le poids ou volume d'une pièce s'indique en g ou en ml.");
    const id = p.id || identifiantStock(p.nom, ref.produits.map((x) => x.id));
    const { contenance: _, ...reste } = p;
    setEnCours(true);
    try {
      const s = await api.enregistrerProduit({ ...reste, id, nom: p.nom.trim(), famille: p.famille?.trim() || undefined, zone: p.zone?.trim() || undefined, ...(contenance ? { contenance } : {}) });
      setErreur("");
      props.onEnregistre(s, id);
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Modale
      large
      titre={nouveau ? "Nouveau produit" : p.nom}
      onFermer={props.onFermer}
      pied={
        <>
          {!nouveau && (
            <button
              className="bouton"
              onClick={() => {
                if (p.actif && usages.length && !window.confirm(`« ${p.nom} » sert dans ${usages.map((r) => r.nom).join(", ")}. L'archiver quand même ? Ces recettes gardent leur ligne.`)) return;
                setP({ ...p, actif: !p.actif });
              }}
            >
              <AvecIcone icone={Archive}>{p.actif ? "Archiver" : "Réactiver"}</AvecIcone>
            </button>
          )}
          <button className="bouton principal" disabled={enCours} onClick={() => void enregistrer()}>
            <AvecIcone icone={Check}>{nouveau ? "Créer le produit" : "Enregistrer"}</AvecIcone>
          </button>
        </>
      }
    >
      {!p.actif && <p className="admin-alerte">Produit archivé : il n'est plus proposé dans les recettes ; enregistrez pour confirmer.</p>}
      <div className="formulaire-colonnes">
        <div>
          <label className="champ">
            <span>Nom</span>
            <input value={p.nom} maxLength={120} autoFocus={nouveau} onChange={(e) => setP({ ...p, nom: e.target.value })} />
          </label>
          {proches.length > 0 && (
            <p className="admin-alerte">
              Déjà dans la liste : {proches.slice(0, 5).map((x) => x.nom).join(", ")}. Un même produit en double couperait son stock et son coût en deux : ajoutez plutôt un
              fournisseur au produit existant.
            </p>
          )}
          <label className="champ">
            <span>
              Compté en
              <small>Unité des inventaires et des recettes</small>
            </span>
            <select value={p.unite} onChange={(e) => setP({ ...p, unite: e.target.value as UniteStock })}>
              {UNITES.map((u) => (
                <option key={u} value={u}>
                  {u === "piece" ? "pièce" : u}
                </option>
              ))}
            </select>
          </label>
          <label className="champ">
            <span>
              Poids ou volume d'une pièce
              <small>Facultatif : 85 g pour un pain, 60 g pour un œuf, 75 cl pour une bouteille</small>
            </span>
            <ChampQuantite valeur={contenance} unite={p.unite === "L" ? "L" : "kg"} libelle="Poids ou volume d'une pièce" onChange={setContenance} />
          </label>
        </div>
        <div>
          <label className="champ">
            <span>Famille</span>
            <input value={p.famille ?? ""} list="stock-familles" maxLength={60} placeholder="Crèmerie, Viandes, Boissons…" onChange={(e) => setP({ ...p, famille: e.target.value })} />
            <datalist id="stock-familles">
              {familles.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <label className="champ">
            <span>Zone de stockage</span>
            <input value={p.zone ?? ""} list="stock-zones" maxLength={60} placeholder="Chambre froide, Réserve, Bar…" onChange={(e) => setP({ ...p, zone: e.target.value })} />
            <datalist id="stock-zones">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </label>
          {usages.length > 0 && <p className="explication">Utilisé dans : {usages.map((r) => r.nom).join(", ")}.</p>}
        </div>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      {nouveau ? (
        <p className="explication">Créez le produit, puis ajoutez ses fournisseurs et leurs prix.</p>
      ) : (
        <ArticlesFournisseurs {...props} produit={props.produit} articles={articles} />
      )}
    </Modale>
  );
}

function ArticlesFournisseurs(props: ProprietesOnglet & { etab: string; produit: Produit; articles: ArticleFournisseur[] }) {
  const ref = props.stock.referentiel;
  const p = props.produit;
  const [erreur, setErreur] = useState("");
  const [historique, setHistorique] = useState<{ articleId: string; lignes: Array<{ etablissementId: string; prixHT: number; le: string; source: string; par: string | null }> } | null>(null);
  const fournisseurs = [...new Set(ref.articles.map((a) => a.fournisseur))].sort((a, b) => a.localeCompare(b, "fr"));
  const dernier = (articleId: string) => props.stock.prix.filter((x) => x.articleId === articleId && x.etablissementId === props.etab).sort((a, b) => b.le.localeCompare(a.le))[0];
  const executer = async (f: () => Promise<ReponseStock>) => {
    try {
      props.onStock(await f());
      setErreur("");
      return true;
    } catch (e) {
      setErreur(message(e));
      return false;
    }
  };

  const ajouter = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const fournisseur = String(f.get("fournisseur") ?? "").trim();
    const q = lireDecimal(String(f.get("quantite") ?? ""));
    const prix = centimesDepuisSaisie(String(f.get("prix") ?? ""));
    if (!fournisseur) return setErreur("Fournisseur obligatoire.");
    if (q == null || q <= 0) return setErreur(`Quantité du conditionnement en ${parUnite(p.unite)} (ex. 6 pour 6 ${parUnite(p.unite)}).`);
    if (prix == null) return setErreur("Prix HT du conditionnement obligatoire (ex. 21,90).");
    const article: ArticleFournisseur = {
      id: identifiantStock(`${p.id} ${fournisseur}`, ref.articles.map((a) => a.id)),
      produitId: p.id,
      fournisseur,
      reference: String(f.get("reference") ?? "").trim() || undefined,
      conditionnement: String(f.get("conditionnement") ?? "").trim(),
      quantite: Math.round(q * 1000),
      actif: true,
    };
    const form = e.currentTarget;
    if ((await executer(() => api.enregistrerArticleFournisseur(article))) && (await executer(() => api.enregistrerPrix(article.id, props.etab, prix)))) form.reset();
  };

  const nouveauPrix = async (a: ArticleFournisseur, texte: string) => {
    const prix = centimesDepuisSaisie(texte);
    if (prix == null) return setErreur("Prix illisible : saisissez par exemple 21,90.");
    await executer(() => api.enregistrerPrix(a.id, props.etab, prix));
  };

  return (
    <>
      <h3>Fournisseurs et prix à {props.nomEtab}</h3>
      {props.articles.length > 0 && (
        <table className="tableau admin-tableau stock-table">
          <thead>
            <tr>
              <th>Fournisseur</th>
              <th>Conditionnement</th>
              <th className="nombre">Prix HT</th>
              <th className="nombre">Prix / {parUnite(p.unite)}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.articles.map((a) => {
              const d = dernier(a.id);
              return (
                <tr key={a.id} className={a.actif ? "" : "annule"}>
                  <td>
                    {a.fournisseur}
                    {a.reference && <small>réf. {a.reference}</small>}
                  </td>
                  <td>
                    {a.conditionnement || "—"}
                    <small>{formaterEnUnite(a.quantite, p.unite)}</small>
                  </td>
                  <td className="nombre">
                    <PrixModifiable prix={d?.prixHT ?? null} le={d?.le} onValider={(t) => void nouveauPrix(a, t)} libelle={`Nouveau prix HT de ${a.fournisseur}`} />
                  </td>
                  <td className="nombre">{d ? eurosMicro(Math.round((d.prixHT * 10_000 * 1000) / a.quantite)) : "—"}</td>
                  <td className="stock-actions">
                    <BoutonIcone
                      icone={History}
                      variante="discret"
                      libelle={`Historique des prix de ${a.fournisseur}`}
                      onClick={() => void api.historiquePrix(a.id).then((r) => setHistorique({ articleId: a.id, lignes: r.prix }))}
                    />
                    <BoutonIcone
                      icone={a.actif ? Trash2 : Plus}
                      variante="discret"
                      libelle={a.actif ? `Ne plus acheter chez ${a.fournisseur}` : `Réactiver ${a.fournisseur}`}
                      onClick={() => void executer(() => api.enregistrerArticleFournisseur({ ...a, actif: !a.actif }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {historique && (
        <div className="stock-historique">
          <strong>Historique des prix</strong>
          <ul>
            {historique.lignes.map((l, i) => (
              <li key={i}>
                {new Date(l.le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} ·{" "}
                {props.stock.etablissements.find((e) => e.id === l.etablissementId)?.enseigne ?? l.etablissementId} · {euros(l.prixHT)} HT · {l.source}
                {l.par ? ` · ${l.par}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <form className="admin-ligne sous-ligne stock-ajout-article" onSubmit={(e) => void ajouter(e)}>
        <input name="fournisseur" placeholder="Fournisseur" list="stock-fournisseurs" maxLength={80} aria-label="Fournisseur" />
        <datalist id="stock-fournisseurs">
          {fournisseurs.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <input name="reference" placeholder="Référence" maxLength={60} aria-label="Référence" />
        <input name="conditionnement" placeholder="Conditionnement (Carton 6 x 1 L)" maxLength={80} aria-label="Conditionnement" />
        <input name="quantite" placeholder={`Quantité en ${parUnite(p.unite)}`} inputMode="decimal" aria-label={`Quantité en ${parUnite(p.unite)}`} />
        <input name="prix" placeholder="Prix HT" inputMode="decimal" aria-label="Prix HT du conditionnement" />
        <button className="bouton">
          <AvecIcone icone={Plus}>Fournisseur</AvecIcone>
        </button>
      </form>
      {erreur && <p className="erreur">{erreur}</p>}
    </>
  );
}

function PrixModifiable(props: { prix: number | null; le?: string | undefined; onValider: (texte: string) => void; libelle: string }) {
  const [edition, setEdition] = useState(false);
  const [texte, setTexte] = useState("");
  if (!edition) {
    return (
      <button className="lien-article" onClick={() => (setTexte(props.prix != null ? (props.prix / 100).toFixed(2).replace(".", ",") : ""), setEdition(true))} title="Nouveau prix">
        {props.prix != null ? euros(props.prix) : "Ajouter un prix"}
        {props.le && <small>{new Date(props.le).toLocaleDateString("fr-FR")}</small>}
      </button>
    );
  }
  return (
    <form
      className="prix-modifiable"
      onSubmit={(e) => {
        e.preventDefault();
        props.onValider(texte);
        setEdition(false);
      }}
    >
      <input value={texte} autoFocus inputMode="decimal" aria-label={props.libelle} onChange={(e) => setTexte(e.target.value)} onBlur={() => setEdition(false)} />
    </form>
  );
}

// ───────── Recettes ─────────

function Recettes(props: ProprietesOnglet) {
  const ref = props.stock.referentiel;
  const [recherche, setRecherche] = useState("");
  const [archives, setArchives] = useState(false);
  const [ouverte, setOuverte] = useState<Recette | null>(null);
  const n = normaliserNom(recherche);
  const liste = ref.recettes.filter((r) => (archives || r.actif) && (!n || normaliserNom(r.nom).includes(n))).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  return (
    <section className="admin-section">
      <div className="admin-ligne stock-filtres">
        <label className="stock-recherche">
          <Search className="icone" size={18} aria-hidden="true" />
          <input placeholder="Rechercher une recette" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label="Rechercher une recette" />
        </label>
        <label className="case">
          <input type="checkbox" checked={archives} onChange={(e) => setArchives(e.target.checked)} />
          Archivées
        </label>
        <button className="bouton principal" onClick={() => setOuverte({ id: "", nom: recherche.trim(), unite: "piece", rendement: 1000, lignes: [], actif: true })}>
          <AvecIcone icone={Plus}>Nouvelle recette</AvecIcone>
        </button>
      </div>
      {liste.length === 0 ? (
        <p className="explication">{ref.recettes.length ? "Aucune recette ne correspond." : "Aucune recette pour l'instant."}</p>
      ) : (
        <table className="tableau admin-tableau stock-table">
          <thead>
            <tr>
              <th>Recette</th>
              <th>Rendement</th>
              <th className="nombre">Coût du lot</th>
              <th className="nombre">Coût unitaire</th>
              <th className="nombre">Lignes</th>
            </tr>
          </thead>
          <tbody>
            {liste.map((r) => {
              const c = props.couts.coutRecette(r);
              return (
                <tr key={r.id} className={r.actif ? "" : "annule"}>
                  <td>
                    <button className="lien-article" onClick={() => setOuverte(r)}>
                      {r.nom}
                    </button>
                    <small>{[r.famille, !r.actif && "archivée"].filter(Boolean).join(" · ")}</small>
                    <AlertesCout cout={c} etablissement={props.nomEtab} />
                  </td>
                  <td>{formaterEnUnite(r.rendement, r.unite)}</td>
                  <td className="nombre">{eurosMicro(c.micro)}</td>
                  <td className="nombre">
                    {eurosMicro(Math.round((c.micro * 1000) / r.rendement))} / {parUnite(r.unite)}
                  </td>
                  <td className="nombre">{r.lignes.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {ouverte && (
        <ModaleRecette
          key={ouverte.id || "nouvelle"}
          recette={ouverte}
          {...props}
          onEnregistre={(s, id) => {
            props.onStock(s);
            setOuverte(s.referentiel.recettes.find((x) => x.id === id) ?? null);
          }}
          onFermer={() => setOuverte(null)}
        />
      )}
    </section>
  );
}

interface LigneEdition {
  cle: number;
  composant: Composant | null;
  quantite: Quantite | null;
  perte: string;
}

function ModaleRecette(props: ProprietesOnglet & { recette: Recette; onEnregistre: (s: ReponseStock, id: string) => void; onFermer: () => void }) {
  const ref = props.stock.referentiel;
  const nouvelle = !props.recette.id;
  const liste = composants(ref, props.recette.id || undefined);
  const [r, setR] = useState<Recette>(props.recette);
  const [rendement, setRendement] = useState<Quantite | null>({ valeur: props.recette.rendement, unite: props.recette.unite === "kg" ? "g" : props.recette.unite === "L" ? "mL" : "piece" });
  const [lignes, setLignes] = useState<LigneEdition[]>(() =>
    props.recette.lignes.map((l, i) => ({
      cle: i,
      composant: liste.find((c) => c.type === l.type && c.id === l.id) ?? null,
      quantite: l.quantite,
      perte: l.perte ? String(l.perte / 100).replace(".", ",") : "",
    })),
  );
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const proches = normaliserNom(r.nom).length >= 3 ? ref.recettes.filter((x) => x.id !== r.id && normaliserNom(x.nom) === normaliserNom(r.nom)) : [];

  /** Recette telle qu'elle serait enregistrée ; null et un message si une ligne est incomplète. */
  const construire = (): { recette: Recette | null; probleme: string } => {
    const base = r.unite === "kg" ? "g" : r.unite === "L" ? "mL" : "piece";
    if (!rendement || rendement.unite !== base) return { recette: null, probleme: `Rendement en ${r.unite === "piece" ? "pièces" : r.unite} (ex. ${r.unite === "piece" ? "1 pièce" : r.unite === "L" ? "1,2 L" : "1 kg"}).` };
    const finales: LigneRecette[] = [];
    for (const l of lignes) {
      if (!l.composant && !l.quantite) continue;
      if (!l.composant) return { recette: null, probleme: "Une ligne n'a pas de produit ou de recette reconnu : choisissez-le dans la liste." };
      if (!l.quantite) return { recette: null, probleme: `Quantité illisible pour « ${l.composant.nom} » (ex. 30 g, 12 cl, 1 pièce).` };
      const perte = l.perte.trim() ? lireDecimal(l.perte) : 0;
      if (perte == null || perte < 0 || perte >= 90) return { recette: null, probleme: `Perte de « ${l.composant.nom} » : un pourcentage entre 0 et 90.` };
      finales.push({ type: l.composant.type, id: l.composant.id, quantite: l.quantite, ...(perte ? { perte: Math.round(perte * 100) } : {}) });
    }
    return {
      recette: { ...r, nom: r.nom.trim(), famille: r.famille?.trim() || undefined, note: r.note?.trim() || undefined, rendement: rendement.valeur, lignes: finales },
      probleme: "",
    };
  };
  const { recette: apercu, probleme } = construire();
  const couts = useMemo(
    () => (apercu ? new Couts({ ...ref, recettes: [...ref.recettes.filter((x) => x.id !== (apercu.id || "__apercu")), { ...apercu, id: apercu.id || "__apercu" }] }, props.stock.prix, props.couts.etablissementId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(apercu), props.stock],
  );
  const total = couts && apercu ? couts.coutRecette({ ...apercu, id: apercu.id || "__apercu" }) : null;

  const enregistrer = async () => {
    if (!r.nom.trim()) return setErreur("Le nom est obligatoire.");
    if (!apercu) return setErreur(probleme);
    if (!apercu.lignes.length) return setErreur("Ajoutez au moins une ligne.");
    const id = r.id || identifiantStock(r.nom, [...ref.recettes.map((x) => x.id), ...ref.produits.map((x) => x.id)]);
    setEnCours(true);
    try {
      const s = await api.enregistrerRecette({ ...apercu, id });
      setErreur("");
      props.onEnregistre(s, id);
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  };

  const maj = (cle: number, f: (l: LigneEdition) => LigneEdition) => setLignes((ls) => ls.map((l) => (l.cle === cle ? f(l) : l)));
  const usages = r.id ? utilisations(ref, "recette", r.id) : [];

  return (
    <Modale
      large
      titre={nouvelle ? "Nouvelle recette" : r.nom}
      onFermer={props.onFermer}
      pied={
        <>
          {!nouvelle && (
            <button
              className="bouton"
              onClick={() => {
                if (r.actif && usages.length && !window.confirm(`« ${r.nom} » sert dans ${usages.map((x) => x.nom).join(", ")}. L'archiver quand même ?`)) return;
                setR({ ...r, actif: !r.actif });
              }}
            >
              <AvecIcone icone={Archive}>{r.actif ? "Archiver" : "Réactiver"}</AvecIcone>
            </button>
          )}
          <button className="bouton principal" disabled={enCours} onClick={() => void enregistrer()}>
            <AvecIcone icone={Check}>{nouvelle ? "Créer la recette" : "Enregistrer"}</AvecIcone>
          </button>
        </>
      }
    >
      {!r.actif && <p className="admin-alerte">Recette archivée : elle n'est plus proposée ; enregistrez pour confirmer.</p>}
      <div className="formulaire-colonnes">
        <div>
          <label className="champ">
            <span>Nom</span>
            <input value={r.nom} maxLength={120} autoFocus={nouvelle} onChange={(e) => setR({ ...r, nom: e.target.value })} />
          </label>
          {proches.length > 0 && <p className="admin-alerte">Une recette porte déjà ce nom.</p>}
          <label className="champ">
            <span>Famille</span>
            <input value={r.famille ?? ""} maxLength={60} placeholder="Sauces, Plats, Desserts…" onChange={(e) => setR({ ...r, famille: e.target.value })} />
          </label>
        </div>
        <div>
          <label className="champ">
            <span>
              Produite en
              <small>Une sauce au kilo ou au litre, un plat à la pièce</small>
            </span>
            <select
              value={r.unite}
              onChange={(e) => {
                const unite = e.target.value as UniteStock;
                setR({ ...r, unite });
                setRendement(unite === "piece" ? { valeur: 1000, unite: "piece" } : unite === "kg" ? { valeur: 1000, unite: "g" } : { valeur: 1000, unite: "mL" });
              }}
            >
              {UNITES.map((u) => (
                <option key={u} value={u}>
                  {u === "piece" ? "pièce" : u}
                </option>
              ))}
            </select>
          </label>
          <label className="champ">
            <span>
              Rendement
              <small>Ce que la recette produit telle qu'écrite (1,2 L, 1 pièce, 10 pièces)</small>
            </span>
            <ChampQuantite valeur={rendement} unite={r.unite} libelle="Rendement" onChange={setRendement} />
          </label>
        </div>
      </div>

      <h3 className="titre-icone">
        <AvecIcone icone={ChefHat} taille={20}>Composition</AvecIcone>
      </h3>
      <table className="tableau admin-tableau stock-lignes">
        <thead>
          <tr>
            <th>Produit ou recette</th>
            <th>Quantité nette</th>
            <th className="nombre">Perte %</th>
            <th className="nombre">Coût</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => {
            const c = l.composant ? composantDe(ref, l.composant.type, l.composant.id) : undefined;
            const q = c && l.quantite ? versBase(l.quantite, c) : null;
            const perte = l.perte.trim() ? lireDecimal(l.perte) : 0;
            const cout = couts && c && q != null && perte != null && perte >= 0 && perte < 90 ? couts.cout(l.composant!.type, l.composant!.id, quantiteBrute(q, Math.round(perte * 100))) : null;
            return (
              <tr key={l.cle}>
                <td>
                  <ChoixComposant liste={liste} valeur={l.composant} libelle={`Ligne ${i + 1} : produit ou recette`} onChange={(x) => maj(l.cle, (y) => ({ ...y, composant: x }))} />
                </td>
                <td>
                  <ChampQuantite valeur={l.quantite} unite={l.composant?.unite ?? null} libelle={`Ligne ${i + 1} : quantité`} onChange={(x) => maj(l.cle, (y) => ({ ...y, quantite: x }))} />
                  {c && l.quantite && q == null && <small className="erreur">Indiquez le poids d'une pièce de « {c.nom} », ou saisissez en {c.unite === "piece" ? "pièces" : c.unite}.</small>}
                </td>
                <td className="nombre">
                  <input className="champ-perte" value={l.perte} inputMode="decimal" placeholder="0" aria-label={`Ligne ${i + 1} : perte en %`} onChange={(e) => maj(l.cle, (y) => ({ ...y, perte: e.target.value }))} />
                </td>
                <td className="nombre">
                  {cout ? eurosMicro(cout.micro) : "—"}
                  {cout && (cout.manquants.length > 0 || cout.emprunts.length > 0) && <small className={cout.manquants.length ? "cout-manquant" : "cout-emprunte"}>{cout.manquants.length ? "sans prix" : "emprunté"}</small>}
                </td>
                <td>
                  <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer la ligne ${i + 1}`} onClick={() => setLignes((ls) => ls.filter((x) => x.cle !== l.cle))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="bouton discret" onClick={() => setLignes((ls) => [...ls, { cle: Math.max(0, ...ls.map((x) => x.cle)) + 1, composant: null, quantite: null, perte: "" }])}>
        <AvecIcone icone={Plus}>Ligne</AvecIcone>
      </button>
      <label className="champ">
        <span>Note (méthode, dressage)</span>
        <textarea value={r.note ?? ""} maxLength={1000} rows={3} onChange={(e) => setR({ ...r, note: e.target.value })} />
      </label>
      {total && apercu && (
        <div className="stock-total">
          <p>
            Coût du lot ({formaterEnUnite(apercu.rendement, apercu.unite)}) : <strong>{eurosMicro(total.micro)} HT</strong> · soit{" "}
            <strong>
              {eurosMicro(Math.round((total.micro * 1000) / apercu.rendement))} / {parUnite(apercu.unite)}
            </strong>{" "}
            à {props.nomEtab}
          </p>
          <AlertesCout cout={total} etablissement={props.nomEtab} />
        </div>
      )}
      {(erreur || (probleme && lignes.length > 0)) && <p className="erreur">{erreur || probleme}</p>}
    </Modale>
  );
}

// ───────── Import ─────────

function Import(props: { etab: string; nomEtab: string; onStock: (s: ReponseStock) => void; onTermine: () => void }) {
  const [tableau, setTableau] = useState<string[][] | null>(null);
  const [colle, setColle] = useState("");
  const [erreur, setErreur] = useState("");
  const [rapport, setRapport] = useState<{ rapport: RapportImport; fait: boolean } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const lecture = tableau ? lireLignesImport(tableau) : null;

  const charger = async (f: File | undefined) => {
    if (!f) return;
    setRapport(null);
    try {
      setTableau(await lireFichierTableau(f));
      setErreur("");
    } catch (e) {
      setErreur(message(e));
    }
  };
  const envoyer = async (simuler: boolean) => {
    if (!tableau) return;
    setEnCours(true);
    try {
      const r = await api.importerStock(props.etab, tableau, simuler);
      setRapport({ rapport: r.rapport, fait: !simuler });
      if (r.stock) props.onStock(r.stock);
      setErreur("");
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <section className="admin-section">
      <h2 className="titre-icone">
        <AvecIcone icone={FileUp} taille={22}>Importer des produits</AvecIcone>
      </h2>
      <p className="explication">
        Une ligne par produit et par fournisseur, première ligne = noms de colonnes : <code>produit</code>, <code>unite</code> (kg, L ou pièce) obligatoires ;{" "}
        <code>famille</code>, <code>zone</code>, <code>fournisseur</code>, <code>reference</code>, <code>conditionnement</code>, <code>quantite</code> (en unité du produit),{" "}
        <code>prix_ht</code> (€ par conditionnement), <code>poids_unitaire_g</code>. Excel (.xlsx), CSV, ou copier-coller depuis le tableur. Un produit déjà connu n'est pas
        recréé ; les prix vont à <strong>{props.nomEtab}</strong>.
      </p>
      <div className="admin-ligne">
        <label className="bouton">
          <AvecIcone icone={Upload}>Choisir un fichier</AvecIcone>
          <input type="file" accept=".xlsx,.csv,.txt,text/csv" hidden onChange={(e) => void charger(e.target.files?.[0])} />
        </label>
      </div>
      <label className="champ">
        <span>Ou collez les cellules copiées depuis Excel</span>
        <textarea
          rows={4}
          value={colle}
          placeholder={"produit\tunite\tfournisseur\tquantite\tprix_ht"}
          onChange={(e) => {
            setColle(e.target.value);
            setRapport(null);
            setTableau(e.target.value.trim() ? lireTableau(e.target.value) : null);
          }}
        />
      </label>
      {erreur && <p className="erreur">{erreur}</p>}
      {lecture && (
        <>
          <p>
            <strong>{lecture.lignes.length}</strong> ligne{lecture.lignes.length > 1 ? "s" : ""} lisible{lecture.lignes.length > 1 ? "s" : ""}
            {lecture.erreurs.length > 0 && <>, {lecture.erreurs.length} à corriger</>}.
          </p>
          {lecture.erreurs.length > 0 && (
            <ul className="erreur">
              {lecture.erreurs.slice(0, 30).map((e) => (
                <li key={`${e.ligne}-${e.message}`}>
                  Ligne {e.ligne} : {e.message}
                </li>
              ))}
            </ul>
          )}
          {lecture.lignes.length > 0 && (
            <table className="tableau admin-tableau stock-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Unité</th>
                  <th>Fournisseur</th>
                  <th>Conditionnement</th>
                  <th className="nombre">Prix HT</th>
                </tr>
              </thead>
              <tbody>
                {lecture.lignes.slice(0, 50).map((l) => (
                  <tr key={l.ligne}>
                    <td>
                      {l.produit}
                      <small>{[l.famille, l.zone].filter(Boolean).join(" · ")}</small>
                    </td>
                    <td>{LIBELLES_UNITE[l.unite]}</td>
                    <td>
                      {l.fournisseur ?? "—"}
                      {l.reference && <small>réf. {l.reference}</small>}
                    </td>
                    <td>
                      {l.conditionnement ?? ""}
                      {l.quantite != null && <small>{formaterEnUnite(l.quantite, l.unite)}</small>}
                    </td>
                    <td className="nombre">{l.prixHT != null ? euros(l.prixHT) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lecture.lignes.length > 50 && <p className="explication">… et {lecture.lignes.length - 50} autres lignes.</p>}
          <div className="admin-ligne">
            <button className="bouton" disabled={enCours || !lecture.lignes.length} onClick={() => void envoyer(true)}>
              <AvecIcone icone={Search}>Vérifier</AvecIcone>
            </button>
            <button className="bouton principal" disabled={enCours || !lecture.lignes.length || !rapport || rapport.fait} onClick={() => void envoyer(false)}>
              <AvecIcone icone={Check}>Importer</AvecIcone>
            </button>
          </div>
        </>
      )}
      {rapport && (
        <div className={rapport.fait ? "admin-ok stock-rapport" : "stock-rapport"}>
          <strong>{rapport.fait ? "Import terminé" : "Vérification (rien n'est encore enregistré)"}</strong>
          <ul>
            <li>
              {nombre(rapport.rapport.produitsCrees.length, "produit", rapport.fait ? "créé" : "à créer")}
              {rapport.rapport.produitsCrees.length > 0 && ` : ${rapport.rapport.produitsCrees.slice(0, 12).join(", ")}${rapport.rapport.produitsCrees.length > 12 ? "…" : ""}`}
            </li>
            {rapport.rapport.produitsExistants.length > 0 && <li>Déjà connus, non recréés : {rapport.rapport.produitsExistants.join(", ")}</li>}
            <li>
              {nombre(rapport.rapport.articlesCrees, "fournisseur", rapport.fait ? "ajouté" : "à ajouter")}, {nombre(rapport.rapport.prixEnregistres, "prix", rapport.fait ? "enregistré" : "à enregistrer")} pour{" "}
              {props.nomEtab}
            </li>
            {rapport.rapport.erreurs.map((e) => (
              <li key={`${e.ligne}-${e.message}`} className="erreur">
                Ligne {e.ligne} : {e.message}
              </li>
            ))}
          </ul>
          {rapport.fait && (
            <button className="bouton" onClick={props.onTermine}>
              <AvecIcone icone={Package}>Voir les produits</AvecIcone>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
