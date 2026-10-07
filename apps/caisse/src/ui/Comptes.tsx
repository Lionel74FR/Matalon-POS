import { ErreurFiscale, type ModePaiement, type Paiement, type Ticket } from "@matalon/noyau-fiscal";
import type { CompteClient, ReponseComptes, VenteOuverte } from "@matalon/serveur/partage";
import { Banknote, Check, ChevronRight, CreditCard, Eye, NotebookPen, Printer, RefreshCw, TriangleAlert, Trash2, Undo2, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { gabaritNote, gabaritReglement, LIBELLES_PAIEMENT } from "../impression/gabarits";
import { DetailTicket } from "./DetailTicket";
import { ErreurApi } from "../serveur/client";
import { appliquerToucheMontant, Modale, Pave, Vide } from "./communs";
import { euros, useCaisse } from "./contexte";
import { AvecIcone } from "./icones";

/** Une dette se règle par carte ou en espèces (les titres-restaurant paient le repas du jour, pas une ardoise). */
const MODES: ModePaiement[] = ["CB", "ESPECES"];
const ICONES: Partial<Record<ModePaiement, LucideIcon>> = { CB: CreditCard, ESPECES: Banknote };
/** Au-delà de ce rendu (centimes), confirmation : faute de frappe probable. */
const RENDU_A_CONFIRMER = 2000;
const jour = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });

/**
 * Comptes clients (ardoises) de l'établissement. Les soldes viennent du
 * serveur, qui réunit les ventes et règlements de toutes les caisses : la page
 * demande donc une connexion. Vendre en compte reste possible hors ligne.
 */
