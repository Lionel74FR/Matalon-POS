import { CARTE_AUTOMNE_2026, type Article, type Categorie } from "@matalon/catalogue";
import { useMemo, useState } from "react";
import { ID_COMPTOIR } from "../donnees/configuration";
import { gabaritAddition } from "../impression/gabarits";
import { ajouterLigne, montantLigne, totauxCommande, type Commande, type LigneCommande } from "../metier/commande";
import { Vide } from "./communs";
import { euros, useCaisse } from "./contexte";
import { ModaleArticle } from "./modales/ModaleArticle";
import { ModaleCouverts } from "./modales/ModaleCouverts";
import { ModaleEncaissement } from "./modales/ModaleEncaissement";
import { ModaleLigne } from "./modales/ModaleLigne";

const CARTE = CARTE_AUTOMNE_2026;
const RAYONS = [...new Set(CARTE.categories.map((c) => c.rayon))];
const TEINTES: Record<string, string> = {
  Boissons: "cafe",
  Bar: "prune",
  Cuisine: "olive",
  Goûter: "caramel",
  "À partager": "lac",
  Formules: "terre",
  Ateliers: "ardoise",
};

export function PriseCommande(props: {
  titre: string;
  commande: Commande;
  onChange: (c: Commande) => void;
  onTerminee: () => void;
  onRetour: () => void;
}) {
  const { caisse, config, utilisateur, notifier, imprimer } = useCaisse();
  const c = props.commande;
  const [rayon, setRayon] = useState(RAYONS[0]!);
  const categories = useMemo(() => CARTE.categories.filter((x) => x.rayon === rayon), [rayon]);
  const [categorieId, setCategorieId] = useState<string | null>(null);
  const categorie: Categorie = categories.find((x) => x.id === categorieId) ?? categories[0]!;
  const [articleOuvert, setArticleOuvert] = useState<Article | null>(null);
  const [ligneOuverte, setLigneOuverte] = useState<LigneCommande | null>(null);
  const [couvertsOuvert, setCouvertsOuvert] = useState(false);
  const [encaissement, setEncaissement] = useState(false);
  const totaux = totauxCommande(c);
  const estComptoir = c.tableId === ID_COMPTOIR;

  const ajouter = (l: Omit<LigneCommande, "uid" | "ajouteeLe" | "ajouteePar">) =>
    props.onChange(ajouterLigne(c, { ...l, ajouteePar: utilisateur.id }));

  const toucherArticle = (a: Article) => {
    if (a.prixTTC == null && !a.variantes?.some((v) => v.prixTTC != null)) {
      return notifier(`${a.nom} n'a pas encore de prix : à compléter dans la carte.`, "erreur");
    }
    if (a.variantes?.length || a.supplements?.length || a.formule?.length) return setArticleOuvert(a);
    ajouter({ articleId: a.id, libelle: a.nom, details: [], quantite: 1, prixUnitaireTTC: a.prixTTC!, tauxTVA: a.tauxTVA });
  };

  const imprimerAddition = async () => {
    await imprimer(gabaritAddition(c, config, utilisateur.id), "Addition");
    await caisse.registre.journaliser(
      "IMPRESSION_ADDITION",
      { table: c.tableId, totalTTC: totaux.totalTTC, nbArticles: totaux.nbArticles },
      utilisateur.id,
    );
    props.onChange({ ...c, additionsImprimees: c.additionsImprimees + 1 });
  };

  return (
    <div className="prise-commande">
      <aside className="ticket-papier" aria-label="Commande en cours">
        <header className="ticket-tete">
          <button className="bouton discret" onClick={props.onRetour} aria-label="Retour à la salle">
            ←
          </button>
          <div>
            <h1>{props.titre}</h1>
            {!estComptoir && (
              <button className="lien" onClick={() => setCouvertsOuvert(true)}>
                {c.couverts ? `${c.couverts} couvert${c.couverts > 1 ? "s" : ""}` : "Indiquer les couverts"}
              </button>
            )}
          </div>
        </header>
        <ol className="ticket-lignes">
          {c.lignes.length === 0 && <Vide>Touchez un article pour l'ajouter.</Vide>}
          {c.lignes.map((l) => (
            <li key={l.uid}>
              <button className="ticket-ligne" onClick={() => setLigneOuverte(l)}>
                <span className="qte">{l.quantite}</span>
                <span className="libelle">
                  {l.libelle}
                  {l.details.length > 0 && <small>{l.details.join(" · ")}</small>}
                  {l.remise && (
                    <small className="remise">
                      {l.remise.montantTTC === l.quantite * l.prixUnitaireTTC ? "Offert" : `Remise ${euros(l.remise.montantTTC)}`} ·{" "}
                      {l.remise.motif}
                    </small>
                  )}
                </span>
                <span className="montant">{euros(montantLigne(l))}</span>
              </button>
            </li>
          ))}
        </ol>
        <footer className="ticket-pied">
          <div className="ticket-total">
            <span>Total</span>
            <strong>{euros(totaux.totalTTC)}</strong>
          </div>
          <div className="ticket-actions">
            {!estComptoir && (
              <button className="bouton" disabled={c.lignes.length === 0} onClick={() => void imprimerAddition()}>
                Addition
              </button>
            )}
            <button className="bouton principal" disabled={c.lignes.length === 0} onClick={() => setEncaissement(true)}>
              Encaisser
            </button>
          </div>
        </footer>
      </aside>

      <section className="carte" aria-label="Carte">
        <div className="rayons" role="tablist">
          {RAYONS.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === rayon}
              className={`rayon teinte-${TEINTES[r] ?? "cafe"}`}
              onClick={() => {
                setRayon(r);
                setCategorieId(null);
              }}
            >
              {r}
            </button>
          ))}
        </div>
        {categories.length > 1 && (
          <div className="categories">
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`pastille${cat.id === categorie.id ? " active" : ""}`}
                onClick={() => setCategorieId(cat.id)}
              >
                {cat.nom}
              </button>
            ))}
          </div>
        )}
        <div className={`grille-articles teinte-${TEINTES[rayon] ?? "cafe"}`}>
          {categorie.articles.map((a) => (
            <button key={a.id} className={`tuile${a.prixTTC == null ? " incomplete" : ""}`} onClick={() => toucherArticle(a)}>
              <span className="tuile-nom">{a.nom}</span>
              <span className="tuile-prix">
                {a.prixTTC != null ? euros(a.prixTTC) : "Prix à venir"}
                {(a.variantes?.length || a.formule?.length) && <span className="tuile-plus"> · choix</span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      {articleOuvert && (
        <ModaleArticle
          article={articleOuvert}
          carte={CARTE}
          onAjouter={(lignes) => {
            let suite = c;
            for (const l of lignes) suite = ajouterLigne(suite, { ...l, ajouteePar: utilisateur.id });
            props.onChange(suite);
            setArticleOuvert(null);
          }}
          onFermer={() => setArticleOuvert(null)}
        />
      )}
      {ligneOuverte && (
        <ModaleLigne
          ligne={ligneOuverte}
          tableId={c.tableId}
          onChange={(nouvelle) => {
            props.onChange({
              ...c,
              lignes: nouvelle
                ? c.lignes.map((x) => (x.uid === nouvelle.uid ? nouvelle : x))
                : c.lignes.filter((x) => x.uid !== ligneOuverte.uid),
            });
            setLigneOuverte(null);
          }}
          onFermer={() => setLigneOuverte(null)}
        />
      )}
      {couvertsOuvert && (
        <ModaleCouverts
          valeur={c.couverts}
          onValider={(n) => {
            props.onChange({ ...c, couverts: n });
            setCouvertsOuvert(false);
          }}
          onFermer={() => setCouvertsOuvert(false)}
        />
      )}
      {encaissement && (
        <ModaleEncaissement commande={c} onTermine={props.onTerminee} onFermer={() => setEncaissement(false)} />
      )}
    </div>
  );
}
