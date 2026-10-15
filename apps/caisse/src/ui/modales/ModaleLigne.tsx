import { Check, Minus, Plus, Trash2 } from "lucide-react";
import { AvecIcone } from "../icones";
import { useState } from "react";
import { avecQuantite, montantLigne, montantRemise, nomCourtSuite, SUITES, suiteDe, type LigneCommande, type Suite } from "../../metier/commande";
import { Modale } from "../communs";
import { euros, useCaisse } from "../contexte";

const MOTIFS = ["Geste commercial", "Client habitué", "Erreur de service", "Repas du personnel", "Offert maison"];
const POURCENTAGES = [10, 20, 50, 100];
const NOTES_RAPIDES = ["Sans sucre", "Lait végétal", "Sans glace", "Allergie", "À servir après"];
/** Motifs d'un retrait après envoi (article déjà parti en préparation). */
export const MOTIFS_RETRAIT = ["Erreur de saisie", "Client a changé d'avis", "Produit indisponible", "Produit raté ou renversé", "Attente trop longue"];

/**
 * Quantité, remise ou retrait d'une ligne de commande. Avant envoi, la
 * commande est un brouillon : un retrait efface sans trace. Après envoi, il
 * est barré et tracé au journal.
 */
export function ModaleLigne(props: {
  ligne: LigneCommande;
  tableId: string;
  /** Table (pas le comptoir) : la suite d'un article pas encore envoyé se change ici. */
  avecSuites?: boolean;
  /** `unitesRetirees` : quantité retirée, qui restera affichée barrée. */
  onChange: (l: LigneCommande | null, unitesRetirees: number) => void;
  onFermer: () => void;
}) {
  const { caisse, utilisateur, demanderResponsable } = useCaisse();
  const l = props.ligne;
  const [quantite, setQuantite] = useState(l.quantite);
  const [pourcentage, setPourcentage] = useState(l.remise?.pourcentage ?? 0);
  const [motif, setMotif] = useState(l.remise?.motif ?? "");
  const [erreur, setErreur] = useState("");
  const [note, setNote] = useState(l.note ?? "");
  const [suite, setSuite] = useState<Suite>(suiteDe(l));
  /** Retrait d'un article déjà envoyé, en attente de son motif (puis du code d'un responsable). */
  const [retrait, setRetrait] = useState<{ unites: number; suite: () => void } | null>(null);

  const tracerRetrait = async (unites: number, motif: string, autorisePar: string) => {
    await caisse.registre.journaliser(
      "SUPPRESSION_LIGNE",
      {
        table: props.tableId,
        article: l.libelle,
        quantite: unites,
        montantTTC: unites * l.prixUnitaireTTC,
        ajouteeLe: l.ajouteeLe,
        // Déjà parti en production : un bon d'annulation suit.
        apresEnvoi: true,
        motif,
        autorisePar,
      },
      utilisateur.id,
    );
  };

  /**
   * Un article déjà envoyé ne se retire qu'avec un motif et l'accord d'un responsable (son code si
   * un serveur est connecté) : c'est une annulation, comptée dans les statistiques. Avant envoi, rien.
   */
  const retirer = (unites: number, suite: () => void) => {
    if (!l.envoyee || unites <= 0) return suite();
    setRetrait({ unites, suite });
  };
  const confirmerRetrait = async (motifRetrait: string) => {
    if (!retrait) return;
    const id = await demanderResponsable(`Retrait de ${retrait.unites} × ${l.libelle}, déjà envoyé (${motifRetrait}).`);
    if (!id) return;
    await tracerRetrait(retrait.unites, motifRetrait, id);
    retrait.suite();
  };

  const valider = async () => {
    if (pourcentage > 0 && !motif) return setErreur("Choisissez le motif de la remise.");
    let accordeePar = l.remise?.accordeePar ?? utilisateur.id;
    const remiseChangee = pourcentage !== (l.remise?.pourcentage ?? 0) || (pourcentage > 0 && motif !== l.remise?.motif);
    if (remiseChangee && pourcentage > 0) {
      const id = await demanderResponsable(`Remise de ${pourcentage === 100 ? "100 % (offert)" : `${pourcentage} %`} sur ${l.libelle}.`);
      if (!id) return;
      accordeePar = id;
    }
    const unites = Math.max(0, l.quantite - quantite);
    const { suite: _, ...sansSuite } = l;
    const maj = avecQuantite({ ...sansSuite, ...(suite ? { suite } : {}), remise: undefined, note: note.trim() || undefined }, quantite);
    if (pourcentage > 0) {
      maj.remise = { pourcentage, motif, accordeePar, montantTTC: montantRemise(quantite * l.prixUnitaireTTC, pourcentage) };
    }
    retirer(unites, () => props.onChange(maj, unites));
  };

  const supprimer = () => retirer(l.quantite, () => props.onChange(null, l.quantite));

  if (retrait) {
    return (
      <Modale titre={`Retirer ${retrait.unites} × ${l.libelle}`} onFermer={() => setRetrait(null)}>
        <p className="explication">
          Déjà envoyé en préparation : le retrait compte comme une annulation (statistiques, journal) et imprime un bon d'annulation.
          {utilisateur.role !== "responsable" ? " Un responsable le valide avec son code." : ""}
        </p>
        <h3>Motif</h3>
        <div className="options">
          {MOTIFS_RETRAIT.map((m) => (
            <button key={m} className="option" onClick={() => void confirmerRetrait(m)}>
              {m}
            </button>
          ))}
        </div>
      </Modale>
    );
  }

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
            <AvecIcone icone={Trash2}>{l.envoyee ? "Retirer de la commande" : "Supprimer"}</AvecIcone>
          </button>
          <button className="bouton principal" onClick={() => void valider()}>
            <AvecIcone icone={Check}>Valider · {euros(montantLigne(apercu))}</AvecIcone>
          </button>
        </>
      }
    >
      {l.details.length > 0 && <p className="explication">{l.details.join(" · ")}</p>}
      <section className="groupe-choix">
        <h3>Quantité</h3>
        <div className="quantite">
          <button className="bouton" onClick={() => setQuantite((q) => Math.max(1, q - 1))} aria-label="Un de moins">
            <Minus className="icone" size={22} aria-hidden="true" />
          </button>
          <span>{quantite}</span>
          <button className="bouton" onClick={() => setQuantite((q) => q + 1)} aria-label="Un de plus">
            <Plus className="icone" size={22} aria-hidden="true" />
          </button>
        </div>
      </section>
      {props.avecSuites && !l.envoyee && (
        <section className="groupe-choix">
          <h3>Suite</h3>
          <div className="options compactes">
            {SUITES.map((x) => (
              <button key={x} className={`option${suite === x ? " active" : ""}`} onClick={() => setSuite(x)}>
                {nomCourtSuite(x)}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="groupe-choix">
        <h3>Note pour le service</h3>
        <div className="options">
          {NOTES_RAPIDES.map((n) => (
            <button
              key={n}
              className={`option${note.includes(n) ? " active" : ""}`}
              onClick={() => setNote((x) => (x.includes(n) ? x.replace(n, "").replace(/^[\s,]+|[\s,]+$/g, "").replace(/,\s*,/g, ",") : x ? `${x}, ${n}` : n))}
            >
              {n}
            </button>
          ))}
        </div>
        <input className="saisie-note" value={note} maxLength={120} placeholder="Précision libre" onChange={(e) => setNote(e.target.value)} />
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
