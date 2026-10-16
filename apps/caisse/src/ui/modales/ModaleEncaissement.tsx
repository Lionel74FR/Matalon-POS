import { Banknote, Check, CreditCard, Hourglass, NotebookPen, Printer, Ticket as TicketPapier, Trash2, Undo2, X, type LucideIcon } from "lucide-react";
import type { Reservation } from "../../donnees/partage";
import { AvecIcone } from "../icones";
import { ErreurFiscale, type ClientCompte, type ModePaiement, type Paiement, type Ticket } from "@matalon/noyau-fiscal";
import { useState } from "react";
import { carteDe, ID_COMPTOIR } from "../../donnees/configuration";
import { MODE_TEST } from "../../fiscal/caisse";
import { gabaritNote, LIBELLES_PAIEMENT } from "../../impression/gabarits";
import { Recu } from "../../impression/recu";
import {
  acomptesActifs,
  ajouterAcompte,
  annulerAcompte,
  lignesDues,
  montantLigne,
  montantPart,
  paiementsAcomptes,
  versSaisie,
  type Acompte,
  type Commande,
  type LigneCommande,
  type ModeAcompte,
} from "../../metier/commande";
import { appliquerToucheMontant, Modale, Pave } from "../communs";
import { euros, useCaisse } from "../contexte";
import { QrNote, urlNoteTicket } from "../QrNote";
import { productionActive, useEnvoiProduction } from "../production";
import { ModaleClient } from "./ModaleClient";
import type { ClientApi } from "@matalon/serveur/partage";

const MODES: ModePaiement[] = ["CB", "ESPECES", "TITRE_RESTAURANT_CARTE", "TITRE_RESTAURANT_PAPIER", "EN_COMPTE"];
const ICONES_PAIEMENT: Record<ModePaiement, LucideIcon> = {
  CB: CreditCard,
  ESPECES: Banknote,
  TITRE_RESTAURANT_CARTE: CreditCard,
  TITRE_RESTAURANT_PAPIER: TicketPapier,
  EN_COMPTE: NotebookPen,
  AUTRE: Banknote,
};
const BILLETS = [500, 1000, 2000, 5000];
/** Parts égales proposées d'un geste ; au-delà, le bouton « + » ajoute une part. */
const PARTS = [2, 3, 4, 5, 6];
/** Somme réellement encaissée sur une vente (hors part portée en compte). */
const encaisseVente = (t: Ticket) => t.totalTTC - t.paiements.filter((p) => p.mode === "EN_COMPTE").reduce((s, p) => s + p.montant, 0);
/** Au-delà de ce rendu (centimes), la caisse demande confirmation : faute de frappe probable. */
const RENDU_A_CONFIRMER = 2000;
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", timeStyle: "short" });

/**
 * Encaissement d'une commande : un ou plusieurs moyens de paiement, puis note et tiroir.
 *
 * La note se divise de trois façons. Par articles (`partie`) : les lignes choisies font un
 * ticket à elles seules, le reste demeure sur la table. En parts égales ou d'un montant libre :
 * ce qui est payé devient un acompte sur la table, qui reste ouverte ; le ticket, unique, est
 * scellé au dernier paiement et reprend chaque acompte comme paiement.
 */
