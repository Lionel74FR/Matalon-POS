import { Eye, FileText, Printer, QrCode, RefreshCw, Search, SlidersHorizontal, Undo2, Wallet, X } from "lucide-react";
import { AvecIcone, BoutonIcone } from "./icones";
import { dateComptable, ErreurFiscale, MODES_PAIEMENT, paiementsEffectifs, ticketCouvertPar, type ModePaiement, type Ticket } from "@matalon/noyau-fiscal";
import { useCallback, useEffect, useMemo, useState } from "react";
import { gabaritNote, LIBELLES_PAIEMENT, nomTable, nomUtilisateur } from "../impression/gabarits";
import { HEURE_BASCULE } from "../fiscal/caisse";
import { FILTRES_VIDES, filtrerTickets, NATURES, nombreFiltres, totaliser, type FiltresTickets, type NatureTicket } from "../metier/filtres-tickets";
import { centimesDepuisSaisie, Modale, Vide } from "./communs";
import { euros, useCaisse } from "./contexte";
import { QrNote, urlNoteTicket } from "./QrNote";
import { ModaleFacture } from "./modales/ModaleFacture";
import { ModaleCorrection } from "./modales/ModaleCorrection";
import { DetailTicket } from "./DetailTicket";
import { emettreAvoir, listerFactures } from "../metier/facture";

const MOTIFS_ANNULATION = ["Erreur de saisie", "Erreur de table", "Client parti sans consommer", "Réclamation client"];
const MOTIFS_ANNULATION_REGLEMENT = ["Erreur de client", "Erreur de montant", "Paiement refusé"];

const cle = (t: Pick<Ticket, "caisseId" | "numero">) => `${t.caisseId}#${t.numero}`;

const decaler = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
type Preset = "recents" | "aujourdhui" | "hier" | "7j" | "30j";
const PRESETS: Array<[Preset, string]> = [
  ["recents", "Récents"],
  ["aujourdhui", "Aujourd'hui"],
  ["hier", "Hier"],
  ["7j", "7 jours"],
  ["30j", "30 jours"],
];
function periodeDe(p: Preset, aujourdhui: string): { du: string; au: string } | null {
  if (p === "recents") return null;
  if (p === "aujourdhui") return { du: aujourdhui, au: aujourdhui };
  if (p === "hier") return { du: decaler(aujourdhui, -1), au: decaler(aujourdhui, -1) };
  return { du: decaler(aujourdhui, p === "7j" ? -6 : -29), au: aujourdhui };
}
const dateCourte = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
const pl = (n: number, mot: string) => `${n.toLocaleString("fr-FR")} ${mot}${n > 1 ? "s" : ""}`;

/**
 * Tickets de cet appareil sur des journées comptables, plus les annulations et
 * corrections faites après (contexte). Les tickets sont rangés dans l'ordre :
 * on remonte depuis le dernier jusqu'à la veille de la période.
 */
async function ticketsLocauxPeriode(
  stockage: { derniers(chaine: "tickets", n: number): Promise<Ticket[]> },
  du: string,
  au: string,
): Promise<{ periode: Ticket[]; contexte: Ticket[] }> {
  let n = 200;
  let lus: Ticket[] = [];
  for (;;) {
    lus = await stockage.derniers("tickets", n);
    const dernier = lus[lus.length - 1];
    if (lus.length < n || !dernier || dernier.dateComptable < du || n >= 50_000) break;
    n *= 4;
  }
  return {
    periode: lus.filter((t) => t.dateComptable >= du && t.dateComptable <= au),
    contexte: lus.filter((t) => t.dateComptable > au && (t.type === "ANNULATION" || t.type === "CORRECTION")),
  };
}

/** Bascule d'une valeur dans une liste (pastilles à choix multiple). */
const basculer = <T,>(liste: T[], v: T) => (liste.includes(v) ? liste.filter((x) => x !== v) : [...liste, v]);

/**
 * Derniers tickets de l'établissement : ceux de cet appareil (même hors ligne)
 * et ceux des autres caisses, depuis la copie du serveur. Détail pour tous ;
 * annulation, correction, facture et duplicata sur l'appareil qui a encaissé.
 */
