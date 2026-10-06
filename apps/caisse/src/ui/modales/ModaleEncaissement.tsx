import { Banknote, Check, CreditCard, Printer, Ticket as TicketPapier, Trash2, Undo2, X, type LucideIcon } from "lucide-react";
import { AvecIcone } from "../icones";
import { ErreurFiscale, type ModePaiement, type Paiement, type Ticket } from "@matalon/noyau-fiscal";
import { useState } from "react";
import { ID_COMPTOIR } from "../../donnees/configuration";
import { MODE_TEST } from "../../fiscal/caisse";
import { gabaritNote, LIBELLES_PAIEMENT } from "../../impression/gabarits";
import { Recu } from "../../impression/recu";
import { lignesActives, totauxCommande, versSaisie, type Commande } from "../../metier/commande";
import { appliquerToucheMontant, Modale, Pave } from "../communs";
import { euros, useCaisse } from "../contexte";
import { QrNote, urlNoteTicket } from "../QrNote";

const MODES: ModePaiement[] = ["CB", "ESPECES", "TITRE_RESTAURANT_CARTE", "TITRE_RESTAURANT_PAPIER"];
const ICONES_PAIEMENT: Record<ModePaiement, LucideIcon> = {
  CB: CreditCard,
  ESPECES: Banknote,
  TITRE_RESTAURANT_CARTE: CreditCard,
  TITRE_RESTAURANT_PAPIER: TicketPapier,
  AUTRE: Banknote,
};
const BILLETS = [500, 1000, 2000, 5000];
/** Au-delà de ce rendu (centimes), la caisse demande confirmation : faute de frappe probable. */
const RENDU_A_CONFIRMER = 2000;

