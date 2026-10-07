import { Eye, FileText, Printer, QrCode, RefreshCw, Undo2, Wallet } from "lucide-react";
import { AvecIcone, BoutonIcone } from "./icones";
import { ErreurFiscale, paiementsEffectifs, ticketCouvertPar, type Ticket } from "@matalon/noyau-fiscal";
import { useCallback, useEffect, useState } from "react";
import { gabaritNote, LIBELLES_PAIEMENT, nomTable, nomUtilisateur } from "../impression/gabarits";
import { Modale, Vide } from "./communs";
import { euros, useCaisse } from "./contexte";
import { QrNote, urlNoteTicket } from "./QrNote";
import { ModaleFacture } from "./modales/ModaleFacture";
import { ModaleCorrection } from "./modales/ModaleCorrection";
import { DetailTicket } from "./DetailTicket";
import { emettreAvoir, listerFactures } from "../metier/facture";

const MOTIFS_ANNULATION = ["Erreur de saisie", "Erreur de table", "Client parti sans consommer", "Réclamation client"];
const MOTIFS_ANNULATION_REGLEMENT = ["Erreur de client", "Erreur de montant", "Paiement refusé"];

const cle = (t: Pick<Ticket, "caisseId" | "numero">) => `${t.caisseId}#${t.numero}`;

/**
 * Derniers tickets de l'établissement : ceux de cet appareil (même hors ligne)
 * et ceux des autres caisses, depuis la copie du serveur. Détail pour tous ;
 * annulation, correction, facture et duplicata sur l'appareil qui a encaissé.
 */
