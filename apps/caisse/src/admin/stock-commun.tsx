import {
  centimes,
  Couts,
  foodCost,
  formaterQuantite,
  lireQuantite,
  normaliserNom,
  quantiteParDefaut,
  BASE,
  type Cout,
  type Fiche,
  type Produit,
  type Quantite,
  type Recette,
  type Referentiel,
  type TypeComposant,
  type UniteStock,
} from "@matalon/stock";
import type { ReponseStock } from "@matalon/serveur/partage";
import { useEffect, useId, useState } from "react";

/** Montant en centimes : « 1,52 € ». */
export const euros = (c: number | null | undefined) => (c == null ? "—" : (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }));

/** Coût en micro-euros, au centime : « 1,52 € » ; sous le centime : « 0,004 € ». */
export function eurosMicro(micro: number): string {
  if (micro > 0 && micro < 10_000) return `${(micro / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 4 })} €`;
  return euros(centimes(micro));
}

export const pourcent = (pb: number | null) => (pb == null ? "—" : `${(pb / 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`);

export const LIBELLES_UNITE: Record<UniteStock, string> = { kg: "kg", L: "L", piece: "pièce" };

/** Unité de saisie proposée pour une quantité d'un composant compté dans `unite`. */
export const uniteSaisie = (unite: UniteStock) => (unite === "kg" ? "g" : unite === "L" ? "ml" : "piece");

/** Coût d'une unité de comptage (1 kg, 1 L, 1 pièce) d'un composant. */
export function coutUnitaire(couts: Couts, type: TypeComposant, id: string): Cout {
  return couts.cout(type, id, 1000);
}

/** Composants proposés dans une recette ou une fiche : produits et recettes actifs, triés. */
export interface Composant {
  type: TypeComposant;
  id: string;
  nom: string;
  unite: UniteStock;
  actif: boolean;
}