/** Encaissement d'une commande : un ou plusieurs moyens de paiement, puis note et tiroir. */
export function ModaleEncaissement(props: { commande: Commande; onTermine: () => void; onFermer: () => void }) {
  const { caisse, config, utilisateur, notifier, imprimer, imprimanteConfiguree, blocage } = useCaisse();
  const [noteImprimee, setNoteImprimee] = useState(false);
  const total = totauxCommande(props.commande).totalTTC;
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const paye = paiements.reduce((s, p) => s + p.montant, 0);
  const reste = Math.max(0, total - paye);
  const [saisie, setSaisie] = useState<number | null>(null);
  const montant = saisie ?? reste;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [enCours, setEnCours] = useState(false);
  /** Paiement en espèces qui laisserait un gros rendu, en attente de confirmation. */
  const [renduAConfirmer, setRenduAConfirmer] = useState<{ montant: number; rendu: number } | null>(null);

  const especes = paiements.filter((p) => p.mode === "ESPECES").reduce((s, p) => s + p.montant, 0);
  const excedent = paye - total;
  const valide = paye >= total && excedent <= especes;

  const ajouter = (mode: ModePaiement, m = montant) => {
    if (m <= 0) return;
    if (reste === 0) return notifier("Le total est déjà réglé : retirez un paiement pour en changer.", "erreur");
    if (mode !== "ESPECES" && paye + m > total) {
      return notifier(`${LIBELLES_PAIEMENT[mode]} : le montant dépasse le reste à payer. Seules les espèces donnent lieu à un rendu.`, "erreur");
    }
    if (mode === "ESPECES" && m - reste > RENDU_A_CONFIRMER && !renduAConfirmer) {
      return setRenduAConfirmer({ montant: m, rendu: m - reste });
    }
    setRenduAConfirmer(null);
    setPaiements((l) => [...l, { mode, montant: m }]);
    setSaisie(null);
  };

  const encaisser = async () => {
    if (blocage) return notifier(blocage, "erreur");
    setEnCours(true);
    try {
      const t = await caisse.registre.enregistrerVente({
        lignes: lignesActives(props.commande).map(versSaisie),
        paiements,
        operateurId: utilisateur.id,
        tableId: props.commande.tableId === ID_COMPTOIR ? null : props.commande.tableId,
        couverts: props.commande.couverts,
      });
      setTicket(t);
      // Sans imprimante, rien ne sort : la note passe par le QR code.
      if (imprimanteConfiguree) {
        const avecEspeces = paiements.some((p) => p.mode === "ESPECES");
        if (t.totalTTC >= config.seuilNoteAutomatique) {
          await imprimerNote(t, avecEspeces);
          setNoteImprimee(true);
        } else if (avecEspeces) {
          await ouvrirTiroir(t);
        }
      }
    } catch (e) {
      notifier(e instanceof ErreurFiscale ? e.message : `Encaissement impossible : ${String(e)}`, "erreur");
    } finally {
      setEnCours(false);
    }
  };

  const ouvrirTiroir = async (t: Ticket) => {
    await imprimer(new Recu().ouvrirTiroir(), "Tiroir-caisse");
    await caisse.registre.journaliser("OUVERTURE_TIROIR", { ticket: t.numero }, utilisateur.id);
  };

  const imprimerNote = async (t: Ticket, tiroir: boolean) => {
    const recu = gabaritNote(t, config);
    if (tiroir) recu.ouvrirTiroir();
    await imprimer(recu, `Note n° ${t.numero}`);
    await caisse.registre.journaliser(
      "IMPRESSION_TICKET",
      { ticket: t.numero, canal: imprimanteConfiguree ? "papier" : "ecran" },
      utilisateur.id,
    );
    if (tiroir) await caisse.registre.journaliser("OUVERTURE_TIROIR", { ticket: t.numero }, utilisateur.id);
  };

  if (ticket) {
    const auDelaSeuil = ticket.totalTTC >= config.seuilNoteAutomatique;
    return (
      <Modale
        titre={`Ticket n° ${ticket.numero} encaissé`}
        large
        onFermer={props.onTermine}
        pied={
          <>
            {!noteImprimee && (
              <button
                className="bouton"
                onClick={() => void imprimerNote(ticket, false).then(() => imprimanteConfiguree && setNoteImprimee(true))}
              >
                <AvecIcone icone={Printer}>{imprimanteConfiguree ? "Imprimer la note" : "Voir la note"}</AvecIcone>
              </button>
            )}
            <button className="bouton principal" onClick={props.onTermine}>
              <AvecIcone icone={Check}>Terminé</AvecIcone>
            </button>
          </>
        }
      >
        <div className="fin-encaissement">
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
          <QrNote url={urlNoteTicket(ticket, config)} />
        </div>
        {noteImprimee && <p className="explication">La note a été imprimée (montant de {euros(config.seuilNoteAutomatique)} ou plus).</p>}
        {!imprimanteConfiguree && auDelaSeuil && !MODE_TEST && (
          <p className="erreur">
            Au-delà de {euros(config.seuilNoteAutomatique)}, la note doit être remise imprimée : connectez l'imprimante dans les
            réglages.
          </p>
        )}
      </Modale>
    );
  }

  return (
    <Modale
      titre="Encaissement"
      large
      onFermer={props.onFermer}
      pied={
        renduAConfirmer ? (
          // Dans le pied, toujours visible même quand le corps défile (iPhone).
          <div className="confirmation-rendu" role="alertdialog" aria-label="Confirmer le rendu">
            <p>
              {euros(renduAConfirmer.montant)} en espèces pour {euros(reste)} à payer : rendre <strong>{euros(renduAConfirmer.rendu)}</strong> ?
            </p>
            <div className="options">
              <button
                className="bouton"
                onClick={() => {
                  setRenduAConfirmer(null);
                  setSaisie(null);
                }}
              >
                <AvecIcone icone={Undo2}>Corriger</AvecIcone>
              </button>
              <button className="bouton principal" onClick={() => ajouter("ESPECES", renduAConfirmer.montant)}>
                <AvecIcone icone={Check}>Oui, rendre {euros(renduAConfirmer.rendu)}</AvecIcone>
              </button>
            </div>
          </div>
        ) : (
          <>
            <button className="bouton" disabled={paiements.length === 0} onClick={() => setPaiements([])}>
              <AvecIcone icone={Trash2}>Effacer les paiements</AvecIcone>
            </button>
            <button className="bouton principal grand" disabled={!valide || enCours || !!blocage} onClick={() => void encaisser()}>
              <AvecIcone icone={Check}>{blocage ? "Encaissement bloqué" : enCours ? "Enregistrement…" : valide ? `Valider l'encaissement de ${euros(total)}` : `Reste ${euros(reste)}`}</AvecIcone>
            </button>
          </>
        )
      }
    >
      {blocage && <p className="erreur">{blocage}</p>}
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
                  title={`Retirer le paiement ${LIBELLES_PAIEMENT[p.mode]}`}
                  onClick={() => setPaiements((l) => l.filter((_, j) => j !== i))}
                >
                  <X className="icone" size={20} aria-hidden="true" />
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
              <AvecIcone icone={ICONES_PAIEMENT[m]} taille={26}>{LIBELLES_PAIEMENT[m]}</AvecIcone>
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