export function Tickets() {
  const { caisse, config, utilisateur, notifier, imprimer, demanderResponsable, imprimanteConfiguree } = useCaisse();
  const [qr, setQr] = useState<{ ticket: Ticket; url: string } | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [annules, setAnnules] = useState<Set<string>>(new Set());
  /** Noms des appareils de l'établissement ; null : tickets des autres caisses indisponibles (hors ligne). */
  const [appareils, setAppareils] = useState<Record<string, string> | null>(null);
  const [choisi, setChoisi] = useState<Ticket | null>(null);
  const [annulation, setAnnulation] = useState<Ticket | null>(null);
  const [correction, setCorrection] = useState<Ticket | null>(null);
  /** Dernier ticket couvert par une Z : au-delà, les paiements se corrigent encore. */
  const [couvertParZ, setCouvertParZ] = useState(0);
  const [motif, setMotif] = useState("");
  const [factureDe, setFactureDe] = useState<Ticket | null>(null);
  const [factures, setFactures] = useState<Map<number, string>>(new Map());
  /** Ventes facturées (numéro de ticket → numéro de facture), pour proposer l'avoir manquant. */
  const [ventesFacturees, setVentesFacturees] = useState<Set<number>>(new Set());

  const charger = useCallback(async () => {
    const locaux = await caisse.stockage.derniers("tickets", 150);
    // Ceux des autres caisses viennent du serveur ; ceux de cet appareil font foi (même pas encore synchronisés).
    let distants: Ticket[] = [];
    try {
      const r = await caisse.client.ticketsEtablissement(150);
      distants = r.tickets.filter((t) => t.caisseId !== config.caisseId);
      setAppareils(r.appareils);
    } catch {
      setAppareils(null);
    }
    const liste = [...locaux, ...distants].sort((a, b) => b.horodatage.localeCompare(a.horodatage) || b.numero - a.numero).slice(0, 150);
    setTickets(liste);
    setAnnules(
      new Set(liste.filter((t) => t.type === "ANNULATION" && t.ticketOrigine).map((t) => cle({ caisseId: t.caisseId, numero: t.ticketOrigine!.numero }))),
    );
    // Couverture par les Z de l'établissement, faites sur cet appareil ou sur un autre.
    let clotures = await caisse.stockage.derniers("clotures", 30);
    try {
      clotures = [...clotures, ...(await caisse.client.cloturesEtablissement(30)).clotures];
    } catch {
      /* hors ligne : les Z de cet appareil ; la correction le revérifie en ligne */
    }
    setCouvertParZ(Math.max(0, ...clotures.map((c) => ticketCouvertPar(c, config.caisseId) ?? 0)));
    const emises = await listerFactures(caisse.stockage);
    setFactures(new Map(emises.map((f) => [f.ticket, f.numero])));
    setVentesFacturees(new Set(emises.filter((f) => f.nature === "FACTURE").map((f) => f.ticket)));
  }, [caisse.stockage, caisse.client, config.caisseId]);

  useEffect(() => void charger(), [charger]);

  const locale = (t: Ticket) => t.caisseId === config.caisseId;
  const appareil = (t: Ticket) => (locale(t) ? config.caisseNom : (appareils?.[t.caisseId] ?? t.caisseId));
  const plusieursAppareils = new Set(tickets.map((t) => t.caisseId)).size > 1;

  /** Numéro du prochain duplicata d'un ticket, papier ou QR code confondus. */
  const prochainDuplicata = async (t: Ticket) => {
    const evts = await caisse.stockage.lister("evenements");
    return evts.filter((e) => e.code === "REIMPRESSION_TICKET" && e.details.ticket === t.numero).length + 1;
  };

  /** Vente du jour (pas encore couverte par une Z), non annulée, sans part en compte. */
  const corrigeable = (t: Ticket) =>
    t.type === "VENTE" &&
    t.totalTTC > 0 &&
    t.numero > couvertParZ &&
    !annules.has(cle(t)) &&
    !paiementsEffectifs(t, tickets).some((p) => p.mode === "EN_COMPTE");

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

  /**
   * Une vente en compte réglée sur un autre appareil ne doit pas être annulée :
   * on interroge le serveur, qui voit les règlements de toutes les caisses.
   */
  const venteEnCompteReglee = async (t: Ticket): Promise<string | null> => {
    if (t.type !== "VENTE" || !t.client) return null;
    try {
      const r = await caisse.client.comptes();
      if ((r.dernierTicketCaisse ?? 0) < t.numero) return null; // inconnue du serveur : personne n'a pu la régler ailleurs
      const ouverte = r.comptes.flatMap((c) => c.ventes).find((v) => v.caisseId === config.caisseId && v.numero === t.numero);
      if (!ouverte || ouverte.regleTTC > 0) return "Cette vente a déjà reçu un règlement : annulez d'abord le règlement (onglet Tickets).";
      return null;
    } catch {
      return "Connexion nécessaire pour annuler une vente en compte : il faut vérifier qu'aucun règlement n'a été reçu sur un autre appareil.";
    }
  };

  const annuler = async () => {
    if (!annulation || !motif) return;
    const montant = annulation.reglement ? annulation.reglement.montantTTC : annulation.totalTTC;
    const responsable = await demanderResponsable(`Annulation du ${annulation.reglement ? "règlement" : "ticket"} n° ${annulation.numero} (${euros(montant)}).`);
    if (!responsable) return;
    const blocageCompte = await venteEnCompteReglee(annulation);
    if (blocageCompte) return notifier(blocageCompte, "erreur");
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
        <BoutonIcone icone={RefreshCw} variante="discret" libelle="Actualiser les tickets" onClick={() => void charger()} />
        <p>
          Les 150 derniers tickets de l'établissement
          {appareils === null ? " (hors ligne : seulement ceux de cet appareil)" : ""}. Un ticket ne se modifie pas : une erreur se corrige par
          une annulation, ou par une correction du paiement avant la Z.
        </p>
      </header>
      {tickets.length === 0 ? (
        <Vide>Aucun ticket pour l'instant. Ils apparaîtront ici après le premier encaissement.</Vide>
      ) : (
        <table className="tableau tableau-tickets">
          <thead>
            <tr>
              <th>N°</th>
              {plusieursAppareils && <th>Appareil</th>}
              <th>Heure</th>
              <th>Table</th>
              <th>Par</th>
              <th>Paiement</th>
              <th className="nombre">Montant</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr
                key={cle(t)}
                onClick={() => setChoisi(t)}
                className={t.type === "ANNULATION" ? "annulation" : t.type === "CORRECTION" ? "correction" : annules.has(cle(t)) ? "annule" : ""}
              >
                <td>{t.numero}</td>
                {plusieursAppareils && <td>{appareil(t)}</td>}
                <td>
                  {new Date(t.horodatage).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td>
                  {t.reglement
                    ? `${t.type === "REGLEMENT" ? "Règlement" : "Annulation de règlement"} · ${t.client?.nom ?? ""}`
                    : t.type === "CORRECTION"
                      ? `Correction du n° ${t.ticketOrigine?.numero}`
                      : nomTable(config, t.tableId)}
                </td>
                <td>{nomUtilisateur(config, t.operateurId)}</td>
                <td>
                  {t.type === "CORRECTION"
                    ? `${t.paiements.filter((p) => p.montant < 0).map((p) => LIBELLES_PAIEMENT[p.mode]).join(", ")} → ${t.paiements.filter((p) => p.montant > 0).map((p) => LIBELLES_PAIEMENT[p.mode]).join(", ")}`
                    : (t.type === "VENTE" ? paiementsEffectifs(t, tickets) : t.paiements).map((p) => LIBELLES_PAIEMENT[p.mode]).join(", ") || "—"}
                </td>
                <td className="nombre">{t.reglement ? <small>reçu {euros(t.reglement.montantTTC)}</small> : t.type === "CORRECTION" ? "—" : euros(t.totalTTC)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {choisi && !annulation && (
        <Modale
          titre={`${{ ANNULATION: "Annulation", REGLEMENT: "Règlement de compte", CORRECTION: "Correction de paiement", VENTE: "Ticket" }[choisi.type]} n° ${choisi.numero}`}
          onFermer={() => setChoisi(null)}
          pied={
            locale(choisi) ? (
            <>
              {(choisi.type === "VENTE" || choisi.type === "REGLEMENT") && !annules.has(cle(choisi)) && (
                <button className="bouton danger" onClick={() => setAnnulation(choisi)}>
                  <AvecIcone icone={Undo2}>{choisi.type === "REGLEMENT" ? "Annuler ce règlement" : "Annuler ce ticket"}</AvecIcone>
                </button>
              )}
              {corrigeable(choisi) && (
                <button className="bouton" onClick={() => setCorrection(choisi)}>
                  <AvecIcone icone={Wallet}>Corriger le paiement</AvecIcone>
                </button>
              )}
              {(choisi.type === "VENTE" ? !annules.has(cle(choisi)) || factures.has(choisi.numero) : factures.has(choisi.numero)) && (
                <button className="bouton" onClick={() => setFactureDe(choisi)}>
                  <AvecIcone icone={FileText}>{factures.has(choisi.numero) ? (choisi.type === "VENTE" ? "Facture" : "Avoir") : "Facture"}</AvecIcone>
                </button>
              )}
              {choisi.type === "ANNULATION" &&
                choisi.ticketOrigine &&
                ventesFacturees.has(choisi.ticketOrigine.numero) &&
                !factures.has(choisi.numero) && (
                  <button className="bouton principal" onClick={() => void rattraperAvoir(choisi)}>
                    <AvecIcone icone={FileText}>Émettre l'avoir</AvecIcone>
                  </button>
                )}
              {!choisi.reglement && choisi.type !== "CORRECTION" && (
                <button className="bouton" onClick={() => void duplicataQr(choisi)}>
                  <AvecIcone icone={QrCode}>QR code</AvecIcone>
                </button>
              )}
              <button className="bouton" onClick={() => void duplicata(choisi)}>
                <AvecIcone icone={imprimanteConfiguree ? Printer : Eye}>{imprimanteConfiguree ? "Imprimer un duplicata" : "Voir un duplicata"}</AvecIcone>
              </button>
            </>
            ) : undefined
          }
        >
          {!locale(choisi) && (
            <p className="explication">
              Encaissé sur l'appareil « {appareil(choisi)} » : l'annulation, la correction du paiement, la facture et le duplicata se font
              depuis cet appareil.
            </p>
          )}
          {annules.has(cle(choisi)) && <p className="erreur">Ce ticket a été annulé.</p>}
          {choisi.motif && <p className="explication">Motif : {choisi.motif}</p>}
          {locale(choisi) && factures.has(choisi.numero) && <p className="explication">Facturé : n° {factures.get(choisi.numero)}</p>}
          <DetailTicket ticket={choisi} tickets={tickets} />
        </Modale>
      )}

      {correction && (
        <ModaleCorrection
          ticket={correction}
          avant={paiementsEffectifs(correction, tickets)}
          onCorrige={() => {
            setCorrection(null);
            setChoisi(null);
            void charger();
          }}
          onFermer={() => setCorrection(null)}
        />
      )}

      {factureDe && (
        <ModaleFacture
          // Les mentions de paiement de la facture reprennent les moyens corrigés, s'il y a eu correction.
          ticket={factureDe.type === "VENTE" ? { ...factureDe, paiements: paiementsEffectifs(factureDe, tickets), renduMonnaie: 0 } : factureDe}
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
          titre={`Annuler le ${annulation.reglement ? "règlement" : "ticket"} n° ${annulation.numero}`}
          onFermer={() => setAnnulation(null)}
          pied={
            <button className="bouton danger" disabled={!motif} onClick={() => void annuler()}>
              <AvecIcone icone={Undo2}>Annuler {euros(annulation.reglement ? annulation.reglement.montantTTC : annulation.totalTTC)}</AvecIcone>
            </button>
          }
        >
          {annulation.reglement ? (
            <p className="explication">
              Le règlement de {annulation.client?.nom} est annulé : {euros(annulation.reglement.montantTTC)} sont rendus au client (
              {annulation.paiements.map((p) => LIBELLES_PAIEMENT[p.mode]).join(", ")}) et la dette renaît sur son compte.
            </p>
          ) : (
            <p className="explication">
              Un ticket négatif de {euros(-annulation.totalTTC)} sera émis. Les paiements sont remboursés sur les mêmes moyens :{" "}
              {paiementsEffectifs(annulation, tickets).map((p) => `${LIBELLES_PAIEMENT[p.mode]} ${euros(p.montant)}`).join(", ") || "aucun"}
              {annulation.client ? ` ; la part en compte est retirée du compte de ${annulation.client.nom}` : ""}.
            </p>
          )}
          <h3>Motif</h3>
          <div className="options">
            {(annulation.reglement ? MOTIFS_ANNULATION_REGLEMENT : MOTIFS_ANNULATION).map((m) => (
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