export function Comptes() {
  const { caisse, synchroniser, utilisateur } = useCaisse();
  const [donnees, setDonnees] = useState<ReponseComptes | null>(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [tous, setTous] = useState(false);
  const [choisi, setChoisi] = useState<CompteClient | null>(null);
  // Le contexte recrée ses fonctions à chaque rendu : on garde la dernière sans relancer le chargement.
  const sync = useRef(synchroniser);
  sync.current = synchroniser;
  const api = useRef(caisse.client);
  api.current = caisse.client;

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur("");
    try {
      // Les ventes et règlements de cet appareil partent d'abord, pour un solde à jour.
      await sync.current();
      const reponse = await api.current.comptes();
      // Un règlement saisi ici et pas encore reçu par le serveur fausserait les soldes : on attend qu'il parte.
      const dernierLocal = (await caisse.stockage.dernier("tickets"))?.numero ?? 0;
      if (reponse.dernierTicketCaisse != null && reponse.dernierTicketCaisse < dernierLocal) {
        throw new Error("Des ventes ou règlements de cet appareil ne sont pas encore arrivés sur le serveur : soldes indisponibles. Réessayez dans un instant.");
      }
      setDonnees(reponse);
    } catch (e) {
      setDonnees(null);
      setErreur(
        e instanceof ErreurApi && e.code === "HORS_LIGNE"
          ? "Connexion nécessaire pour consulter les comptes : les soldes réunissent toutes les caisses. Vendre en compte reste possible hors ligne."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setChargement(false);
    }
  }, [caisse.stockage]);

  useEffect(() => void charger(), [charger]);

  const comptes = (donnees?.comptes ?? []).filter((c) => tous || c.soldeTTC > 0);
  const totalDu = (donnees?.comptes ?? []).reduce((s, c) => s + c.soldeTTC, 0);

  return (
    <div className="page comptes">
      <header className="page-tete">
        <h1>Comptes clients</h1>
        <p>{donnees ? `${euros(totalDu)} dus au total` : "Ardoises des clients de l'établissement"}</p>
        <button className="bouton" disabled={chargement} onClick={() => void charger()}>
          <AvecIcone icone={RefreshCw}>{chargement ? "Mise à jour…" : "Actualiser"}</AvecIcone>
        </button>
      </header>
      {erreur && <p className="erreur">{erreur}</p>}
      {donnees && utilisateur.role === "responsable" && donnees.anomalies.length > 0 && (
        <div className="bandeau-alerte" role="alert">
          <span>
            <TriangleAlert className="icone en-ligne" size={20} aria-hidden="true" /> {donnees.anomalies.join(" · ")}. Prévenez
            l'administrateur.
          </span>
        </div>
      )}
      {donnees && (
        <>
          <label className="case">
            <input type="checkbox" checked={tous} onChange={(e) => setTous(e.target.checked)} />
            Afficher aussi les clients sans dette
          </label>
          {comptes.length === 0 ? (
            <Vide>Aucune dette en cours. Pour porter une vente en compte : Encaisser › En compte.</Vide>
          ) : (
            <ul className="liste-comptes">
              {comptes.map((c) => (
                <li key={c.client.id}>
                  <button className="compte" onClick={() => setChoisi(c)} disabled={c.soldeTTC <= 0}>
                    <span>
                      <strong>{c.client.nom}</strong>
                      <small>
                        {c.client.telephone ? `${c.client.telephone} · ` : ""}
                        {c.ventes.length === 0
                          ? "aucune vente due"
                          : `${c.ventes.length} note${c.ventes.length > 1 ? "s" : ""} depuis le ${jour(c.ventes[0]!.horodatage)}`}
                      </small>
                    </span>
                    <strong className="montant">{euros(c.soldeTTC)}</strong>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {choisi && (
        <ModaleReglement
          compte={choisi}
          onFermer={() => setChoisi(null)}
          onRegle={() => {
            setChoisi(null);
            void charger();
          }}
        />
      )}
    </div>
  );
}

/** Règlement d'un compte : montant (toute la dette par défaut), moyens de paiement, puis reçu. */
function ModaleReglement(props: { compte: CompteClient; onFermer: () => void; onRegle: () => void }) {
  const { caisse, config, utilisateur, notifier, imprimer, imprimanteConfiguree, blocage } = useCaisse();
  const { compte } = props;
  const [aRegler, setARegler] = useState(compte.soldeTTC);
  const [modifierMontant, setModifierMontant] = useState(false);
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [saisie, setSaisie] = useState<number | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [recu, setRecu] = useState<Ticket | null>(null);
  const [note, setNote] = useState<VenteOuverte | null>(null);
  const paye = paiements.reduce((s, p) => s + p.montant, 0);
  const reste = Math.max(0, aRegler - paye);
  const montant = saisie ?? reste;
  const especes = paiements.filter((p) => p.mode === "ESPECES").reduce((s, p) => s + p.montant, 0);
  const excedent = paye - aRegler;
  const valide = aRegler > 0 && paye >= aRegler && excedent <= especes;

  const [renduAConfirmer, setRenduAConfirmer] = useState<number | null>(null);
  const ajouter = (mode: ModePaiement, m = montant, confirme = false) => {
    if (m <= 0 || reste === 0) return;
    if (mode !== "ESPECES" && m > reste) return notifier("Seules les espèces donnent lieu à un rendu.", "erreur");
    if (mode === "ESPECES" && m - reste > RENDU_A_CONFIRMER && !confirme) return setRenduAConfirmer(m);
    setRenduAConfirmer(null);
    setPaiements((l) => [...l, { mode, montant: m }]);
    setSaisie(null);
  };

  /** Les sommes reçues soldent d'abord les notes les plus anciennes. */
  const imputations = () => {
    let restant = aRegler;
    return compte.ventes.flatMap((v) => {
      const part = Math.min(restant, v.resteTTC);
      restant -= part;
      return part > 0
        ? [
            {
              caisseId: v.caisseId,
              numero: v.numero,
              hash: v.hash,
              montantTTC: part,
              venteTotalTTC: v.totalTTC,
              venteEnCompteTTC: v.enCompteTTC,
              dejaRegleTTC: v.regleTTC,
              venteVentilationTVA: v.ventilationTVA,
            },
          ]
        : [];
    });
  };

  const regler = async () => {
    if (blocage) return notifier(blocage, "erreur");
    setEnCours(true);
    try {
      const t = await caisse.registre.enregistrerReglement({
        client: { id: compte.client.id, nom: compte.client.nom },
        paiements,
        imputations: imputations(),
        operateurId: utilisateur.id,
      });
      setRecu(t);
      if (imprimanteConfiguree) {
        const r = gabaritReglement(t, config);
        const tiroir = paiements.some((p) => p.mode === "ESPECES");
        if (tiroir) r.ouvrirTiroir();
        await imprimer(r, `Règlement n° ${t.numero}`);
        await caisse.registre.journaliser("IMPRESSION_TICKET", { ticket: t.numero, canal: "papier" }, utilisateur.id);
        if (tiroir) await caisse.registre.journaliser("OUVERTURE_TIROIR", { ticket: t.numero }, utilisateur.id);
      }
    } catch (e) {
      notifier(e instanceof ErreurFiscale ? e.message : `Règlement impossible : ${String(e)}`, "erreur");
    } finally {
      setEnCours(false);
    }
  };

  if (recu) {
    return (
      <Modale
        titre={`${compte.client.nom} : règlement enregistré`}
        onFermer={props.onRegle}
        pied={
          <>
            {!imprimanteConfiguree && (
              <button className="bouton" onClick={() => void imprimer(gabaritReglement(recu, config), `Règlement n° ${recu.numero}`)}>
                <AvecIcone icone={Printer}>Voir le reçu</AvecIcone>
              </button>
            )}
            <button className="bouton principal" onClick={props.onRegle}>
              <AvecIcone icone={Check}>Terminé</AvecIcone>
            </button>
          </>
        }
      >
        <div className="fin-encaissement">
          <div className={`rendu${recu.renduMonnaie > 0 ? "" : " calme"}`}>
            <span>{recu.renduMonnaie > 0 ? "Rendu monnaie" : "Réglé"}</span>
            <strong>{euros(recu.renduMonnaie > 0 ? recu.renduMonnaie : recu.reglement!.montantTTC)}</strong>
          </div>
        </div>
        <p className="explication">
          Reste dû par {compte.client.nom} : {euros(compte.soldeTTC - recu.reglement!.montantTTC)}.
        </p>
      </Modale>
    );
  }

  return (
    <Modale
      titre={`Règlement · ${compte.client.nom}`}
      large
      onFermer={props.onFermer}
      pied={
        renduAConfirmer != null ? (
          <div className="confirmation-rendu" role="alertdialog" aria-label="Confirmer le rendu">
            <p>
              {euros(renduAConfirmer)} en espèces pour {euros(reste)} à payer : rendre <strong>{euros(renduAConfirmer - reste)}</strong> ?
            </p>
            <div className="options">
              <button className="bouton" onClick={() => setRenduAConfirmer(null)}>
                <AvecIcone icone={Undo2}>Corriger</AvecIcone>
              </button>
              <button className="bouton principal" onClick={() => ajouter("ESPECES", renduAConfirmer, true)}>
                <AvecIcone icone={Check}>Oui, rendre {euros(renduAConfirmer - reste)}</AvecIcone>
              </button>
            </div>
          </div>
        ) : (
          <>
            <button className="bouton" disabled={paiements.length === 0} onClick={() => setPaiements([])}>
              <AvecIcone icone={Trash2}>Effacer les paiements</AvecIcone>
            </button>
            <button className="bouton principal grand" disabled={!valide || enCours || !!blocage} onClick={() => void regler()}>
              <AvecIcone icone={Check}>
                {blocage ? "Encaissement bloqué" : enCours ? "Enregistrement…" : valide ? `Encaisser ${euros(aRegler)}` : `Reste ${euros(reste)}`}
              </AvecIcone>
            </button>
          </>
        )
      }
    >
      <div className="encaissement">
        <div className="encaissement-etat">
          <ul className="detail-lignes">
            {compte.ventes.map((v) => (
              <li key={`${v.caisseId}-${v.numero}`}>
                <button className="lien-note" onClick={() => setNote(v)} aria-label={`Ouvrir la note n° ${v.numero}`}>
                  <span>
                    Note n° {v.numero} <small>· {jour(v.horodatage)}</small>
                  </span>
                  <span>
                    {euros(v.resteTTC)} <ChevronRight className="icone" size={16} aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
            <li className="total">
              <span>Dû</span>
              <span>{euros(compte.soldeTTC)}</span>
            </li>
          </ul>
          <div className="ligne-montant">
            <span>À régler</span>
            <strong>{euros(aRegler)}</strong>
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
          <div className="afficheur" aria-label={modifierMontant ? "Montant à régler" : "Montant saisi"}>
            {euros(modifierMontant ? aRegler : montant)}
          </div>
          <Pave
            doubleZero
            onTouche={(t) =>
              modifierMontant
                ? setARegler((x) => Math.min(compte.soldeTTC, appliquerToucheMontant(x, t)))
                : setSaisie((s) => appliquerToucheMontant(s ?? 0, t))
            }
          />
          <button
            className={`option${modifierMontant ? " active" : ""}`}
            disabled={paiements.length > 0}
            onClick={() => {
              if (!modifierMontant) setARegler(0);
              else if (aRegler === 0) setARegler(compte.soldeTTC);
              setModifierMontant(!modifierMontant);
            }}
          >
            <AvecIcone icone={NotebookPen}>{modifierMontant ? "Montant fixé" : "Régler une partie"}</AvecIcone>
          </button>
        </div>
        <div className="encaissement-modes">
          {MODES.map((m) => (
            <button key={m} className={`mode mode-${m.toLowerCase()}`} disabled={montant <= 0 || modifierMontant || reste === 0} onClick={() => ajouter(m)}>
              <AvecIcone icone={ICONES[m]!} taille={26}>
                {LIBELLES_PAIEMENT[m]}
              </AvecIcone>
              <small>{euros(montant)}</small>
            </button>
          ))}
          {imprimanteConfiguree && <p className="explication">Le reçu s'imprime à l'encaissement.</p>}
        </div>
      </div>
      {note && <ModaleNoteCompte vente={note} onFermer={() => setNote(null)} />}
    </Modale>
  );
}

/**
 * Note portée en compte, rouverte depuis la fiche du client : lignes, moyens
 * de paiement, reste dû. Celle d'un autre appareil vient de la copie du serveur.
 */
function ModaleNoteCompte(props: { vente: VenteOuverte; onFermer: () => void }) {
  const { caisse, config, utilisateur, imprimer, imprimanteConfiguree } = useCaisse();
  const v = props.vente;
  const locale = v.caisseId === config.caisseId;
  const [etat, setEtat] = useState<{ ticket: Ticket; tickets: Ticket[] } | { erreur: string } | null>(null);

  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        if (locale) {
          const tickets = await caisse.stockage.lister("tickets", v.numero);
          const t = tickets.find((x) => x.numero === v.numero && x.hash === v.hash);
          if (t) return !annule && setEtat({ ticket: t, tickets });
        }
        const r = await caisse.client.ticket(v.caisseId, v.numero);
        if (!annule) setEtat({ ticket: r.ticket, tickets: [] });
      } catch (e) {
        if (annule) return;
        setEtat({
          erreur:
            e instanceof ErreurApi && e.code === "HORS_LIGNE"
              ? "Connexion nécessaire pour ouvrir une note encaissée sur un autre appareil."
              : e instanceof Error
                ? e.message
                : String(e),
        });
      }
    })();
    return () => {
      annule = true;
    };
  }, [caisse, locale, v.caisseId, v.numero, v.hash]);

  const duplicata = async (t: Ticket) => {
    const evts = await caisse.stockage.lister("evenements");
    const n = evts.filter((e) => e.code === "REIMPRESSION_TICKET" && e.details.ticket === t.numero).length + 1;
    await imprimer(gabaritNote(t, config, n), `Duplicata n° ${n}`);
    await caisse.registre.journaliser("REIMPRESSION_TICKET", { ticket: t.numero, duplicata: n, canal: imprimanteConfiguree ? "papier" : "ecran" }, utilisateur.id);
  };

  return (
    <Modale
      titre={`Note n° ${v.numero} · ${jour(v.horodatage)}`}
      onFermer={props.onFermer}
      pied={
        etat && "ticket" in etat && locale ? (
          <button className="bouton" onClick={() => void duplicata(etat.ticket)}>
            <AvecIcone icone={imprimanteConfiguree ? Printer : Eye}>{imprimanteConfiguree ? "Imprimer un duplicata" : "Voir un duplicata"}</AvecIcone>
          </button>
        ) : undefined
      }
    >
      <p className="explication">
        Reste dû : <strong>{euros(v.resteTTC)}</strong>
        {v.regleTTC > 0 && ` (déjà réglé ${euros(v.regleTTC)})`}
        {!locale && ` · encaissée sur l'appareil ${v.caisseId}`}
      </p>
      {etat == null ? (
        <p className="explication">Chargement de la note…</p>
      ) : "erreur" in etat ? (
        <p className="erreur">{etat.erreur}</p>
      ) : (
        <DetailTicket ticket={etat.ticket} tickets={etat.tickets} />
      )}
    </Modale>
  );
}