export function ModaleEncaissement(props: {
  /** Commande de la table, telle qu'affichée. */
  commande: Commande;
  /** Division par articles : lignes payées maintenant et commande qui restera sur la table. */
  partie?: { lignes: LigneCommande[]; restante: Commande };
  /** Ouvre la répartition en parts égales. */
  parts?: boolean;
  /** Table soldée : la commande se ferme. */
  onTermine: () => void;
  /** Une partie réglée (articles, acompte, acompte rendu) : la table reste ouverte avec cette commande. */
  onPartie?: (restante: Commande) => void;
  onFermer: () => void;
  /** Ferme la table sur le serveur avant d'encaisser (deux appareils n'encaissent pas la même table). */
  reserver?: (c: Commande) => Promise<Reservation>;
  /** Encaissement impossible après la réservation : la table se rouvre. */
  liberer?: (tableId: string) => void;
  /** Écrit sur le serveur la commande qui restera, sans fusion (partie payée, acompte). */
  engager?: (affichee: Commande, restante: Commande) => Promise<Reservation>;
}) {
  const { caisse, config, majConfig, utilisateur, notifier, imprimer, imprimanteConfiguree, blocage, demanderResponsable } = useCaisse();
  const c = props.commande;
  const partie = props.partie ?? null;
  /** Acomptes et parts : sur une table seulement (le comptoir reste propre à l'appareil, la Z ne le verrait pas d'ailleurs). */
  const surTable = c.tableId !== ID_COMPTOIR && !!props.engager && !!props.onPartie;
  /** Client au compte duquel une partie est portée (une vente, un seul client). */
  const [client, setClient] = useState<ClientCompte | null>(null);
  const [choixClient, setChoixClient] = useState<number | null>(null);
  const [noteImprimee, setNoteImprimee] = useState(false);
  const envoyerProduction = useEnvoiProduction();

  const lignesTicket = partie ? partie.lignes : lignesDues(c);
  const total = lignesTicket.reduce((s, l) => s + montantLigne(l), 0);
  const acomptes = partie ? [] : acomptesActifs(c);
  const dejaRegle = acomptes.reduce((s, a) => s + a.montant, 0);
  /** Ce qui reste dû sur la table ; négatif : les acomptes dépassent la note (trop-perçu). */
  const resteTable = total - dejaRegle;
  const [parts, setParts] = useState<number | null>(surTable && !partie ? (c.parts ?? (props.parts ? 2 : null)) : null);
  /** Montant à encaisser maintenant : une part, ou tout le reste de la table. */
  const aPayer = parts ? montantPart(total, parts, resteTable) : resteTable;
  /** Ce paiement solde la table : ticket. Sinon : acompte. */
  const solde = aPayer >= resteTable;

  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const paye = paiements.reduce((s, p) => s + p.montant, 0);
  const reste = Math.max(0, aPayer - paye);
  const [saisie, setSaisie] = useState<number | null>(null);
  const montant = saisie ?? reste;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [acompteFait, setAcompteFait] = useState<{ montant: number; rendu: number; reste: number } | null>(null);
  const [enCours, setEnCours] = useState(false);
  /** Paiement en espèces qui laisserait un gros rendu, en attente de confirmation. */
  const [renduAConfirmer, setRenduAConfirmer] = useState<{ montant: number; rendu: number } | null>(null);

  const especes = paiements.filter((p) => p.mode === "ESPECES").reduce((s, p) => s + p.montant, 0);
  const excedent = paye - aPayer;
  const tropPercu = resteTable < 0 || (total === 0 && dejaRegle > 0);
  const valide = !tropPercu && paye >= aPayer && excedent <= especes && (aPayer > 0 || (solde && total > 0));
  /** Montant libre : une partie payée, le reste demeure sur la table. */
  const acompteLibre = surTable && solde && paye > 0 && paye < resteTable && !paiements.some((p) => p.mode === "EN_COMPTE");

  const ajouter = (mode: ModePaiement, m = montant) => {
    if (m <= 0) return;
    if (reste === 0) return notifier("Le montant est déjà réglé : retirez un paiement pour en changer.", "erreur");
    if (mode !== "ESPECES" && paye + m > aPayer) {
      return notifier(`${LIBELLES_PAIEMENT[mode]} : le montant dépasse le reste à payer. Seules les espèces donnent lieu à un rendu.`, "erreur");
    }
    if (mode === "ESPECES" && m - reste > RENDU_A_CONFIRMER && !renduAConfirmer) {
      return setRenduAConfirmer({ montant: m, rendu: m - reste });
    }
    if (mode === "EN_COMPTE" && !solde) return notifier("Une part ne se porte pas en compte : touchez « Tout » pour mettre le reste au compte d'un client.", "erreur");
    // Chaque somme portée en compte est un crédit accordé : toujours l'accord d'un responsable.
    if (mode === "EN_COMPTE") return client ? void mettreEnCompte(client, m) : setChoixClient(m);
    setRenduAConfirmer(null);
    setPaiements((l) => [...l, { mode, montant: m }]);
    setSaisie(null);
  };

  /** Mise en compte : le client choisi, puis l'accord d'un responsable (c'est un crédit accordé). */
  const mettreEnCompte = async (cl: ClientCompte | ClientApi, m: number, nouveau = false) => {
    setChoixClient(null);
    const responsable = await demanderResponsable(`${euros(m)} au compte de ${cl.nom}.`);
    if (!responsable) return;
    if (nouveau && "telephone" in cl) {
      // Fiche enregistrée seulement une fois la mise en compte accordée ; le serveur la reçoit en ligne, ou par le ticket.
      await majConfig({ ...config, clients: [...(config.clients ?? []), cl] });
      void caisse.client.enregistrerClient(cl).catch(() => undefined);
    }
    setClient({ id: cl.id, nom: cl.nom });
    setPaiements((l) => [...l, { mode: "EN_COMPTE", montant: m }]);
    setSaisie(null);
  };

  const retirerPaiement = (i: number) =>
    setPaiements((l) => {
      const suite = l.filter((_, j) => j !== i);
      if (!suite.some((p) => p.mode === "EN_COMPTE")) setClient(null);
      return suite;
    });

  const choisirParts = (n: number | null) => {
    setParts(n);
    setSaisie(null);
    setRenduAConfirmer(null);
  };

  const encaisser = async () => {
    if (blocage) return notifier(blocage, "erreur");
    setEnCours(true);
    try {
      const reservation = partie
        ? await props.engager!(c, partie.restante)
        : props.reserver
          ? await props.reserver(c)
          : ({ ok: true } as const);
      if (!reservation.ok) {
        notifier(reservation.raison, "erreur");
        return props.onFermer();
      }
      let t: Ticket;
      try {
        t = await caisse.registre.enregistrerVente({
          lignes: lignesTicket.map(versSaisie),
          paiements: [...(partie ? [] : paiementsAcomptes(c)), ...paiements],
          operateurId: utilisateur.id,
          tableId: c.tableId === ID_COMPTOIR ? null : c.tableId,
          // Les couverts vont au ticket qui ferme la table : comptés une fois dans les statistiques.
          couverts: partie ? null : c.couverts,
          ...(client && paiements.some((p) => p.mode === "EN_COMPTE") ? { client } : {}),
        });
      } catch (e) {
        props.liberer?.(c.tableId);
        throw e;
      }
      setTicket(t);
      // Ce qui n'a pas été envoyé en production part maintenant.
      const carte = carteDe(config);
      if (partie) {
        // Les lignes payées restent sur la table : elles gardent la trace de leur envoi.
        const marquer = carte && productionActive(config) ? await envoyerProduction({ ...c, lignes: partie.lignes }, carte) : null;
        props.onPartie!(marquer ? marquer(partie.restante) : partie.restante);
      } else if (carte && productionActive(config)) {
        void envoyerProduction(c, carte);
      }
      // Sans imprimante, rien ne sort : la note passe par le QR code.
      if (imprimanteConfiguree) {
        const avecEspeces = paiements.some((p) => p.mode === "ESPECES");
        if (t.totalTTC >= config.seuilNoteAutomatique && config.noteAutomatique !== false) {
          await imprimerNote(t, avecEspeces);
          setNoteImprimee(true);
        } else if (avecEspeces) {
          await ouvrirTiroir({ ticket: t.numero });
        }
      }
    } catch (e) {
      notifier(e instanceof ErreurFiscale ? e.message : `Encaissement impossible : ${String(e)}`, "erreur");
    } finally {
      setEnCours(false);
    }
  };

  /**
   * Part ou montant libre : ce qui est payé devient un acompte sur la table, écrit sur le
   * serveur avant de rendre la monnaie (deux appareils voient le même reste). En ligne seulement.
   */
  const prendreAcompte = async () => {
    if (blocage) return notifier(blocage, "erreur");
    setEnCours(true);
    try {
      const rendu = Math.max(0, paye - aPayer);
      const le = new Date().toISOString();
      const parMode = new Map<ModeAcompte, number>();
      for (const p of paiements) if (p.mode !== "EN_COMPTE") parMode.set(p.mode, (parMode.get(p.mode) ?? 0) + p.montant);
      if (rendu) parMode.set("ESPECES", (parMode.get("ESPECES") ?? 0) - rendu);
      let restante: Commande = c;
      for (const [mode, m] of parMode) if (m > 0) restante = ajouterAcompte(restante, { mode, montant: m, le, par: utilisateur.id, caisseId: config.caisseId });
      const { parts: _, ...sansParts } = restante;
      restante = parts ? { ...sansParts, parts } : sansParts;
      const r = await props.engager!(c, restante);
      if (!r.ok) {
        notifier(r.raison, "erreur");
        return props.onFermer();
      }
      if (r.horsLigne) {
        return notifier("Acompte impossible hors ligne : les autres appareils doivent voir ce qui a été payé. Encaissez la note entière, ou par articles.", "erreur");
      }
      const verse = paye - rendu;
      props.onPartie!(restante);
      if (imprimanteConfiguree && especes > 0) await ouvrirTiroir({ table: c.tableId, acompte: verse });
      setAcompteFait({ montant: verse, rendu, reste: resteTable - verse });
    } catch (e) {
      notifier(`Acompte impossible : ${String(e)}`, "erreur");
    } finally {
      setEnCours(false);
    }
  };

  /** Acompte saisi par erreur : rendu au client, avec l'accord d'un responsable. Il reste affiché, barré. */
  const rendreAcompte = async (a: Acompte) => {
    const responsable = await demanderResponsable(`Rendre l'acompte de ${euros(a.montant)} (${LIBELLES_PAIEMENT[a.mode]}) au client.`);
    if (!responsable) return;
    const restante = annulerAcompte(c, a.id, { le: new Date().toISOString(), par: responsable, motif: "Rendu au client" });
    const r = await props.engager!(c, restante);
    if (!r.ok) return notifier(r.raison, "erreur");
    if (r.horsLigne) return notifier("Annulation impossible hors ligne : réessayez une fois l'appareil connecté.", "erreur");
    props.onPartie!(restante);
    notifier(`Acompte annulé : rendez ${euros(a.montant)} au client (${LIBELLES_PAIEMENT[a.mode]}).`);
  };

  const ouvrirTiroir = async (details: Record<string, string | number>) => {
    await imprimer(new Recu().ouvrirTiroir(), "Tiroir-caisse");
    await caisse.registre.journaliser("OUVERTURE_TIROIR", details, utilisateur.id);
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

  if (acompteFait) {
    return (
      <Modale
        titre="Acompte enregistré"
        onFermer={props.onFermer}
        pied={
          <button className="bouton principal" onClick={props.onFermer}>
            <AvecIcone icone={Check}>Terminé</AvecIcone>
          </button>
        }
      >
        <div className="fin-encaissement">
          {acompteFait.rendu > 0 && (
            <div className="rendu">
              <span>Rendu monnaie</span>
              <strong>{euros(acompteFait.rendu)}</strong>
            </div>
          )}
          <div className="rendu calme">
            <span>Acompte</span>
            <strong>{euros(acompteFait.montant)}</strong>
          </div>
          <div className="rendu calme">
            <span>Reste sur la table</span>
            <strong>{euros(acompteFait.reste)}</strong>
          </div>
        </div>
        <p className="explication">
          La table reste ouverte. Le ticket sera édité au dernier paiement, avec tous les acomptes ; la Z attend qu'elle soit soldée.
        </p>
      </Modale>
    );
  }

  if (ticket) {
    const auDelaSeuil = ticket.totalTTC >= config.seuilNoteAutomatique;
    /** Note due mais pas imprimée d'office (réglage) : la remettre, sur papier ou par le QR code. */
    const noteARemettre = auDelaSeuil && config.noteAutomatique === false && !noteImprimee;
    const fin = partie ? props.onFermer : props.onTermine;
    return (
      <Modale
        titre={`Ticket n° ${ticket.numero} encaissé`}
        large
        onFermer={fin}
        pied={
          <>
            {!noteImprimee && (
              <button
                className={`bouton${noteARemettre && imprimanteConfiguree ? " principal" : ""}`}
                onClick={() => void imprimerNote(ticket, false).then(() => imprimanteConfiguree && setNoteImprimee(true))}
              >
                <AvecIcone icone={Printer}>{imprimanteConfiguree ? "Imprimer la note" : "Voir la note"}</AvecIcone>
              </button>
            )}
            <button className="bouton principal" onClick={fin}>
              <AvecIcone icone={Check}>{partie ? "Retour à la table" : "Terminé"}</AvecIcone>
            </button>
          </>
        }
      >
        <div className="fin-encaissement">
          {ticket.client && (
            <div className="rendu calme">
              <span>Au compte de {ticket.client.nom}</span>
              <strong>{euros(ticket.paiements.filter((p) => p.mode === "EN_COMPTE").reduce((s, p) => s + p.montant, 0))}</strong>
            </div>
          )}
          {ticket.renduMonnaie > 0 ? (
            <div className="rendu">
              <span>Rendu monnaie</span>
              <strong>{euros(ticket.renduMonnaie)}</strong>
            </div>
          ) : (
            encaisseVente(ticket) > 0 && (
              <div className="rendu calme">
                <span>Encaissé</span>
                <strong>{euros(encaisseVente(ticket))}</strong>
              </div>
            )
          )}
          <QrNote url={urlNoteTicket(ticket, config)} />
        </div>
        {partie && <p className="explication">Le reste de la commande demeure sur la table.</p>}
        {noteImprimee && <p className="explication">La note a été imprimée (montant de {euros(config.seuilNoteAutomatique)} ou plus).</p>}
        {noteARemettre && (
          <p className="note-a-remettre" role="alert">
            Note à remettre au client ({euros(config.seuilNoteAutomatique)} ou plus) : imprimez-la, ou montrez-lui le QR code s'il préfère la
            version dématérialisée.
          </p>
        )}
        {!imprimanteConfiguree && auDelaSeuil && !MODE_TEST && (
          <p className="erreur">
            Au-delà de {euros(config.seuilNoteAutomatique)}, la note doit être remise imprimée : connectez l'imprimante dans les
            réglages.
          </p>
        )}
      </Modale>
    );
  }

  const libelleValider = blocage
    ? "Encaissement bloqué"
    : enCours
      ? "Enregistrement…"
      : !valide
        ? `Reste ${euros(reste)}`
        : solde
          ? `Valider l'encaissement de ${euros(resteTable)}`
          : `Valider la part de ${euros(aPayer)}`;

  return (
    <Modale
      titre={partie ? "Encaissement de la sélection" : "Encaissement"}
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
            <button
              className="bouton"
              disabled={paiements.length === 0}
              onClick={() => {
                setPaiements([]);
                setClient(null);
              }}
            >
              <AvecIcone icone={Trash2}>Effacer les paiements</AvecIcone>
            </button>
            {acompteLibre && (
              <button className="bouton" disabled={enCours || !!blocage} onClick={() => void prendreAcompte()}>
                <AvecIcone icone={Hourglass}>Acompte de {euros(paye)}, le reste sur la table</AvecIcone>
              </button>
            )}
            <button
              className="bouton principal grand"
              disabled={!valide || enCours || !!blocage}
              onClick={() => void (solde ? encaisser() : prendreAcompte())}
            >
              <AvecIcone icone={Check}>{libelleValider}</AvecIcone>
            </button>
          </>
        )
      }
    >
      {blocage && <p className="erreur">{blocage}</p>}
      {tropPercu && (
        <p className="erreur" role="alert">
          Les acomptes dépassent la note de {euros(dejaRegle - total)} : un responsable annule l'acompte saisi par erreur (croix à côté), puis
          encaissez.
        </p>
      )}
      {surTable && resteTable > 0 && (
        <div className="parts" role="radiogroup" aria-label="Parts égales">
          <span className="parts-titre">Parts égales</span>
          <button role="radio" aria-checked={parts == null} className={`option${parts == null ? " active" : ""}`} onClick={() => choisirParts(null)}>
            Tout
          </button>
          {PARTS.map((n) => (
            <button key={n} role="radio" aria-checked={parts === n} className={`option${parts === n ? " active" : ""}`} onClick={() => choisirParts(n)}>
              {n}
            </button>
          ))}
          <button
            role="radio"
            aria-checked={parts != null && parts > PARTS.at(-1)!}
            aria-label="Une part de plus"
            className={`option${parts != null && parts > PARTS.at(-1)! ? " active" : ""}`}
            onClick={() => choisirParts(Math.max(parts ?? 0, PARTS.at(-1)!) + 1)}
          >
            {parts != null && parts > PARTS.at(-1)! ? parts : `${PARTS.at(-1)! + 1}+`}
          </button>
        </div>
      )}
      <div className="encaissement">
        <div className="encaissement-etat">
          <div className="ligne-montant">
            <span>{partie ? "Sélection" : "Total"}</span>
            <strong>{euros(total)}</strong>
          </div>
          {(c.acomptes ?? []).length > 0 && !partie &&
            (c.acomptes ?? []).map((a) => (
              <div key={a.id} className={`ligne-montant paiement acompte${a.annule ? " annule" : ""}`}>
                <span className="acompte-libelle">
                  Acompte {LIBELLES_PAIEMENT[a.mode].toLowerCase()}
                  <small>{a.annule ? `rendu à ${heure(a.annule.le)}` : `à ${heure(a.le)}`}</small>
                </span>
                <span className="acompte-montant">
                  {euros(-a.montant)}
                  {!a.annule && surTable && (
                    <button
                      className="bouton discret"
                      aria-label={`Rendre l'acompte ${LIBELLES_PAIEMENT[a.mode]} de ${euros(a.montant)}`}
                      title="Rendre l'acompte (responsable)"
                      onClick={() => void rendreAcompte(a)}
                    >
                      <X className="icone" size={20} aria-hidden="true" />
                    </button>
                  )}
                </span>
              </div>
            ))}
          {!solde && (
            <div className="ligne-montant part">
              <span>
                Part ({parts} parts) · reste ensuite {euros(resteTable - aPayer)}
              </span>
              <strong>{euros(aPayer)}</strong>
            </div>
          )}
          {paiements.map((p, i) => (
            <div key={i} className="ligne-montant paiement">
              <span>
                {LIBELLES_PAIEMENT[p.mode]}
                {p.mode === "EN_COMPTE" && client ? ` · ${client.nom}` : ""}
              </span>
              <span>
                {euros(p.montant)}
                <button
                  className="bouton discret"
                  aria-label={`Retirer le paiement ${LIBELLES_PAIEMENT[p.mode]}`}
                  title={`Retirer le paiement ${LIBELLES_PAIEMENT[p.mode]}`}
                  onClick={() => retirerPaiement(i)}
                >
                  <X className="icone" size={20} aria-hidden="true" />
                </button>
              </span>
            </div>
          ))}
          <div className={`ligne-montant reste${reste === 0 ? " solde" : ""}`}>
            <span>{excedent > 0 ? "À rendre" : solde ? "Reste à payer" : "Reste de la part"}</span>
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
            <button key={m} className={`mode mode-${m.toLowerCase()}`} disabled={montant <= 0 || (m === "EN_COMPTE" && !solde)} onClick={() => ajouter(m)}>
              <AvecIcone icone={ICONES_PAIEMENT[m]} taille={26}>
                {m === "EN_COMPTE" && client ? `Compte ${client.nom}` : LIBELLES_PAIEMENT[m]}
              </AvecIcone>
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
      {choixClient != null && (
        <ModaleClient
          titre={`${euros(choixClient)} en compte : quel client ?`}
          onChoisir={(cl, nouveau) => void mettreEnCompte(cl, choixClient, nouveau)}
          onFermer={() => setChoixClient(null)}
        />
      )}
    </Modale>
  );
}
