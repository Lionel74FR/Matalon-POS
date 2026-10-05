import {
  ligneDepuisArticle,
  ligneSupplement,
  tousLesArticles,
  type Article,
  type Catalogue,
  type ChoixFormule,
} from "@matalon/catalogue";
import { useMemo, useState } from "react";
import type { LigneCommande } from "../../metier/commande";
import { Modale } from "../communs";
import { euros } from "../contexte";

type NouvelleLigne = Omit<LigneCommande, "uid" | "ajouteeLe" | "ajouteePar">;

/** Options proposées pour un choix de formule : articles des catégories visées, variantes dépliées. */
function optionsDuChoix(carte: Catalogue, choix: ChoixFormule): string[] {
  const articles = tousLesArticles(carte).filter(
    (a) => choix.articles?.includes(a.id) || choix.categories?.includes(a.categorieId),
  );
  return articles.flatMap((a) =>
    a.variantes?.length ? a.variantes.map((v) => v.libelle ?? `${a.nom} ${v.nom}`) : [a.nom],
  );
}

/** Variante, suppléments ou composition d'une formule avant ajout à la commande. */
export function ModaleArticle(props: {
  article: Article;
  carte: Catalogue;
  onAjouter: (lignes: NouvelleLigne[]) => void;
  onFermer: () => void;
}) {
  const a = props.article;
  const [varianteId, setVarianteId] = useState<string | null>(null);
  const [supplements, setSupplements] = useState<string[]>([]);
  const [quantite, setQuantite] = useState(1);
  const choixFormule = useMemo(
    () => (a.formule ?? []).map((ch) => ({ choix: ch, options: optionsDuChoix(props.carte, ch) })),
    [a, props.carte],
  );
  const [selections, setSelections] = useState<Record<string, string>>({});

  const varianteManquante = !!a.variantes?.length && !varianteId;
  const choixManquant = choixFormule.find((c) => !selections[c.choix.id]);
  const pret = !varianteManquante && !choixManquant;

  const prixUnitaire = (() => {
    const v = a.variantes?.find((x) => x.id === varianteId);
    const base = v?.prixTTC ?? a.prixTTC ?? 0;
    return base + (a.supplements ?? []).filter((s) => supplements.includes(s.id)).reduce((t, s) => t + s.prixTTC, 0);
  })();

  const ajouter = () => {
    if (!pret) return;
    const lignes: NouvelleLigne[] = [];
    if (a.formule?.length) {
      lignes.push({
        articleId: a.id,
        libelle: a.nom,
        details: choixFormule.map((c) => selections[c.choix.id]!),
        quantite,
        prixUnitaireTTC: a.prixTTC!,
        tauxTVA: a.tauxTVA,
      });
    } else {
      lignes.push({ ...ligneDepuisArticle(a, { ...(varianteId ? { varianteId } : {}), quantite }), details: [] });
    }
    for (const s of (a.supplements ?? []).filter((x) => supplements.includes(x.id))) {
      lignes.push({ ...ligneSupplement(a, s, quantite), details: [] });
    }
    props.onAjouter(lignes);
  };

  return (
    <Modale
      titre={a.nom}
      onFermer={props.onFermer}
      large={!!a.formule?.length}
      pied={
        <>
          <div className="quantite">
            <button className="bouton" onClick={() => setQuantite((q) => Math.max(1, q - 1))} aria-label="Un de moins">
              −
            </button>
            <span>{quantite}</span>
            <button className="bouton" onClick={() => setQuantite((q) => q + 1)} aria-label="Un de plus">
              +
            </button>
          </div>
          <button className="bouton principal" disabled={!pret} onClick={ajouter}>
            {pret ? `Ajouter · ${euros(prixUnitaire * quantite)}` : varianteManquante ? "Choisissez une variante" : `Choisissez : ${choixManquant!.choix.nom}`}
          </button>
        </>
      }
    >
      {a.description && <p className="explication">{a.description}</p>}
      {a.variantes?.length ? (
        <section className="groupe-choix">
          <h3>Variante</h3>
          <div className="options">
            {a.variantes.map((v) => (
              <button key={v.id} className={`option${varianteId === v.id ? " active" : ""}`} onClick={() => setVarianteId(v.id)}>
                {v.nom}
                {v.prixTTC != null && v.prixTTC !== a.prixTTC && <small>{euros(v.prixTTC)}</small>}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {a.supplements?.length ? (
        <section className="groupe-choix">
          <h3>Suppléments</h3>
          <div className="options">
            {a.supplements.map((s) => {
              const actif = supplements.includes(s.id);
              return (
                <button
                  key={s.id}
                  className={`option${actif ? " active" : ""}`}
                  aria-pressed={actif}
                  onClick={() => setSupplements((l) => (actif ? l.filter((x) => x !== s.id) : [...l, s.id]))}
                >
                  {s.nom}
                  <small>+{euros(s.prixTTC)}</small>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
      {choixFormule.map(({ choix, options }) => (
        <section key={choix.id} className="groupe-choix">
          <h3>{choix.nom}</h3>
          <div className="options compactes">
            {options.map((o) => (
              <button
                key={o}
                className={`option${selections[choix.id] === o ? " active" : ""}`}
                onClick={() => setSelections((s) => ({ ...s, [choix.id]: o }))}
              >
                {o}
              </button>
            ))}
          </div>
        </section>
      ))}
    </Modale>
  );
}