export function Tickets() {
  const { caisse, config, utilisateur, notifier, imprimer, demanderResponsable, imprimanteConfiguree } = useCaisse();
  const [qr, setQr] = useState<{ ticket: Ticket; url: string } | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  /** Annulations et corrections postérieures à la période affichée (non listées). */
  const [contexte, setContexte] = useState<Ticket[]>([]);
  const [tronque, setTronque] = useState(false);
  const aujourdhui = dateComptable(new Date(), HEURE_BASCULE);
  const [preset, setPreset] = useState<Preset | null>("recents");
  const [periode, setPeriode] = useState<{ du: string; au: string } | null>(null);
  const [filtres, setFiltres] = useState<FiltresTickets>(FILTRES_VIDES);
  const [panneau, setPanneau] = useState(false);
  const [saisieMin, setSaisieMin] = useState("");
  const [saisieMax, setSaisieMax] = useState("");
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
    // Ceux des autres caisses viennent du serveur ; ceux de cet appareil font foi (même pas encore synchronisés).
    const { periode: locaux, contexte: contexteLocal } = periode
      ? await ticketsLocauxPeriode(caisse.stockage, periode.du, periode.au)
      : { periode: await caisse.stockage.derniers("tickets", 150), contexte: [] as Ticket[] };
    let distants: Ticket[] = [];
    let contexteDistant: Ticket[] = [];
    let incomplet = false;
    try {
      const r = periode ? await caisse.client.ticketsPeriode(periode.du, periode.au) : await caisse.client.ticketsEtablissement(150);
      distants = r.tickets.filter((t) => t.caisseId !== config.caisseId);
      contexteDistant = (r.contexte ?? []).filter((t) => t.caisseId !== config.caisseId);
      incomplet = r.tronque ?? false;
      setAppareils(r.appareils);
    } catch {
      setAppareils(null);
    }
    const tries = [...locaux, ...distants].sort((a, b) => b.horodatage.localeCompare(a.horodatage) || b.numero - a.numero);
    const liste = periode ? tries : tries.slice(0, 150);
    const autour = [...contexteLocal, ...contexteDistant];
    setTickets(liste);
    setContexte(autour);
    setTronque(incomplet);
    setAnnules(
      new Set(
        [...liste, ...autour].filter((t) => t.type === "ANNULATION" && t.ticketOrigine).map((t) => cle({ caisseId: t.caisseId, numero: t.ticketOrigine!.numero })),
      ),
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
  }, [caisse.stockage, caisse.client, config.caisseId, periode]);

  useEffect(() => void charger(), [charger]);

  /** Tickets connus (affichés et contexte) : corrections et annulations de ceux qu'on montre. */
  const tous = useMemo(() => [...tickets, ...contexte], [tickets, contexte]);

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
    !paiementsEffectifs(t, tous).some((p) => p.mode === "EN_COMPTE");

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

  const choisirPreset = (p: Preset) => {
    setPreset(p);
    setPeriode(periodeDe(p, aujourdhui));
  };
  const personnaliser = (champ: "du" | "au", valeur: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return;
    setPreset(null);
    setPeriode((p) => {
      const suivante = { ...(p ?? { du: aujourdhui, au: aujourdhui }), [champ]: valeur };
      return suivante.du <= suivante.au ? suivante : { du: valeur, au: valeur };
    });
  };
  const majFiltres = (m: Partial<FiltresTickets>) => setFiltres((f) => ({ ...f, ...m }));
  const effacer = () => {
    setFiltres(FILTRES_VIDES);
    setSaisieMin("");
    setSaisieMax("");
  };

  const texteTicket = (t: Ticket) => `${nomTable(config, t.tableId)} ${nomUtilisateur(config, t.operateurId)} ${appareil(t)}`;
  const affiches = useMemo(
    () => filtrerTickets(tickets, filtres, { tous, texte: texteTicket }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, filtres, tous, appareils],
  );
  const totaux = useMemo(() => totaliser(affiches, tous), [affiches, tous]);
  const nbFiltres = nombreFiltres(filtres);
  const filtreActif = nbFiltres > 0 || filtres.recherche.trim() !== "";
  const personnes = [...new Set(tickets.map((t) => t.operateurId).filter((id): id is string => !!id))].sort((a, b) =>
    nomUtilisateur(config, a).localeCompare(nomUtilisateur(config, b), "fr"),
  );
  const caisses = [...new Set(tickets.map((t) => t.caisseId))];
  const modesPresents = MODES_PAIEMENT.filter((m) => m !== "EN_COMPTE" || tickets.some((t) => t.paiements.some((p) => p.mode === "EN_COMPTE")));
  const libellePeriode = periode ? (periode.du === periode.au ? dateCourte(periode.du) : `du ${dateCourte(periode.du)} au ${dateCourte(periode.au)}`) : null;

  const pastilles = <T extends string>(valeurs: T[], choisis: T[], libelle: (v: T) => string, maj: (l: T[]) => void) =>
    valeurs.map((v) => (
      <button key={v} className={`pastille${choisis.includes(v) ? " active" : ""}`} aria-pressed={choisis.includes(v)} onClick={() => maj(basculer(choisis, v))}>
        {libelle(v)}
      </button>
    ));

  return (
    <div className="page">
      <header className="page-tete">
        <h1>Tickets</h1>
        <BoutonIcone icone={RefreshCw} variante="discret" libelle="Actualiser les tickets" onClick={() => void charger()} />
        <p>
          {periode ? `Tickets de l'établissement, ${libellePeriode}` : "Les 150 derniers tickets de l'établissement"}
          {appareils === null ? " (hors ligne : seulement ceux de cet appareil)" : ""}. Un ticket ne se modifie pas : une erreur se corrige par
          une annulation, ou par une correction du paiement avant la Z.
        </p>
      </header>

      <div className="filtres-tickets">
        <div className="filtres-ligne" role="group" aria-label="Période">
          {PRESETS.map(([p, libelle]) => (
            <button key={p} className={`pastille${preset === p ? " active" : ""}`} aria-pressed={preset === p} onClick={() => choisirPreset(p)}>
              {libelle}
            </button>
          ))}
          <label className="filtre-date">
            Du
            <input type="date" value={periode?.du ?? ""} max={aujourdhui} onChange={(e) => personnaliser("du", e.target.value)} />
          </label>
          <label className="filtre-date">
            au
            <input type="date" value={periode?.au ?? ""} max={aujourdhui} onChange={(e) => personnaliser("au", e.target.value)} />
          </label>
        </div>
        <div className="filtres-ligne">
          <label className="recherche-client recherche-tickets">
            <Search size={20} aria-hidden="true" />
            <input
              type="search"
              value={filtres.recherche}
              placeholder="N°, montant, table, client, serveur…"
              aria-label="Rechercher un ticket"
              onChange={(e) => majFiltres({ recherche: e.target.value })}
            />
          </label>
          <button className={`bouton${panneau || nbFiltres ? " actif" : ""}`} aria-expanded={panneau} onClick={() => setPanneau((o) => !o)}>
            <AvecIcone icone={SlidersHorizontal}>{nbFiltres ? `Filtres (${nbFiltres})` : "Filtres"}</AvecIcone>
          </button>
          {filtreActif && (
            <button className="bouton discret" onClick={effacer}>
              <AvecIcone icone={X}>Effacer</AvecIcone>
            </button>
          )}
        </div>
        {panneau && (
          <div className="filtres-panneau">
            <div className="filtre-groupe">
              <span>Montant</span>
              <div className="filtres-ligne">
                <input
                  className="filtre-montant"
                  inputMode="decimal"
                  placeholder="De … €"
                  aria-label="Montant minimum"
                  value={saisieMin}
                  onChange={(e) => {
                    setSaisieMin(e.target.value);
                    majFiltres({ montantMin: centimesDepuisSaisie(e.target.value) });
                  }}
                />
                <input
                  className="filtre-montant"
                  inputMode="decimal"
                  placeholder="à … €"
                  aria-label="Montant maximum"
                  value={saisieMax}
                  onChange={(e) => {
                    setSaisieMax(e.target.value);
                    majFiltres({ montantMax: centimesDepuisSaisie(e.target.value) });
                  }}
                />
              </div>
            </div>
            <div className="filtre-groupe">
              <span>Paiement</span>
              <div className="filtres-ligne">
                {pastilles<ModePaiement>(modesPresents, filtres.modes, (m) => LIBELLES_PAIEMENT[m], (modes) => majFiltres({ modes }))}
              </div>
            </div>
            <div className="filtre-groupe">
              <span>Nature</span>
              <div className="filtres-ligne">
                {pastilles<NatureTicket>(
                  NATURES.map(([n]) => n),
                  filtres.natures,
                  (n) => NATURES.find(([x]) => x === n)![1],
                  (natures) => majFiltres({ natures }),
                )}
              </div>
            </div>
            <div className="filtre-groupe">
              <span>Lieu</span>
              <div className="filtres-ligne">
                {(
                  [
                    ["tous", "Tous"],
                    ["comptoir", "Comptoir"],
                    ["table", "À table"],
                  ] as const
                ).map(([l, libelle]) => (
                  <button key={l} className={`pastille${filtres.lieu === l ? " active" : ""}`} aria-pressed={filtres.lieu === l} onClick={() => majFiltres({ lieu: l })}>
                    {libelle}
                  </button>
                ))}
              </div>
            </div>
            {personnes.length > 1 && (
              <div className="filtre-groupe">
                <span>Encaissé par</span>
                <div className="filtres-ligne">
                  {pastilles(personnes, filtres.operateurs, (id) => nomUtilisateur(config, id), (operateurs) => majFiltres({ operateurs }))}
                </div>
              </div>
            )}
            {caisses.length > 1 && (
              <div className="filtre-groupe">
                <span>Appareil</span>
                <div className="filtres-ligne">
                  {pastilles(caisses, filtres.appareils, (id) => (id === config.caisseId ? config.caisseNom : (appareils?.[id] ?? id)), (l) => majFiltres({ appareils: l }))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {tickets.length > 0 && (
        <p className="totaux-tickets" aria-live="polite">
          <strong>{pl(totaux.nombre, "ticket")}</strong>
          {filtreActif && ` sur ${tickets.length}`} · ventes {euros(totaux.ventesTTC)}
          {MODES_PAIEMENT.filter((m) => totaux.parMode[m]).map((m) => (
            <span key={m}>
              {" "}
              · {LIBELLES_PAIEMENT[m]} {euros(totaux.parMode[m]!)}
            </span>
          ))}
        </p>
      )}
      {tronque && <p className="erreur">Plus de 3 000 tickets sur la période : les plus anciens des autres appareils manquent. Réduisez la période.</p>}

      {tickets.length === 0 ? (
        <Vide>{periode ? "Aucun ticket sur cette période." : "Aucun ticket pour l'instant. Ils apparaîtront ici après le premier encaissement."}</Vide>
      ) : affiches.length === 0 ? (
        <Vide>Aucun ticket ne correspond aux filtres.</Vide>
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
            {affiches.map((t) => (
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
                    : (t.type === "VENTE" ? paiementsEffectifs(t, tous) : t.paiements).map((p) => LIBELLES_PAIEMENT[p.mode]).join(", ") || "—"}
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
          <DetailTicket ticket={choisi} tickets={tous} />
        </Modale>
      )}

      {correction && (
        <ModaleCorrection
          ticket={correction}
          avant={paiementsEffectifs(correction, tous)}
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
          ticket={factureDe.type === "VENTE" ? { ...factureDe, paiements: paiementsEffectifs(factureDe, tous), renduMonnaie: 0 } : factureDe}
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
              {paiementsEffectifs(annulation, tous).map((p) => `${LIBELLES_PAIEMENT[p.mode]} ${euros(p.montant)}`).join(", ") || "aucun"}
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
