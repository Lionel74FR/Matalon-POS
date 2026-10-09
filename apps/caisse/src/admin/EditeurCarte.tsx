import {
  emplacementsFiches,
  postesDeLaCarte,
  fusionImpossible,
  fusionnerCategories,
  identifiantDepuisNom,
  lireCatalogue,
  tousLesArticles,
  validerCatalogue,
  type Article,
  type Catalogue,
  type Categorie,
  type ChoixFormule,
  type Supplement,
  type Variante,
} from "@matalon/catalogue";
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, ChefHat, Merge, Pencil, Plus, Printer, RotateCw, Save, Trash2, Undo2, X } from "lucide-react";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import type { ReponseStock, ReponseVentesCarte, ResumeCarte } from "@matalon/serveur/partage";
import { Couts, foodCost } from "@matalon/stock";
import { EditeurFiche, pourcent } from "./stock-commun";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { centimesDepuisSaisie, saisieDepuisCentimes } from "../ui/communs";
import { api, ErreurAdmin } from "./api";

const TAUX = [
  { valeur: 1000, libelle: "10 % (sur place)" },
  { valeur: 2000, libelle: "20 % (alcool)" },
  { valeur: 550, libelle: "5,5 % (à emporter)" },
];
const euros = (c: number | null | undefined) => (c == null ? "—" : (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Échange une catégorie avec la précédente ou la suivante du même rayon. */
function deplacerDansRayon(cats: Categorie[], i: number, sens: -1 | 1): Categorie[] {
  const rayon = cats[i]!.rayon;
  let j = i + sens;
  while (j >= 0 && j < cats.length && cats[j]!.rayon !== rayon) j += sens;
  if (j < 0 || j >= cats.length) return cats;
  const copie = [...cats];
  [copie[i], copie[j]] = [copie[j]!, copie[i]!];
  return copie;
}

function deplacer<T>(liste: T[], i: number, sens: -1 | 1): T[] {
  const j = i + sens;
  if (j < 0 || j >= liste.length) return liste;
  const copie = [...liste];
  [copie[i], copie[j]] = [copie[j]!, copie[i]!];
  return copie;
}

// ───────── Liste des cartes ─────────

export function ListeCartes(props: { cartes: ResumeCarte[]; onOuvrir: (id: string) => void; onCree: (id: string) => void }) {
  const [nom, setNom] = useState("");
  const [depuis, setDepuis] = useState(props.cartes[0]?.id ?? "");
  const [erreur, setErreur] = useState("");
  const creer = async (e: FormEvent) => {
    e.preventDefault();
    const id = identifiantDepuisNom(nom, props.cartes.map((c) => c.id));
    try {
      await api.creerCarte({ id, nom: nom.trim(), ...(depuis ? { depuis } : {}) });
      props.onCree(id);
    } catch (x) {
      setErreur(message(x));
    }
  };
  return (
    <>
      <section className="admin-section">
        <h1 className="titre-icone">
          <AvecIcone icone={BookOpen} taille={26}>Cartes</AvecIcone>
        </h1>
        <p className="explication">
          Une carte peut servir à plusieurs établissements ; chacun choisit la sienne dans sa fiche. Une modification enregistrée
          arrive sur les iPad à la synchronisation suivante, en moins d'une minute quand ils sont en ligne.
        </p>
        <table className="tableau admin-tableau">
          <thead>
            <tr>
              <th>Carte</th>
              <th className="nombre">Articles</th>
              <th>Établissements</th>
              <th>Dernière modification</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.cartes.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.nom}</strong>
                  <br />
                  <small>
                    {c.id} · version {c.version}
                  </small>
                </td>
                <td className="nombre">{c.nbArticles}</td>
                <td>{c.etablissements.join(", ") || "—"}</td>
                <td>
                  {new Date(c.majLe).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  {c.majPar ? ` · ${c.majPar}` : ""}
                </td>
                <td>
                  <button className="bouton" onClick={() => props.onOuvrir(c.id)}>
                    <AvecIcone icone={Pencil}>Modifier</AvecIcone>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <form className="admin-section" onSubmit={(e) => void creer(e)}>
        <h2 className="titre-icone">
          <AvecIcone icone={Plus} taille={22}>Nouvelle carte</AvecIcone>
        </h2>
        <div className="admin-ligne">
          <input placeholder="Nom (ex. Carte hiver 2026)" value={nom} onChange={(e) => setNom(e.target.value)} required maxLength={80} />
          <select value={depuis} onChange={(e) => setDepuis(e.target.value)} aria-label="Point de départ">
            <option value="">Carte vide</option>
            {props.cartes.map((c) => (
              <option key={c.id} value={c.id}>
                Copie de {c.nom}
              </option>
            ))}
          </select>
          <button className="bouton principal">
            <AvecIcone icone={Plus}>Créer</AvecIcone>
          </button>
        </div>
        {erreur && <p className="erreur">{erreur}</p>}
      </form>
    </>
  );
}

// ───────── Éditeur ─────────

/**
 * Édition d'une carte entière, enregistrée d'un bloc : catégories (rayon,
 * ordre), articles (prix, TVA, disponibilité), variantes, suppléments,
 * formules. Les contrôles sont ceux du serveur, appliqués avant l'envoi.
 */
export function EditeurCarte(props: { id: string; onRetour: () => void; onEnregistre: () => void; onModifiee?: (modifiee: boolean) => void }) {
  const [origine, setOrigine] = useState<{ carte: Catalogue; version: number } | null>(null);
  const [carte, setCarte] = useState<Catalogue | null>(null);
  const [catId, setCatId] = useState<string | null>(null);
  const [articleOuvert, setArticleOuvert] = useState<{ catId: string; article: Article; nouveau: boolean } | null>(null);
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [etat, setEtat] = useState<"" | "envoi" | "enregistre" | "conflit">("");
  const [erreurAjout, setErreurAjout] = useState("");
  /** Stock et ventes : fiches techniques, coûts et part du CA couverte (facultatifs : l'éditeur marche sans). */
  const [stock, setStock] = useState<ReponseStock | null>(null);
  const [ventes, setVentes] = useState<ReponseVentesCarte | null>(null);
  const [etab, setEtab] = useState("");
  useEffect(() => {
    api
      .stock()
      .then((s) => {
        setStock(s);
        setEtab(s.etablissements.find((e) => e.carteId === props.id)?.id ?? s.etablissements[0]?.id ?? "");
      })
      .catch(() => setStock(null));
    api.ventesCarte(props.id).then(setVentes, () => setVentes(null));
  }, [props.id]);
  const couts = useMemo(() => (stock ? new Couts(stock.referentiel, stock.prix, etab) : null), [stock, etab]);
  const nomEtab = stock?.etablissements.find((e) => e.id === etab)?.enseigne ?? "";

  const charger = async () => {
    const r = await api.carte(props.id);
    setOrigine(r);
    setCarte(structuredClone(r.carte));
    setCatId((c) => c ?? r.carte.categories[0]?.id ?? null);
    setErreurs([]);
    setEtat("");
  };
  useEffect(() => {
    void charger().catch((e) => setErreurs([message(e)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id]);

  const modifiee = !!carte && !!origine && JSON.stringify(carte) !== JSON.stringify(origine.carte);
  const signaler = props.onModifiee;
  useEffect(() => {
    signaler?.(modifiee);
  }, [modifiee, signaler]);
  useEffect(() => {
    if (!modifiee) return;
    const avertir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avertir);
    return () => window.removeEventListener("beforeunload", avertir);
  }, [modifiee]);

  const rayons = useMemo(() => [...new Set(carte?.categories.map((c) => c.rayon) ?? [])], [carte]);
  if (!carte || !origine) return <p>{erreurs[0] ?? "Chargement de la carte…"}</p>;

  const categorie = carte.categories.find((c) => c.id === catId) ?? null;
  // Fiches techniques : emplacements (articles, variantes, suppléments) hors formules, qui consomment les fiches des choix.
  const emplacements = emplacementsFiches(carte).filter((e) => !e.formule);
  const avecFiche = emplacements.filter((e) => e.fiche);
  const caCarte = ventes ? emplacements.reduce((s, e) => s + (ventes.parCle[e.cle] ?? 0), 0) : 0;
  const caCouvert = ventes && caCarte > 0 ? emplacements.reduce((s, e) => s + (e.fiche ? (ventes.parCle[e.cle] ?? 0) : 0), 0) / caCarte : null;
  const resumeFiche = (a: Article): string => {
    const siens = emplacements.filter((e) => e.articleId === a.id && !e.cle.includes("+"));
    if (a.formule?.length) return "formule";
    if (!couts || !siens.length) return "";
    const fichees = siens.filter((e) => e.fiche);
    if (fichees.length < siens.length) return fichees.length ? `${fichees.length}/${siens.length} fiches` : "sans fiche";
    const fcs = fichees.map((e) => foodCost(couts.coutFiche(e.fiche!).micro, e.prixTTC, e.tauxTVA)).filter((x): x is number => x != null);
    if (!fcs.length) return "fiche";
    const min = Math.min(...fcs);
    const max = Math.max(...fcs);
    return min === max ? pourcent(min) : `${pourcent(min)} – ${pourcent(max)}`;
  };
  const idsArticles = () => [...tousLesArticles(carte).map((a) => a.id), ...tousLesArticles(origine.carte).map((a) => a.id)];
  const majCategories = (f: (cats: Categorie[]) => Categorie[]) => {
    setCarte({ ...carte, categories: f(carte.categories) });
    setEtat("");
  };
  const majCategorie = (id: string, f: (c: Categorie) => Categorie) => majCategories((cats) => cats.map((c) => (c.id === id ? f(c) : c)));

  const enregistrer = async (surVersion = origine.version) => {
    const lu = lireCatalogue(carte);
    const problemes = lu.catalogue ? validerCatalogue(lu.catalogue) : lu.erreurs;
    setErreurs(problemes);
    if (problemes.length) return;
    setEtat("envoi");
    try {
      const r = await api.enregistrerCarte(props.id, lu.catalogue!, surVersion);
      setOrigine(r);
      setCarte(structuredClone(r.carte));
      setEtat("enregistre");
      props.onEnregistre();
    } catch (e) {
      if (e instanceof ErreurAdmin && e.code === "VERSION_DEPASSEE") setEtat("conflit");
      else {
        setEtat("");
        setErreurs([message(e)]);
      }
    }
  };

  const ajouterCategorie = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const nom = String(f.get("nom") ?? "").trim();
    const rayon = String(f.get("rayon") ?? "").trim();
    if (!nom || !rayon) return;
    const id = identifiantDepuisNom(nom, [...carte.categories, ...origine.carte.categories].map((c) => c.id));
    majCategories((cats) => [...cats, { id, nom, rayon, articles: [] }]);
    setCatId(id);
    e.currentTarget.reset();
  };

  /** Formules qui citent une catégorie ou des articles (à prévenir avant suppression). */
  const formulesCitant = (catIds: string[], artIds: string[]) =>
    tousLesArticles(carte)
      .filter((a) => a.formule?.some((ch) => ch.categories?.some((x) => catIds.includes(x)) || ch.articles?.some((x) => artIds.includes(x))))
      .map((a) => a.nom);

  /** Retire des formules les références à ce qui est supprimé ; un choix vidé de tout est retiré. */
  const purger = (cats: Categorie[], catIds: string[], artIds: string[]): Categorie[] =>
    cats.map((c) => ({
      ...c,
      articles: c.articles.map((a) => {
        if (!a.formule) return a;
        const formule = a.formule
          .map((ch) => ({
            ...ch,
            categories: ch.categories?.filter((x) => !catIds.includes(x)),
            articles: ch.articles?.filter((x) => !artIds.includes(x)),
          }))
          .filter((ch) => ch.categories?.length || ch.articles?.length);
        return { ...a, formule };
      }),
    }));

  const supprimer = (catIds: string[], artIds: string[], libelle: string) => {
    const citees = formulesCitant(catIds, artIds);
    const avertissement = citees.length ? `\n\nCité dans les formules : ${citees.join(", ")}. Ces choix seront retirés des formules.` : "";
    if (!window.confirm(`Supprimer ${libelle} ?${avertissement}`)) return false;
    majCategories((cats) =>
      purger(
        cats.filter((c) => !catIds.includes(c.id)).map((c) => ({ ...c, articles: c.articles.filter((a) => !artIds.includes(a.id)) })),
        catIds,
        artIds,
      ),
    );
    return true;
  };

  const supprimerCategorie = (c: Categorie) => {
    const libelle = c.articles.length ? `« ${c.nom} » et ses ${c.articles.length} articles` : `« ${c.nom} »`;
    if (supprimer([c.id], c.articles.map((a) => a.id), libelle)) setCatId(carte.categories.find((x) => x.id !== c.id)?.id ?? null);
  };

  /** Fusionne la catégorie affichée dans une autre (même taux de TVA) ; elle disparaît, ses articles passent dans l'autre. */
  const fusionnerDans = (source: Categorie, cibleId: string) => {
    const cible = carte.categories.find((c) => c.id === cibleId);
    if (!cible) return;
    const raison = fusionImpossible(source, cible);
    if (raison) return window.alert(`Fusion impossible : ${raison}.`);
    const n = source.articles.length;
    if (!window.confirm(`Fusionner « ${source.nom} » dans « ${cible.nom} » ? ${n ? `Ses ${n} article${n > 1 ? "s" : ""} passent dans « ${cible.nom} », ` : ""}les formules qui la proposaient proposeront « ${cible.nom} », et « ${source.nom} » disparaît.`)) return;
    setCarte(fusionnerCategories(carte, source.id, cible.id));
    setEtat("");
    setCatId(cible.id);
  };

  const ajouterArticle = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!categorie) return;
    const f = new FormData(e.currentTarget);
    const nom = String(f.get("nom") ?? "").trim();
    if (!nom) return;
    const saisie = String(f.get("prix") ?? "").trim();
    const prix = saisie ? centimesDepuisSaisie(saisie) : null;
    if (saisie && prix == null) return setErreurAjout(`Prix illisible : « ${saisie} ». Saisissez par exemple 4,50.`);
    setErreurAjout("");
    const article: Article = { id: identifiantDepuisNom(nom, idsArticles()), nom, prixTTC: prix, tauxTVA: Number(f.get("tva")) };
    if (prix == null) article.aCompleter = "Prix à fixer";
    majCategorie(categorie.id, (c) => ({ ...c, articles: [...c.articles, article] }));
    e.currentTarget.reset();
  };

  const enregistrerArticle = (catCible: string, a: Article) => {
    if (!articleOuvert) return;
    majCategories((cats) =>
      cats.map((c) => {
        const sans = c.articles.filter((x) => x.id !== a.id);
        if (c.id !== catCible) return { ...c, articles: sans };
        const i = c.articles.findIndex((x) => x.id === a.id);
        return { ...c, articles: i >= 0 ? c.articles.map((x) => (x.id === a.id ? a : x)) : [...sans, a] };
      }),
    );
    setArticleOuvert(null);
  };

  return (
    <div className="editeur-carte">
      <header className="admin-fiche-tete editeur-tete">
        <div>
          <button className="bouton discret" onClick={props.onRetour}>
            <AvecIcone icone={ArrowLeft}>Cartes</AvecIcone>
          </button>
          <p className="surtitre">
            {carte.id} · version {origine.version}
          </p>
          <input className="editeur-nom" value={carte.nom} onChange={(e) => setCarte({ ...carte, nom: e.target.value })} aria-label="Nom de la carte" />
        </div>
        <div className="editeur-actions">
          {etat === "enregistre" && <span className="admin-ok">Enregistrée : les iPad et iPhone la reçoivent à la prochaine synchronisation.</span>}
          {modifiee && etat !== "envoi" && <span className="editeur-modifiee">Modifications non enregistrées</span>}
          {modifiee && (
            <button className="bouton" onClick={() => window.confirm("Annuler toutes les modifications ?") && setCarte(structuredClone(origine.carte))}>
              <AvecIcone icone={Undo2}>Annuler</AvecIcone>
            </button>
          )}
          <button className="bouton principal" disabled={!modifiee || etat === "envoi"} onClick={() => void enregistrer()}>
            <AvecIcone icone={Save}>{etat === "envoi" ? "Enregistrement…" : "Enregistrer"}</AvecIcone>
          </button>
        </div>
      </header>

      {etat === "conflit" && (
        <p className="admin-alerte">
          Quelqu'un a enregistré cette carte pendant que vous la modifiiez. Rechargez-la (vos modifications seront perdues) puis
          refaites-les, ou remplacez la carte enregistrée par la vôtre (leurs modifications seront alors perdues).{" "}
          <button className="bouton" onClick={() => void charger()}>
            <AvecIcone icone={RotateCw}>Recharger</AvecIcone>
          </button>{" "}
          <button
            className="bouton danger"
            onClick={() =>
              void (async () => {
                if (!window.confirm("Remplacer la carte enregistrée par votre version ? Les modifications de l'autre personne seront perdues.")) return;
                const derniere = await api.carte(props.id);
                await enregistrer(derniere.version);
              })()
            }
          >
            <AvecIcone icone={Save}>Remplacer par ma version</AvecIcone>
          </button>
        </p>
      )}
      {erreurs.length > 0 && (
        <div className="admin-alerte">
          <strong>La carte ne peut pas être enregistrée :</strong>
          <ul>
            {erreurs.slice(0, 12).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {stock && (
        <p className="editeur-fiches">
          <ChefHat className="icone en-ligne" size={18} aria-hidden="true" /> Fiches techniques : <strong>{avecFiche.length}</strong> / {emplacements.length}{" "}
          {caCouvert != null && (
            <>
              · <strong>{Math.round(caCouvert * 100)} %</strong> du CA des {ventes!.jours} derniers jours
            </>
          )}
          {stock.etablissements.length > 1 && (
            <label className="editeur-fiches-etab">
              · coûts de{" "}
              <select value={etab} onChange={(e) => setEtab(e.target.value)} aria-label="Établissement des coûts">
                {stock.etablissements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.enseigne}
                  </option>
                ))}
              </select>
            </label>
          )}
        </p>
      )}

      <div className="editeur-colonnes">
        <aside className="admin-section editeur-categories">
          <h2>Catégories</h2>
          {rayons.map((rayon) => (
            <div key={rayon} className="editeur-rayon">
              <h3>{rayon}</h3>
              {carte.categories
                .map((c, i) => ({ c, i }))
                .filter(({ c }) => c.rayon === rayon)
                .map(({ c, i }) => (
                  <div key={c.id} className={`editeur-cat${c.id === catId ? " actif" : ""}`}>
                    <button className="editeur-cat-nom" onClick={() => setCatId(c.id)}>
                      {c.nom} <small>{c.articles.length}</small>
                    </button>
                    <BoutonIcone icone={ArrowUp} taille={18} variante="discret" libelle={`Monter ${c.nom}`} onClick={() => majCategories((cats) => deplacerDansRayon(cats, i, -1))} />
                    <BoutonIcone icone={ArrowDown} taille={18} variante="discret" libelle={`Descendre ${c.nom}`} onClick={() => majCategories((cats) => deplacerDansRayon(cats, i, 1))} />
                  </div>
                ))}
            </div>
          ))}
          <form className="editeur-ajout" onSubmit={ajouterCategorie}>
            <input name="nom" placeholder="Nouvelle catégorie" maxLength={120} required />
            <input name="rayon" placeholder="Rayon (ex. Boissons)" list="rayons-carte" maxLength={40} required />
            <datalist id="rayons-carte">
              {rayons.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <button className="bouton">
              <AvecIcone icone={Plus}>Catégorie</AvecIcone>
            </button>
          </form>
        </aside>

        <section className="admin-section editeur-articles">
          {!categorie ? (
            <p className="explication">Créez une première catégorie pour y ajouter des articles.</p>
          ) : (
            <>
              <div className="editeur-cat-entete">
                <label className="champ">
                  <span>Catégorie</span>
                  <input value={categorie.nom} onChange={(e) => majCategorie(categorie.id, (c) => ({ ...c, nom: e.target.value }))} />
                </label>
                <label className="champ">
                  <span>Rayon (onglet de la caisse)</span>
                  <input
                    value={categorie.rayon}
                    list="rayons-carte"
                    onChange={(e) => majCategorie(categorie.id, (c) => ({ ...c, rayon: e.target.value }))}
                  />
                </label>
                <label className="champ">
                  <span>
                    <Printer className="icone en-ligne" size={18} aria-hidden="true" /> Poste de production
                  </span>
                  <input
                    value={categorie.poste ?? ""}
                    list="postes-carte"
                    placeholder="Aucun bon (ex. Bar, Cuisine)"
                    maxLength={30}
                    onChange={(e) =>
                      majCategorie(categorie.id, (c) => {
                        const poste = e.target.value.replace(/^\s+/, "");
                        const { poste: _ancien, ...reste } = c;
                        return poste ? { ...reste, poste } : reste;
                      })
                    }
                  />
                  <datalist id="postes-carte">
                    {postesDeLaCarte(carte).map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </label>
                <button className="bouton danger" onClick={() => supprimerCategorie(categorie)} title="Supprimer la catégorie">
                  <AvecIcone icone={Trash2}>Supprimer</AvecIcone>
                </button>
                <label className="champ editeur-fusion">
                  <span>
                    <Merge className="icone en-ligne" size={18} aria-hidden="true" /> Fusionner dans…
                  </span>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) fusionnerDans(categorie, e.target.value);
                    }}
                  >
                    <option value="">Choisir une catégorie</option>
                    {carte.categories
                      .filter((c) => c.id !== categorie.id)
                      .map((c) => {
                        const raison = fusionImpossible(categorie, c);
                        return (
                          <option key={c.id} value={c.id} disabled={!!raison}>
                            {c.rayon} › {c.nom}
                            {raison ? ` (${raison})` : ""}
                          </option>
                        );
                      })}
                  </select>
                </label>
              </div>
              <table className="tableau admin-tableau editeur-table">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th className="nombre">Prix TTC</th>
                    <th>TVA</th>
                    {stock && <th>Food cost</th>}
                    <th>En caisse</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {categorie.articles.map((a, i) => (
                    <tr key={a.id} className={a.indisponible ? "annule" : ""}>
                      <td>
                        <button className="lien-article" onClick={() => setArticleOuvert({ catId: categorie.id, article: structuredClone(a), nouveau: false })}>
                          {a.nom}
                        </button>
                        <small>
                          {[
                            a.variantes?.length && `${a.variantes.length} variantes`,
                            a.supplements?.length && `${a.supplements.length} suppléments`,
                            a.formule?.length && `formule à ${a.formule.length} choix`,
                            a.aCompleter && "à compléter",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </td>
                      <td className="nombre">{euros(a.prixTTC)}</td>
                      <td>{(a.tauxTVA / 100).toLocaleString("fr-FR")} %</td>
                      {stock && (
                        <td className={resumeFiche(a) === "sans fiche" || resumeFiche(a).includes("/") ? "cout-manquant" : ""}>{resumeFiche(a)}</td>
                      )}
                      <td>
                        <label className="case">
                          <input
                            type="checkbox"
                            checked={!a.indisponible}
                            onChange={(e) =>
                              majCategorie(categorie.id, (c) => ({
                                ...c,
                                articles: c.articles.map((x) => {
                                  if (x.id !== a.id) return x;
                                  const { indisponible: _, ...reste } = x;
                                  return e.target.checked ? reste : { ...reste, indisponible: true };
                                }),
                              }))
                            }
                          />
                          {a.indisponible ? "Indisponible" : "Disponible"}
                        </label>
                      </td>
                      <td className="editeur-ordre">
                        <BoutonIcone icone={ArrowUp} taille={18} variante="discret" libelle={`Monter ${a.nom}`} onClick={() => majCategorie(categorie.id, (c) => ({ ...c, articles: deplacer(c.articles, i, -1) }))} />
                        <BoutonIcone icone={ArrowDown} taille={18} variante="discret" libelle={`Descendre ${a.nom}`} onClick={() => majCategorie(categorie.id, (c) => ({ ...c, articles: deplacer(c.articles, i, 1) }))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form className="admin-ligne editeur-ajout-article" onSubmit={ajouterArticle}>
                <input name="nom" placeholder="Nouvel article" maxLength={120} required />
                <input name="prix" placeholder="Prix TTC (ex. 4,50)" inputMode="decimal" />
                <select name="tva" defaultValue="1000" aria-label="TVA">
                  {TAUX.map((t) => (
                    <option key={t.valeur} value={t.valeur}>
                      {t.libelle}
                    </option>
                  ))}
                </select>
                <button className="bouton">
                  <AvecIcone icone={Plus}>Ajouter</AvecIcone>
                </button>
              </form>
              {erreurAjout && <p className="erreur">{erreurAjout}</p>}
            </>
          )}
        </section>
      </div>

      {articleOuvert && (
        <FicheArticle
          carte={carte}
          catId={articleOuvert.catId}
          article={articleOuvert.article}
          stock={stock}
          couts={couts}
          nomEtab={nomEtab}
          onValider={enregistrerArticle}
          onSupprimer={() => {
            if (supprimer([], [articleOuvert.article.id], `« ${articleOuvert.article.nom} » de la carte`)) setArticleOuvert(null);
          }}
          onFermer={() => setArticleOuvert(null)}
        />
      )}
    </div>
  );
}

// ───────── Fiche article ─────────

function FicheArticle(props: {
  carte: Catalogue;
  catId: string;
  article: Article;
  stock: ReponseStock | null;
  couts: Couts | null;
  nomEtab: string;
  onValider: (catId: string, a: Article) => void;
  onSupprimer: () => void;
  onFermer: () => void;
}) {
  const [a, setA] = useState<Article>(props.article);
  const [cat, setCat] = useState(props.catId);
  const [prix, setPrix] = useState(saisieDepuisCentimes(a.prixTTC));
  /** Prix saisis des variantes et suppléments, par identifiant : convertis seulement à la validation. */
  const [prixOptions, setPrixOptions] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries((a.variantes ?? []).map((v) => [`v:${v.id}`, saisieDepuisCentimes(v.prixTTC ?? null)])),
    ...Object.fromEntries((a.supplements ?? []).map((x) => [`s:${x.id}`, saisieDepuisCentimes(x.prixTTC)])),
  }));
  const champPrix = (cle: string) => ({
    value: prixOptions[cle] ?? "",
    inputMode: "decimal" as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPrixOptions((p) => ({ ...p, [cle]: e.target.value })),
  });
  const [erreur, setErreur] = useState("");
  const tous = tousLesArticles(props.carte).filter((x) => x.id !== a.id);

  const valider = () => {
    if (!a.nom.trim()) return setErreur("Le nom est obligatoire.");
    const p = prix.trim() === "" ? null : centimesDepuisSaisie(prix);
    if (prix.trim() !== "" && p == null) return setErreur("Prix illisible : saisissez par exemple 4,50.");
    const variantes: Variante[] = [];
    for (const v of a.variantes ?? []) {
      if (!v.nom.trim()) return setErreur("Chaque variante doit avoir un nom.");
      const texte = (prixOptions[`v:${v.id}`] ?? "").trim();
      const pv = texte ? centimesDepuisSaisie(texte) : null;
      if (texte && pv == null) return setErreur(`Prix illisible pour la variante « ${v.nom} » : saisissez par exemple 8,50.`);
      const { prixTTC: _, ...reste } = v;
      variantes.push(pv == null ? reste : { ...reste, prixTTC: pv });
    }
    const supplements: Supplement[] = [];
    for (const x of a.supplements ?? []) {
      if (!x.nom.trim()) return setErreur("Chaque supplément doit avoir un nom.");
      const ps = centimesDepuisSaisie(prixOptions[`s:${x.id}`] ?? "");
      if (ps == null) return setErreur(`Prix obligatoire et lisible pour le supplément « ${x.nom} » (ex. 0,50).`);
      supplements.push({ ...x, prixTTC: ps });
    }
    if (p == null && !variantes.some((v) => v.prixTTC != null) && !a.aCompleter?.trim()) {
      return setErreur("Sans prix, indiquez dans « À compléter » ce qui manque (l'article ne s'encaisse pas).");
    }
    for (const c of a.formule ?? []) {
      if (!c.nom.trim()) return setErreur("Chaque choix de formule doit avoir un nom.");
      if (!c.categories?.length && !c.articles?.length) return setErreur(`Le choix « ${c.nom} » ne propose rien.`);
    }
    const propre: Article = { ...a, nom: a.nom.trim(), prixTTC: p, variantes, supplements };
    for (const cle of ["variantes", "supplements", "formule"] as const) if (!propre[cle]?.length) delete propre[cle];
    for (const cle of ["description", "aCompleter"] as const) if (!propre[cle]?.trim()) delete propre[cle];
    props.onValider(cat, propre);
  };

  const sousId = (nom: string, liste: Array<{ id: string }> | undefined) => identifiantDepuisNom(nom || "choix", (liste ?? []).map((x) => x.id));

  return (
    <div className="voile" onPointerDown={(e) => e.target === e.currentTarget && props.onFermer()}>
      <div className="modale large fiche-article" role="dialog" aria-modal="true" aria-label={a.nom}>
        <header className="modale-tete">
          <h2>{a.nom || "Article"}</h2>
          <BoutonIcone icone={X} variante="discret" libelle="Fermer" onClick={props.onFermer} />
        </header>
        <div className="modale-corps">
          <div className="formulaire-colonnes">
            <div>
              <label className="champ">
                <span>Nom</span>
                <input value={a.nom} onChange={(e) => setA({ ...a, nom: e.target.value })} maxLength={120} />
              </label>
              <label className="champ">
                <span>
                  Prix TTC
                  <small>Vide : prix à fixer, l'article ne s'encaisse pas</small>
                </span>
                <input value={prix} inputMode="decimal" placeholder="0,00" onChange={(e) => setPrix(e.target.value)} />
              </label>
              <label className="champ">
                <span>TVA</span>
                <select value={a.tauxTVA} onChange={(e) => setA({ ...a, tauxTVA: Number(e.target.value) })}>
                  {TAUX.map((t) => (
                    <option key={t.valeur} value={t.valeur}>
                      {t.libelle}
                    </option>
                  ))}
                </select>
              </label>
              <label className="champ">
                <span>Catégorie</span>
                <select value={cat} onChange={(e) => setCat(e.target.value)}>
                  {props.carte.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.rayon} › {c.nom}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <label className="champ">
                <span>Description</span>
                <input value={a.description ?? ""} onChange={(e) => setA({ ...a, description: e.target.value })} maxLength={200} />
              </label>
              <label className="champ">
                <span>
                  À compléter
                  <small>Information manquante, affichée en caisse</small>
                </span>
                <input value={a.aCompleter ?? ""} onChange={(e) => setA({ ...a, aCompleter: e.target.value })} maxLength={200} />
              </label>
              <label className="case">
                <input
                  type="checkbox"
                  checked={!!a.indisponible}
                  onChange={(e) => {
                    const { indisponible: _, ...reste } = a;
                    setA(e.target.checked ? { ...reste, indisponible: true } : reste);
                  }}
                />
                Indisponible (rupture, hors saison)
              </label>
              <p className="explication">Identifiant : {a.id} — il ne change pas, pour garder l'historique des ventes.</p>
            </div>
          </div>

          <h3>Variantes (le client en choisit une)</h3>
          {(a.variantes ?? []).map((v, i) => (
            <div key={v.id} className="admin-ligne sous-ligne">
              <input
                value={v.nom}
                placeholder="Nom (ex. 50 cl)"
                onChange={(e) => setA({ ...a, variantes: a.variantes!.map((x, j) => (j === i ? { ...x, nom: e.target.value } : x)) })}
              />
              <input placeholder="Prix (vide : prix de l'article)" {...champPrix(`v:${v.id}`)} />
              <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer la variante ${v.nom}`} onClick={() => setA({ ...a, variantes: a.variantes!.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <button className="bouton discret" onClick={() => setA({ ...a, variantes: [...(a.variantes ?? []), { id: sousId(`variante-${(a.variantes?.length ?? 0) + 1}`, a.variantes), nom: "" }] })}>
            <AvecIcone icone={Plus}>Variante</AvecIcone>
          </button>

          <h3>Suppléments (facturés en plus)</h3>
          {(a.supplements ?? []).map((s, i) => (
            <div key={s.id} className="admin-ligne sous-ligne">
              <input value={s.nom} placeholder="Nom" onChange={(e) => setA({ ...a, supplements: a.supplements!.map((x, j) => (j === i ? { ...x, nom: e.target.value } : x)) })} />
              <input placeholder="Prix (ex. 0,50)" {...champPrix(`s:${s.id}`)} />
              <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer le supplément ${s.nom}`} onClick={() => setA({ ...a, supplements: a.supplements!.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <button
            className="bouton discret"
            onClick={() => setA({ ...a, supplements: [...(a.supplements ?? []), { id: sousId(`supplement-${(a.supplements?.length ?? 0) + 1}`, a.supplements), nom: "", prixTTC: 0 }] })}
          >
            <AvecIcone icone={Plus}>Supplément</AvecIcone>
          </button>

          <h3>Formule (choix inclus dans le prix)</h3>
          {(a.formule ?? []).map((c, i) => (
            <ChoixFormuleEditeur
              key={c.id}
              choix={c}
              carte={props.carte}
              articles={tous}
              onChange={(n) => setA({ ...a, formule: a.formule!.map((x, j) => (j === i ? n : x)) })}
              onRetirer={() => setA({ ...a, formule: a.formule!.filter((_, j) => j !== i) })}
            />
          ))}
          <button className="bouton discret" onClick={() => setA({ ...a, formule: [...(a.formule ?? []), { id: sousId(`choix-${(a.formule?.length ?? 0) + 1}`, a.formule), nom: "", categories: [] }] })}>
            <AvecIcone icone={Plus}>Choix de formule</AvecIcone>
          </button>

          {props.stock && props.couts && (
            <section className="fiches-article">
              <h3 className="titre-icone">
                <AvecIcone icone={ChefHat} taille={20}>Fiche technique</AvecIcone>
              </h3>
              {a.formule?.length ? (
                <p className="explication">Formule : chaque choix consomme la fiche de l'article choisi. Une fiche ici s'ajouterait (emballage, pain…).</p>
              ) : (
                <p className="explication">Recette, ou produit vendu tel quel (une canette, 12 cl d'une bouteille), et la quantité servie. Coûts de {props.nomEtab}.</p>
              )}
              <EditeurFiche
                libelle={a.variantes?.length ? "Par défaut" : a.nom || "Article"}
                fiche={a.fiche}
                onChange={(fiche) => {
                  const { fiche: _, ...reste } = a;
                  setA(fiche ? { ...reste, fiche } : reste);
                }}
                stock={props.stock}
                couts={props.couts}
                etablissement={props.nomEtab}
                prixTTC={prix.trim() ? centimesDepuisSaisie(prix) : null}
                tauxTVA={a.tauxTVA}
              />
              {(a.variantes ?? []).map((v, i) => (
                <EditeurFiche
                  key={v.id}
                  libelle={v.nom || `Variante ${i + 1}`}
                  fiche={v.fiche}
                  heritee={a.fiche}
                  onChange={(fiche) =>
                    setA({
                      ...a,
                      variantes: a.variantes!.map((x, j) => {
                        if (j !== i) return x;
                        const { fiche: _, ...reste } = x;
                        return fiche ? { ...reste, fiche } : reste;
                      }),
                    })
                  }
                  stock={props.stock!}
                  couts={props.couts!}
                  etablissement={props.nomEtab}
                  prixTTC={(prixOptions[`v:${v.id}`] ?? "").trim() ? centimesDepuisSaisie(prixOptions[`v:${v.id}`]!) : prix.trim() ? centimesDepuisSaisie(prix) : null}
                  tauxTVA={a.tauxTVA}
                />
              ))}
              {(a.supplements ?? []).map((x, i) => (
                <EditeurFiche
                  key={x.id}
                  libelle={`+ ${x.nom || `supplément ${i + 1}`}`}
                  fiche={x.fiche}
                  onChange={(fiche) =>
                    setA({
                      ...a,
                      supplements: a.supplements!.map((y, j) => {
                        if (j !== i) return y;
                        const { fiche: _, ...reste } = y;
                        return fiche ? { ...reste, fiche } : reste;
                      }),
                    })
                  }
                  stock={props.stock!}
                  couts={props.couts!}
                  etablissement={props.nomEtab}
                  prixTTC={centimesDepuisSaisie(prixOptions[`s:${x.id}`] ?? "")}
                  tauxTVA={a.tauxTVA}
                />
              ))}
            </section>
          )}
          {erreur && <p className="erreur">{erreur}</p>}
        </div>
        <footer className="modale-pied">
          <button className="bouton danger" onClick={props.onSupprimer} title="Supprimer l'article">
            <AvecIcone icone={Trash2}>Supprimer</AvecIcone>
          </button>
          <button className="bouton principal" onClick={valider}>
            <AvecIcone icone={Check}>Valider</AvecIcone>
          </button>
        </footer>
      </div>
    </div>
  );
}

function ChoixFormuleEditeur(props: {
  choix: ChoixFormule;
  carte: Catalogue;
  articles: Array<Article & { categorieId: string }>;
  onChange: (c: ChoixFormule) => void;
  onRetirer: () => void;
}) {
  const c = props.choix;
  const basculer = (cle: "categories" | "articles", id: string) => {
    const liste = c[cle] ?? [];
    props.onChange({ ...c, [cle]: liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id] });
  };
  return (
    <div className="choix-formule">
      <div className="admin-ligne sous-ligne">
        <input value={c.nom} placeholder="Nom du choix (ex. Boisson chaude)" onChange={(e) => props.onChange({ ...c, nom: e.target.value })} />
        <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer le choix ${c.nom}`} onClick={props.onRetirer} />
      </div>
      {(() => {
        const cats = new Set(props.carte.categories.map((x) => x.id));
        const arts = new Set(props.articles.map((x) => x.id));
        const inconnus = [...(c.categories ?? []).filter((x) => !cats.has(x)).map((x) => ["categories", x] as const), ...(c.articles ?? []).filter((x) => !arts.has(x)).map((x) => ["articles", x] as const)];
        return inconnus.length ? (
          <p className="erreur">
            Références disparues :{" "}
            {inconnus.map(([cle, id]) => (
              <button key={`${cle}:${id}`} className="option" onClick={() => basculer(cle, id)}>
                {id} ✕
              </button>
            ))}
          </p>
        ) : null;
      })()}
      <p className="explication">Catégories proposées :</p>
      <div className="options">
        {props.carte.categories.map((cat) => (
          <button key={cat.id} className={`option${c.categories?.includes(cat.id) ? " active" : ""}`} onClick={() => basculer("categories", cat.id)}>
            {cat.nom}
          </button>
        ))}
      </div>
      <details>
        <summary>Articles proposés en plus ({c.articles?.length ?? 0})</summary>
        <div className="options">
          {props.articles.map((art) => (
            <button key={art.id} className={`option${c.articles?.includes(art.id) ? " active" : ""}`} onClick={() => basculer("articles", art.id)}>
              {art.nom}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
