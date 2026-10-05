import { useState } from "react";
import { avecQuantite, montantLigne, montantRemise, type LigneCommande } from "../../metier/commande";
import { Modale } from "../communs";
import { euros, useCaisse } from "../contexte";

const MOTIFS = ["Geste commercial", "Client habitué", "Erreur de service", "Repas du personnel", "Offert maison"];
const POURCENTAGES = [10, 20, 50, 100];

/** Quantité, remise ou retrait d'une ligne de commande. Tout retrait est tracé au journal. */
export function ModaleLigne(props: {
  ligne: LigneCommande;
  tableId: string;
  onChange: (l: LigneCommande | null) => void;
  onFermer: () => void;
}) {
  const { caisse, utilisateur, demanderResponsable } = useCaisse();
  const l = props.ligne;
  const [quantite, setQuantite] = useState(l.quantite);
  const [pourcentage, setPourcentage] = useState(l.remise?.pourcentage ?? 0);
  const [motif, setMotif] = useState(l.remise?.motif ?? "");
  const [erreur, setErreur] = useState("");

  const tracerRetrait = (unites: number) =>
    caisse.registre.journaliser(
      "SUPPRESSION_LIGNE",
      {
        table: props.tableId,
        article: l.libelle,
        quantite: unites,
        montantTTC: unites * l.prixUnitaireTTC,
        ajouteeLe: l.ajouteeLe,
      },
      utilisateur.id,
    );

  const valider = async () => {
    if (pourcentage > 0 && !motif) return setErreur("Choisissez le motif de la remise.");
    let accordeePar = l.remise?.accordeePar ?? utilisateur.id;
    const remiseChangee = pourcentage !== (l.remise?.pourcentage ?? 0) || (pourcentage > 0 && motif !== l.remise?.motif);
    if (remiseChangee && pourcentage > 0) {
      const id = await demanderResponsable(`Remise de ${pourcentage === 100 ? "100 % (offert)" : `${pourcentage} %`} sur ${l.libelle}.`);
      if (!id) return;
      accordeePar = id;
    }
    if (quantite < l.quantite) await tracerRetrait(l.quantite - quantite);
    const suite = avecQuantite({ ...l, remise: undefined }, quantite);
    if (pourcentage > 0) {
      suite.remise = { pourcentage, motif, accordeePar, montantTTC: montantRemise(quantite * l.prixUnitaireTTC, pourcentage) };
    }
    props.onChange(suite);
  };

  const supprimer = async () => {
    await tracerRetrait(l.quantite);
    props.onChange(null);
  };

  const apercu = avecQuantite(
    pourcentage > 0 ? { ...l, remise: { pourcentage, motif: motif || "-", accordeePar: "", montantTTC: 0 } } : { ...l, remise: undefined },
    quantite,
  );

  return (
    <Modale
      titre={l.libelle}
      onFermer={props.onFermer}
      pied={
        <>
          <button className="bouton danger" onClick={() => void supprimer()}>
            Retirer de la commande
          </button>
          <button className="bouton principal" onClick={() => void valider()}>
            Valider · {euros(montantLigne(apercu))}
          </button>
        </>
      }
    >
      {l.details.length > 0 && <p className="explication">{l.details.join(" · ")}</p>}
      <section className="groupe-choix">
        <h3>Quantité</h3>
        <div className="quantite">
          <button className="bouton" onClick={() => setQuantite((q) => Math.max(1, q - 1))} aria-label="Un de moins">
            −
          </button>
          <span>{quantite}</span>
          <button className="bouton" onClick={() => setQuantite((q) => q + 1)} aria-label="Un de plus">
            +
          </button>
        </div>
      </section>
      <section className="groupe-choix">
        <h3>Remise</h3>
        <div className="options">
          <button className={`option${pourcentage === 0 ? " active" : ""}`} onClick={() => setPourcentage(0)}>
            Aucune
          </button>
          {POURCENTAGES.map((p) => (
            <button key={p} className={`option${pourcentage === p ? " active" : ""}`} onClick={() => setPourcentage(p)}>
              {p === 100 ? "Offert" : `${p} %`}
            </button>
          ))}
        </div>
        {pourcentage > 0 && (
          <>
            <h3>Motif</h3>
            <div className="options">
              {MOTIFS.map((m) => (
                <button key={m} className={`option${motif === m ? " active" : ""}`} onClick={() => setMotif(m)}>
                  {m}
                </button>
              ))}
            </div>
            <p className="explication">Une remise est validée par un responsable et figure au journal.</p>
          </>
        )}
        {erreur && <p className="erreur">{erreur}</p>}
      </section>
    </Modale>
  );
}
