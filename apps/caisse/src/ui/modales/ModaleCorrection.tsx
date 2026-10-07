import { ErreurFiscale, type ModePaiement, type Paiement, type Ticket } from "@matalon/noyau-fiscal";
import { Banknote, Check, CreditCard, Ticket as TicketPapier, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { LIBELLES_PAIEMENT } from "../../impression/gabarits";
import { centimesDepuisSaisie, Modale, saisieDepuisCentimes } from "../communs";
import { euros, useCaisse } from "../contexte";
import { AvecIcone } from "../icones";

const MODES: Array<[ModePaiement, LucideIcon]> = [
  ["CB", CreditCard],
  ["ESPECES", Banknote],
  ["TITRE_RESTAURANT_CARTE", CreditCard],
  ["TITRE_RESTAURANT_PAPIER", TicketPapier],
];
const MOTIFS = ["Erreur de mode de paiement", "Paiement en plusieurs moyens oublié", "Mauvaise répartition"];

/**
 * Correction des moyens de paiement d'une vente du jour (avant la Z) : on
 * indique ce que le client a réellement payé. Le ticket reste tel quel ; un
 * ticket de correction, validé par un responsable, porte l'écart.
 */
export function ModaleCorrection(props: { ticket: Ticket; avant: Paiement[]; onCorrige: (c: Ticket) => void; onFermer: () => void }) {
  const { caisse, demanderResponsable, notifier } = useCaisse();
  const total = props.ticket.totalTTC;
  const [modes, setModes] = useState<ModePaiement[]>([]);
  const [saisies, setSaisies] = useState<Partial<Record<ModePaiement, string>>>({});
  const [motif, setMotif] = useState(MOTIFS[0]!);
  const [enCours, setEnCours] = useState(false);

  // Un seul moyen : tout le total ; plusieurs : montants saisis, le dernier complète.
  const paiements: Paiement[] = modes.map((mode, i) => {
    if (modes.length === 1) return { mode, montant: total };
    if (i === modes.length - 1) {
      const autres = modes.slice(0, -1).reduce((s, m) => s + (centimesDepuisSaisie(saisies[m] ?? "") ?? 0), 0);
      return { mode, montant: total - autres };
    }
    return { mode, montant: centimesDepuisSaisie(saisies[mode] ?? "") ?? 0 };
  });
  const valide = paiements.length > 0 && paiements.every((p) => p.montant > 0) && paiements.reduce((s, p) => s + p.montant, 0) === total;

  const basculer = (m: ModePaiement) => setModes((l) => (l.includes(m) ? l.filter((x) => x !== m) : [...l, m]));

  const corriger = async () => {
    const responsable = await demanderResponsable(`Correction du paiement du ticket n° ${props.ticket.numero} (${euros(total)}).`);
    if (!responsable) return;
    setEnCours(true);
    try {
      const c = await caisse.registre.enregistrerCorrection({ numeroTicket: props.ticket.numero, paiements, motif, operateurId: responsable });
      notifier(`Paiement du ticket n° ${props.ticket.numero} corrigé (ticket n° ${c.numero}).`);
      props.onCorrige(c);
    } catch (e) {
      notifier(e instanceof ErreurFiscale ? e.message : String(e), "erreur");
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Modale
      titre={`Corriger le paiement du ticket n° ${props.ticket.numero}`}
      onFermer={props.onFermer}
      pied={
        <button className="bouton principal" disabled={!valide || enCours} onClick={() => void corriger()}>
          <AvecIcone icone={Check}>Corriger · {euros(total)}</AvecIcone>
        </button>
      }
    >
      <p className="explication">
        Enregistré : {props.avant.map((p) => `${LIBELLES_PAIEMENT[p.mode]} ${euros(p.montant)}`).join(", ")}. Touchez ce que le client a
        réellement payé ; le ticket reste intact et une correction validée par un responsable est ajoutée.
      </p>
      <div className="encaissement-modes">
        {MODES.map(([m, icone]) => (
          <button key={m} className={`mode mode-${m.toLowerCase()}${modes.includes(m) ? " choisi" : ""}`} aria-pressed={modes.includes(m)} onClick={() => basculer(m)}>
            <AvecIcone icone={icone} taille={26}>
              {LIBELLES_PAIEMENT[m]}
            </AvecIcone>
            {modes.includes(m) && <small>{euros(paiements.find((p) => p.mode === m)!.montant)}</small>}
          </button>
        ))}
      </div>
      {modes.length > 1 && (
        <div className="repartition">
          {modes.slice(0, -1).map((m) => (
            <label key={m} className="champ">
              <span>{LIBELLES_PAIEMENT[m]}</span>
              <input
                inputMode="decimal"
                value={saisies[m] ?? ""}
                placeholder="0,00"
                onChange={(e) => setSaisies((s) => ({ ...s, [m]: e.target.value }))}
                onBlur={(e) => {
                  const c = centimesDepuisSaisie(e.target.value);
                  if (c != null) setSaisies((s) => ({ ...s, [m]: saisieDepuisCentimes(c) }));
                }}
              />
            </label>
          ))}
          <p className="aide-champ">
            {LIBELLES_PAIEMENT[modes.at(-1)!]} complète : {euros(paiements.at(-1)!.montant)}
          </p>
        </div>
      )}
      <h3>Motif</h3>
      <div className="options">
        {MOTIFS.map((m) => (
          <button key={m} className={`option${motif === m ? " active" : ""}`} onClick={() => setMotif(m)}>
            {m}
          </button>
        ))}
      </div>
    </Modale>
  );
}
