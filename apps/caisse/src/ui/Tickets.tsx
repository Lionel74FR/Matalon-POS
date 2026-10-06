import { ErreurFiscale, type Ticket } from "@matalon/noyau-fiscal";
import { useCallback, useEffect, useState } from "react";
import { gabaritNote, LIBELLES_PAIEMENT, nomTable, nomUtilisateur } from "../impression/gabarits";
import { Modale, Vide } from "./communs";
import { euros, useCaisse } from "./contexte";
import { QrNote, urlNoteTicket } from "./QrNote";
import { ModaleFacture } from "./modales/ModaleFacture";
import { emettreAvoir, listerFactures } from "../metier/facture";

const MOTIFS_ANNULATION = ["Erreur de saisie", "Erreur de table", "Client parti sans consommer", "Réclamation client"];

/** Derniers tickets : détail, duplicata, annulation. */
export function Tickets() {
  const { caisse, config, utilisateur, notifier, imprimer, demanderResponsable, imprimanteConfiguree } = useCaisse();
  const [qr, setQr] = useState<{ ticket: Ticket; url: string } | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [annules, setAnnules] = useState<Set<number>>(new Set());
  const [choisi, setChoisi] = useState<Ticket | null>(null);
  const [annulation, setAnnulation] = useState<Ticket | null>(null);
  const [motif, setMotif] = useState("");
  const [factureDe, setFactureDe] = useState<Ticket | null>(null);
  const [factures, setFactures] = useState<Map<number, string>>(new Map());
  /** Ventes facturées (numéro de ticket → numéro de facture), pour proposer l'avoir manquant. */
  const [ventesFacturees, setVentesFacturees] = useState<Set<number>>(new Set());

  const charger = useCallback(async () => {
    const liste = await caisse.stockage.derniers("tickets", 150);
    setTickets(liste);
    setAnnules(new Set(liste.filter((t) => t.ticketOrigine).map((t) => t.ticketOrigine!.numero)));
    const emises = await listerFactures(caisse.stockage);
    setFactures(new Map(emises.map((f) => [f.ticket, f.numero])));
    setVentesFacturees(new Set(emises.filter((f) => f.nature === "FACTURE").map((f) => f.ticket)));
  }, [caisse.stockage]);

  useEffect(() => void charger(), [charger]);

  /** Numéro du prochain duplicata d'un ticket, papier ou QR code confondus. */
  const prochainDuplicata = async (t: Ticket) => {
    const evts = await caisse.stockage.lister("evenements");
    return evts.filter((e) => e.code === "REIMPRESSION_TICKET" && e.details.ticket === t.numero).length + 1;
  };

  const duplicata = async (t: Ticket) => {
    const n = await prochainDuplicata(t);
    await imprimer(gabaritNote(t, config, n), `Duplicata n° ${n}`);
    await caisse.registre.journaliser(
      "REIMPRESSION_TICKET",
      { ticket: t.numero, duplicata: n, canal: imprimanteConfiguree ? "papier" : "ecran" },
      utilisateur.id,
    );
  };

  const duplicataQr = async (t: Ticket) => {
    const n = await prochainDuplicata(t);
    await caisse.registre.journaliser("REIMPRESSION_TICKET", { ticket: t.numero, duplicata: n, canal: "qr" }, utilisateur.id);
    setQr({ ticket: t, url: urlNoteTicket(t, config, n) });
  };

  const rattraperAvoir = async (a: Ticket) => {
    try {
      const avoir = await emettreAvoir(caisse.registre, caisse.stockage, { annulation: a, operateurId: utilisateur.id, caisseId: config.caisseId });
      if (avoir) notifier(`Avoir n° ${avoir.numero} émis.`);
      await charger();
    } catch (e) {
      notifier(String(e), "erreur");
    }
  };

  const annuler = async () => {
    if (!annulation || !motif) return;
    const responsable = await demanderResponsable(`Annulation du ticket n° ${annulation.numero} (${euros(annulation.totalTTC)}).`);
    if (!responsable) return;
    try {
      const a = await caisse.registre.enregistrerAnnulation({ numeroTicket: annulation.numero, motif, operateurId: responsable });
      // Vente déjà facturée : l'avoir suit immédiatement l'annulation (rattrapable depuis le ticket s'il manquait).
      const avoir = await emettreAvoir(caisse.registre, caisse.stockage, { annulation: a, operateurId: responsable, caisseId: config.caisseId });
      if (imprimanteConfiguree) {
        await imprimer(gabaritNote(a, config), `Annulation n° ${a.numero}`);
        await caisse.registre.journaliser("IMPRESSION_TICKET", { ticket: a.numero, canal: "papier" }, utilisateur.id);
      }
      notifier(`Ticket n° ${annulation.numero} annulé par le ticket n° ${a.numero}${avoir ? `, avoir n° ${avoir.numero} émis` : ""}.`);
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
        <table className="tableau tableau-tickets">
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
              {(choisi.type === "VENTE" ? !annules.has(choisi.numero) || factures.has(choisi.numero) : factures.has(choisi.numero)) && (
                <button className="bouton" onClick={() => setFactureDe(choisi)}>
                  {factures.has(choisi.numero) ? (choisi.type === "VENTE" ? "Facture" : "Avoir") : "Facture"}
                </button>
              )}
              {choisi.type === "ANNULATION" &&
                choisi.ticketOrigine &&
                ventesFacturees.has(choisi.ticketOrigine.numero) &&
                !factures.has(choisi.numero) && (
                  <button className="bouton principal" onClick={() => void rattraperAvoir(choisi)}>
                    Émettre l'avoir
                  </button>
                )}
              <button className="bouton" onClick={() => void duplicataQr(choisi)}>
                QR code
              </button>
              <button className="bouton" onClick={() => void duplicata(choisi)}>
                {imprimanteConfiguree ? "Imprimer un duplicata" : "Voir un duplicata"}
              </button>
            </>
          }
        >
          {annules.has(choisi.numero) && <p className="erreur">Ce ticket a été annulé.</p>}
          {choisi.motif && <p className="explication">Motif : {choisi.motif}</p>}
          {factures.has(choisi.numero) && <p className="explication">Facturé : n° {factures.get(choisi.numero)}</p>}
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

      {factureDe && (
        <ModaleFacture
          ticket={factureDe}
          onFermer={() => {
            setFactureDe(null);
            void charger();
          }}
        />
      )}

      {qr && (
        <Modale titre={`Note n° ${qr.ticket.numero} · duplicata`} onFermer={() => setQr(null)}>
          <QrNote url={qr.url} legende="Le client scanne pour récupérer un duplicata de sa note" />
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
