import { ErreurFiscale, type ModePaiement, type Paiement, type Ticket } from "@matalon/noyau-fiscal";
import { useState } from "react";
import { ID_COMPTOIR } from "../../donnees/configuration";
import { gabaritNote, LIBELLES_PAIEMENT } from "../../impression/gabarits";
import { Recu } from "../../impression/recu";
import { totauxCommande, versSaisie, type Commande } from "../../metier/commande";
import { appliquerToucheMontant, Modale, Pave } from "../communs";
import { euros, useCaisse } from "../contexte";

const MODES: ModePaiement[] = ["CB", "ESPECES", "TITRE_RESTAURANT_CARTE", "TITRE_RESTAURANT_PAPIER"];
const BILLETS = [500, 1000, 2000, 5000];

/** Encaissement d'une commande : un ou plusieurs moyens de paiement, puis note et tiroir. */
export function ModaleEncaissement(props: { commande: Commande; onTermine: () => void; onFermer: () => void }) {
  const { caisse, config, utilisateur, notifier, imprimer } = useCaisse();
  const total = totauxCommande(props.commande).totalTTC;
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const paye = paiements.reduce((s, p) => s + p.montant, 0);
  const reste = Math.max(0, total - paye);
  const [saisie, setSaisie] = useState<number | null>(null);
  const montant = saisie ?? reste;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [enCours, setEnCours] = useState(false);

  const especes = paiements.filter((p) => p.mode === "ESPECES").reduce((s, p) => s + p.montant, 0);
  const excedent = paye - total;
  const valide = paye >= total && excedent <= especes;

  const ajouter = (mode: ModePaiement, m = montant) => {
    if (m <= 0) return;
    if (mode !== "ESPECES" && paye + m > total) {
      return notifier(`${LIBELLES_PAIEMENT[mode]} : le montant dépasse le reste à payer. Seules les espèces donnent lieu à un rendu.`, "erreur");
    }
    setPaiements((l) => [...l, { mode, montant: m }]);
    setSaisie(null);
  };

  const encaisser = async () => {
    setEnCours(true);
    try {
      const t = await caisse.registre.enregistrerVente({
        lignes: props.commande.lignes.map(versSaisie),
        paiements,
        operateurId: utilisateur.id,
        tableId: props.commande.tableId === ID_COMPTOIR ? null : props.commande.tableId,
        couverts: props.commande.couverts,
      });
      setTicket(t);
      const avecEspeces = paiements.some((p) => p.mode === "ESPECES");
      if (t.totalTTC >= config.seuilNoteAutomatique) {
        await imprimerNote(t, avecEspeces);
      } else if (avecEspeces) {
        await ouvrirTiroir(t);
      }
    } catch (e) {
      notifier(e instanceof ErreurFiscale ? e.message : `Encaissement impossible : ${String(e)}`, "erreur");
    } finally {
      setEnCours(false);
    }
  };

  const ouvrirTiroir = async (t: Ticket) => {
    if (!config.imprimante.adresse) return;
    await imprimer(new Recu().ouvrirTiroir(), "Tiroir-caisse");
    await caisse.registre.journaliser("OUVERTURE_TIROIR", { ticket: t.numero }, utilisateur.id);
  };

  const imprimerNote = async (t: Ticket, tiroir: boolean) => {
    const recu = gabaritNote(t, config);
    if (tiroir) recu.ouvrirTiroir();
    await imprimer(recu, `Note n° ${t.numero}`);
    await caisse.registre.journaliser("IMPRESSION_TICKET", { ticket: t.numero }, utilisateur.id);
    if (tiroir) await caisse.registre.journaliser("OUVERTURE_TIROIR", { ticket: t.numero }, utilisateur.id);
  };

  if (ticket) {
    const noteImprimee = ticket.totalTTC >= config.seuilNoteAutomatique;
    return (
      <Modale
        titre={`Ticket n° ${ticket.numero} encaissé`}
        onFermer={props.onTermine}
        pied={
          <>
            {!noteImprimee && (
              <button className="bouton" onClick={() => void imprimerNote(ticket, false)}>
                Imprimer la note
              </button>
            )}
            <button className="bouton principal" onClick={props.onTermine}>
              Terminé
            </button>
          </>
        }
      >
        {ticket.renduMonnaie > 0 ? (
          <div className="rendu">
            <span>Rendu monnaie</span>
            <strong>{euros(ticket.renduMonnaie)}</strong>
          </div>
        ) : (
          <div className="rendu calme">
            <span>Encaissé</span>
            <strong>{euros(ticket.totalTTC)}</strong>
          </div>
        )}
        <p className="explication">
          {noteImprimee ? "La note a été imprimée (montant au-delà du seuil)." : "La note est imprimée à la demande du client."}
        </p>
      </Modale>
    );
  }

  return (
    <Modale
      titre="Encaissement"
      large
      onFermer={props.onFermer}
      pied={
        <>
          <button className="bouton" disabled={paiements.length === 0} onClick={() => setPaiements([])}>
            Effacer les paiements
          </button>
          <button className="bouton principal grand" disabled={!valide || enCours} onClick={() => void encaisser()}>
            {enCours ? "Enregistrement…" : valide ? `Valider l'encaissement de ${euros(total)}` : `Reste ${euros(reste)}`}
          </button>
        </>
      }
    >
      <div className="encaissement">
        <div className="encaissement-etat">
          <div className="ligne-montant">
            <span>Total</span>
            <strong>{euros(total)}</strong>
          </div>
          {paiements.map((p, i) => (
            <div key={i} className="ligne-montant paiement">
              <span>{LIBELLES_PAIEMENT[p.mode]}</span>
              <span>
                {euros(p.montant)}
                <button
                  className="bouton discret"
                  aria-label={`Retirer le paiement ${LIBELLES_PAIEMENT[p.mode]}`}
                  onClick={() => setPaiements((l) => l.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
          <div className={`ligne-montant reste${reste === 0 ? " solde" : ""}`}>
            <span>{excedent > 0 ? "À rendre" : "Reste à payer"}</span>
            <strong>{euros(excedent > 0 ? excedent : reste)}</strong>
          </div>
        </div>
        <div className="encaissement-saisie">
          <div className="afficheur" aria-label="Montant saisi">
            {euros(montant)}
          </div>
          <Pave doubleZero onTouche={(t) => setSaisie((s) => appliquerToucheMontant(s ?? 0, t))} />
        </div>
        <div className="encaissement-modes">
          {MODES.map((m) => (
            <button key={m} className={`mode mode-${m.toLowerCase()}`} disabled={montant <= 0} onClick={() => ajouter(m)}>
              {LIBELLES_PAIEMENT[m]}
              <small>{euros(montant)}</small>
            </button>
          ))}
          <div className="billets">
            {BILLETS.filter((b) => b >= reste || b === BILLETS.at(-1)).map((b) => (
              <button key={b} className="option" disabled={reste === 0} onClick={() => ajouter("ESPECES", b)}>
                {euros(b)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modale>
  );
}
