import { ErreurFiscale, type Ticket } from "@matalon/noyau-fiscal";
import { useCallback, useEffect, useState } from "react";
import { gabaritNote, LIBELLES_PAIEMENT, nomTable, nomUtilisateur } from "../impression/gabarits";
import { Modale, Vide } from "./communs";
import { euros, useCaisse } from "./contexte";

const MOTIFS_ANNULATION = ["Erreur de saisie", "Erreur de table", "Client parti sans consommer", "Réclamation client"];

/** Derniers tickets : détail, duplicata, annulation. */
export function Tickets() {
  const { caisse, config, utilisateur, notifier, imprimer, demanderResponsable } = useCaisse();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [annules, setAnnules] = useState<Set<number>>(new Set());
  const [choisi, setChoisi] = useState<Ticket | null>(null);
  const [annulation, setAnnulation] = useState<Ticket | null>(null);
  const [motif, setMotif] = useState("");

  const charger = useCallback(async () => {
    const liste = await caisse.stockage.derniers("tickets", 150);
    setTickets(liste);
    setAnnules(new Set(liste.filter((t) => t.ticketOrigine).map((t) => t.ticketOrigine!.numero)));
  }, [caisse.stockage]);

  useEffect(() => void charger(), [charger]);

  const duplicata = async (t: Ticket) => {
    const evts = await caisse.stockage.lister("evenements");
    const deja = evts.filter((e) => e.code === "REIMPRESSION_TICKET" && e.details.ticket === t.numero).length;
    await imprimer(gabaritNote(t, config, deja + 1), `Duplicata n° ${deja + 1}`);
    await caisse.registre.journaliser("REIMPRESSION_TICKET", { ticket: t.numero, duplicata: deja + 1 }, utilisateur.id);
  };

  const annuler = async () => {
    if (!annulation || !motif) return;
    const responsable = await demanderResponsable(`Annulation du ticket n° ${annulation.numero} (${euros(annulation.totalTTC)}).`);
    if (!responsable) return;
    try {
      const a = await caisse.registre.enregistrerAnnulation({ numeroTicket: annulation.numero, motif, operateurId: responsable });
      await imprimer(gabaritNote(a, config), `Annulation n° ${a.numero}`);
      await caisse.registre.journaliser("IMPRESSION_TICKET", { ticket: a.numero }, utilisateur.id);
      notifier(`Ticket n° ${annulation.numero} annulé par le ticket n° ${a.numero}.`);
      setAnnulation(null);
      setChoisi(null);
      setMotif("");
      await charger();
    } catch (e) {
      notifier(e instanceof ErreurFiscale ? e.message : String(e), "erreur");
    }
  };

  return (
    <div className="page">
      <header className="page-tete">
        <h1>Tickets</h1>
        <p>Les 150 derniers tickets. Un ticket ne se modifie pas : une erreur se corrige par une annulation.</p>
      </header>
      {tickets.length === 0 ? (
        <Vide>Aucun ticket pour l'instant. Ils apparaîtront ici après le premier encaissement.</Vide>
      ) : (
        <table className="tableau">
          <thead>
            <tr>
              <th>N°</th>
              <th>Heure</th>
              <th>Table</th>
              <th>Par</th>
              <th>Paiement</th>
              <th className="nombre">Montant</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.numero} onClick={() => setChoisi(t)} className={t.type === "ANNULATION" ? "annulation" : annules.has(t.numero) ? "annule" : ""}>
                <td>{t.numero}</td>
                <td>
                  {new Date(t.horodatage).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td>{nomTable(config, t.tableId)}</td>
                <td>{nomUtilisateur(config, t.operateurId)}</td>
                <td>{t.paiements.map((p) => LIBELLES_PAIEMENT[p.mode]).join(", ") || "—"}</td>
                <td className="nombre">{euros(t.totalTTC)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {choisi && !annulation && (
        <Modale
          titre={`${choisi.type === "ANNULATION" ? "Annulation" : "Ticket"} n° ${choisi.numero}`}
          onFermer={() => setChoisi(null)}
          pied={
            <>
              {choisi.type === "VENTE" && !annules.has(choisi.numero) && (
                <button className="bouton danger" onClick={() => setAnnulation(choisi)}>
                  Annuler ce ticket
                </button>
              )}
              <button className="bouton" onClick={() => void duplicata(choisi)}>
                Imprimer un duplicata
              </button>
            </>
          }
        >
          {annules.has(choisi.numero) && <p className="erreur">Ce ticket a été annulé.</p>}
          {choisi.motif && <p className="explication">Motif : {choisi.motif}</p>}
          <ul className="detail-lignes">
            {choisi.lignes.map((l, i) => (
              <li key={i}>
                <span>
                  {l.quantite} × {l.libelle}
                  {l.remiseTTC !== 0 && <small> · remise {euros(l.remiseTTC)} ({l.motifRemise})</small>}
                </span>
                <span>{euros(l.montantTTC)}</span>
              </li>
            ))}
            <li className="total">
              <span>Total</span>
              <span>{euros(choisi.totalTTC)}</span>
            </li>
          </ul>
        </Modale>
      )}

      {annulation && (
        <Modale
          titre={`Annuler le ticket n° ${annulation.numero}`}
          onFermer={() => setAnnulation(null)}
          pied={
            <button className="bouton danger" disabled={!motif} onClick={() => void annuler()}>
              Annuler {euros(annulation.totalTTC)}
            </button>
          }
        >
          <p className="explication">
            Un ticket négatif de {euros(-annulation.totalTTC)} sera émis. Les paiements sont remboursés sur les mêmes moyens :{" "}
            {annulation.paiements.map((p) => `${LIBELLES_PAIEMENT[p.mode]} ${euros(p.montant)}`).join(", ") || "aucun"}.
          </p>
          <h3>Motif</h3>
          <div className="options">
            {MOTIFS_ANNULATION.map((m) => (
              <button key={m} className={`option${motif === m ? " active" : ""}`} onClick={() => setMotif(m)}>
                {m}
              </button>
            ))}
          </div>
        </Modale>
      )}
    </div>
  );
}
