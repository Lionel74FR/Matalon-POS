import { Check, Minus, Plus, Split, Users } from "lucide-react";
import { useState } from "react";
import { acomptesActifs, avecQuantite, lignesDues, montantLigne, type Commande, type LigneCommande } from "../../metier/commande";
import { AvecIcone, BoutonIcone } from "../icones";
import { Modale } from "../communs";
import { euros } from "../contexte";

/** Montant d'une partie de ligne, remise au prorata comme à la coupe. */
export const montantPartiel = (l: LigneCommande, q: number) => montantLigne(q === l.quantite ? l : avecQuantite(l, q));

/**
 * Diviser la note : par articles (ceux d'une personne font leur ticket, le reste demeure sur la
 * table), ou en parts égales et montant libre (acomptes, ticket unique au dernier paiement).
 */
export function ModaleDivision(props: {
  commande: Commande;
  onArticles: (selection: Map<string, number>) => void;
  onParts: () => void;
  onFermer: () => void;
}) {
  const lignes = lignesDues(props.commande);
  const avecAcomptes = acomptesActifs(props.commande).length > 0;
  const [mode, setMode] = useState<"choix" | "articles">("choix");
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const q = (l: LigneCommande) => selection.get(l.uid) ?? 0;
  const regler = (l: LigneCommande, n: number) => setSelection((m) => reglerSelection(m, l, n));
  const totalSelection = lignes.reduce((s, l) => s + (q(l) ? montantPartiel(l, q(l)) : 0), 0);
  const nbSelection = lignes.reduce((s, l) => s + q(l), 0);

  if (mode === "choix") {
    return (
      <Modale titre="Diviser la note" onFermer={props.onFermer}>
        <div className="division-choix">
          <button className="bouton grand" disabled={avecAcomptes} onClick={() => setMode("articles")}>
            <AvecIcone icone={Split} taille={26}>
              Par articles
            </AvecIcone>
            <small>Chacun paie ce qu'il a pris : un ticket par personne, le reste demeure sur la table.</small>
          </button>
          <button className="bouton grand" onClick={props.onParts}>
            <AvecIcone icone={Users} taille={26}>
              En parts égales ou montant libre
            </AvecIcone>
            <small>Chacun verse sa part (ou un montant) ; la table reste ouverte jusqu'au dernier paiement, qui édite le ticket.</small>
          </button>
        </div>
        {avecAcomptes && (
          <p className="explication">Des acomptes sont déjà versés sur la table : le reste se règle en parts ou d'un montant.</p>
        )}
      </Modale>
    );
  }

  return (
    <Modale
      titre="Diviser par articles"
      large
      onFermer={props.onFermer}
      pied={
        <>
          <button className="bouton" onClick={() => setMode("choix")}>
            Retour
          </button>
          <button className="bouton principal grand" disabled={nbSelection === 0} onClick={() => props.onArticles(selection)}>
            <AvecIcone icone={Check}>{nbSelection ? `Encaisser la sélection · ${euros(totalSelection)}` : "Choisissez des articles"}</AvecIcone>
          </button>
        </>
      }
    >
      <p className="explication">Touchez un article pour le prendre en entier, ou réglez le nombre d'unités.</p>
      <SelectionArticles lignes={lignes} selection={selection} onRegler={regler} />
    </Modale>
  );
}

/**
 * Choix d'articles d'une commande, en entier ou en partie de leur quantité : division de la note
 * par articles, transfert d'articles vers une autre table.
 */
export function SelectionArticles(props: { lignes: LigneCommande[]; selection: ReadonlyMap<string, number>; onRegler: (l: LigneCommande, n: number) => void }) {
  const q = (l: LigneCommande) => props.selection.get(l.uid) ?? 0;
  const regler = props.onRegler;
  return (
    <ul className="division-lignes">
      {props.lignes.map((l) => (
        <li key={l.uid} className={q(l) ? "choisie" : ""}>
          <button className="division-libelle" aria-pressed={q(l) === l.quantite} onClick={() => regler(l, q(l) === l.quantite ? 0 : l.quantite)}>
            <span className="libelle-texte">
              {l.quantite > 1 ? `${l.quantite} × ` : ""}
              {l.libelle}
            </span>
            {l.details.length > 0 && <small>{l.details.join(" · ")}</small>}
          </button>
          {l.quantite > 1 && (
            <span className="division-qte">
              <BoutonIcone icone={Minus} variante="discret" libelle={`Une unité de moins : ${l.libelle}`} disabled={!q(l)} onClick={() => regler(l, q(l) - 1)} />
              <span aria-label={`${l.libelle} : unités choisies`}>
                {q(l)}/{l.quantite}
              </span>
              <BoutonIcone icone={Plus} variante="discret" libelle={`Une unité de plus : ${l.libelle}`} disabled={q(l) === l.quantite} onClick={() => regler(l, q(l) + 1)} />
            </span>
          )}
          <span className="montant">{q(l) ? euros(montantPartiel(l, q(l))) : euros(montantLigne(l))}</span>
        </li>
      ))}
    </ul>
  );
}

/** Réglage d'une sélection : `n` unités de la ligne (0 la retire), bornées à sa quantité. */
export function reglerSelection(m: ReadonlyMap<string, number>, l: LigneCommande, n: number): Map<string, number> {
  const suite = new Map(m);
  const v = Math.max(0, Math.min(l.quantite, n));
  if (v) suite.set(l.uid, v);
  else suite.delete(l.uid);
  return suite;
}