export function composants(ref: Referentiel, saufRecette?: string): Composant[] {
  return [
    ...ref.produits.map((p): Composant => ({ type: "produit", id: p.id, nom: p.nom, unite: p.unite, actif: p.actif })),
    ...ref.recettes.filter((r) => r.id !== saufRecette).map((r): Composant => ({ type: "recette", id: r.id, nom: r.nom, unite: r.unite, actif: r.actif })),
  ].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

export const libelleComposant = (c: Composant) => `${c.nom} (${c.type === "recette" ? "recette" : "produit"}, ${LIBELLES_UNITE[c.unite]})`;

export function composantDe(ref: Referentiel, type: TypeComposant, id: string): Produit | Recette | undefined {
  return type === "produit" ? ref.produits.find((p) => p.id === id) : ref.recettes.find((r) => r.id === id);
}

/**
 * Choix d'un produit ou d'une recette par son nom, avec complétion. Le
 * composant n'est retenu que si le nom saisi correspond exactement.
 */
export function ChoixComposant(props: { liste: Composant[]; valeur: { type: TypeComposant; id: string } | null; onChange: (c: Composant | null) => void; libelle: string }) {
  const idListe = useId();
  const choisi = props.valeur ? props.liste.find((c) => c.type === props.valeur!.type && c.id === props.valeur!.id) : null;
  const [texte, setTexte] = useState(choisi ? libelleComposant(choisi) : "");
  useEffect(() => {
    if (choisi) setTexte(libelleComposant(choisi));
  }, [choisi?.id, choisi?.type]); // eslint-disable-line react-hooks/exhaustive-deps
  const actifs = props.liste.filter((c) => c.actif || (choisi && c.id === choisi.id && c.type === choisi.type));
  const resoudre = (t: string) => {
    setTexte(t);
    const n = normaliserNom(t);
    const exact = actifs.find((c) => normaliserNom(libelleComposant(c)) === n) ?? actifs.find((c) => normaliserNom(c.nom) === n);
    props.onChange(exact ?? null);
  };
  return (
    <>
      <input list={idListe} value={texte} placeholder="Produit ou recette" aria-label={props.libelle} onChange={(e) => resoudre(e.target.value)} />
      <datalist id={idListe}>
        {actifs.map((c) => (
          <option key={`${c.type}:${c.id}`} value={libelleComposant(c)} />
        ))}
      </datalist>
    </>
  );
}

/** Quantité saisie avec son unité (« 30 g », « 12 cl », « 1 pièce ») ; null tant qu'elle est illisible. */
export function ChampQuantite(props: { valeur: Quantite | null; unite: UniteStock | null; onChange: (q: Quantite | null) => void; libelle: string }) {
  const [texte, setTexte] = useState(props.valeur ? formaterQuantite(props.valeur) : "");
  useEffect(() => {
    if (props.valeur && lireQuantite(texte, props.unite ? uniteSaisie(props.unite) : undefined)?.valeur !== props.valeur.valeur) setTexte(formaterQuantite(props.valeur));
  }, [props.valeur?.valeur, props.valeur?.unite]); // eslint-disable-line react-hooks/exhaustive-deps
  const lue = texte.trim() ? lireQuantite(texte, props.unite ? uniteSaisie(props.unite) : undefined) : null;
  return (
    <input
      className={`champ-quantite${texte.trim() && !lue ? " invalide" : ""}`}
      value={texte}
      placeholder={props.unite === "piece" ? "1 pièce" : props.unite === "L" ? "150 ml" : "30 g"}
      aria-label={props.libelle}
      onChange={(e) => {
        setTexte(e.target.value);
        props.onChange(e.target.value.trim() ? lireQuantite(e.target.value, props.unite ? uniteSaisie(props.unite) : undefined) : null);
      }}
    />
  );
}

/** Avertissements d'un coût : prix empruntés, produits sans prix, unités. */
export function AlertesCout(props: { cout: Cout; etablissement: string }) {
  const { manquants, emprunts, erreurs } = props.cout;
  if (!manquants.length && !emprunts.length && !erreurs.length) return null;
  return (
    <small className="alertes-cout">
      {erreurs.map((e) => (
        <span key={e} className="erreur">
          {e}
        </span>
      ))}
      {manquants.length > 0 && <span className="cout-manquant">Sans prix : {manquants.join(", ")} (coût partiel)</span>}
      {emprunts.length > 0 && (
        <span className="cout-emprunte">
          Prix emprunté (aucun achat à {props.etablissement}) : {emprunts.join(", ")}
        </span>
      )}
    </small>
  );
}

/**
 * Fiche technique d'un article de la carte (ou d'une variante, d'un
 * supplément) : recette ou produit vendu tel quel, quantité, coût et food
 * cost pour l'établissement choisi.
 */
export function EditeurFiche(props: {
  libelle: string;
  fiche: Fiche | undefined;
  /** Fiche de l'article, héritée par une variante sans fiche propre. */
  heritee?: Fiche;
  onChange: (f: Fiche | undefined) => void;
  stock: ReponseStock;
  couts: Couts;
  etablissement: string;
  prixTTC: number | null;
  tauxTVA: number;
}) {
  const liste = composants(props.stock.referentiel);
  const [choix, setChoix] = useState<Composant | null>(() => (props.fiche ? (liste.find((c) => c.type === props.fiche!.type && c.id === props.fiche!.id) ?? null) : null));
  const [quantite, setQuantite] = useState<Quantite | null>(props.fiche?.quantite ?? null);
  const appliquer = (c: Composant | null, q: Quantite | null) => {
    setChoix(c);
    setQuantite(q);
    props.onChange(c && q ? { type: c.type, id: c.id, quantite: q } : undefined);
  };
  const effective = props.fiche ?? props.heritee;
  const cout = effective ? props.couts.coutFiche(effective) : null;
  const fc = cout ? foodCost(cout.micro, props.prixTTC, props.tauxTVA) : null;
  return (
    <div className="fiche-editeur">
      <div className="admin-ligne sous-ligne">
        <span className="fiche-libelle">{props.libelle}</span>
        <ChoixComposant
          liste={liste}
          valeur={choix}
          libelle={`Fiche technique de ${props.libelle}`}
          onChange={(c) => appliquer(c, c && (!quantite || (choix && BASE[choix.unite] !== BASE[c.unite])) ? quantiteParDefaut(c.unite) : quantite)}
        />
        <ChampQuantite valeur={quantite} unite={choix?.unite ?? null} libelle={`Quantité pour ${props.libelle}`} onChange={(q) => appliquer(choix, q)} />
      </div>
      <p className="fiche-resultat">
        {!effective ? (
          <span className="cout-manquant">Sans fiche technique</span>
        ) : (
          <>
            {!props.fiche && props.heritee && <span className="fiche-heritee">Fiche de l'article · </span>}
            Coût {eurosMicro(cout!.micro)} HT · food cost <strong>{pourcent(fc)}</strong>
          </>
        )}
      </p>
      {cout && <AlertesCout cout={cout} etablissement={props.etablissement} />}
    </div>
  );
}
