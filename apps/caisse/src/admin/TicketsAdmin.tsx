import { dateComptable, paiementsEffectifs, type Ticket } from "@matalon/noyau-fiscal";
import type { ReponseTickets } from "@matalon/serveur/partage";
import { RefreshCw, Search, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HEURE_BASCULE } from "../fiscal/caisse";
import { LIBELLES_PAIEMENT } from "../metier/libelles";
import { FILTRES_VIDES, filtrerTickets, natureDe, parServeur, totaliser, ventesAnnulees } from "../metier/filtres-tickets";
import { Modale, Vide } from "../ui/communs";
import { euros } from "../ui/contexte";
import { DetailTicket } from "../ui/DetailTicket";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api, type EtablissementAdmin } from "./api";
import { EntetePage } from "./Page";

const decaler = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
type Preset = "aujourdhui" | "hier" | "7j" | "30j";
const PRESETS: Array<[Preset, string]> = [
  ["aujourdhui", "Aujourd'hui"],
  ["hier", "Hier"],
  ["7j", "7 jours"],
  ["30j", "30 jours"],
];
function periodeDe(p: Preset, aujourdhui: string): { du: string; au: string } {
  if (p === "aujourdhui") return { du: aujourdhui, au: aujourdhui };
  if (p === "hier") return { du: decaler(aujourdhui, -1), au: decaler(aujourdhui, -1) };
  return { du: decaler(aujourdhui, p === "7j" ? -6 : -29), au: aujourdhui };
}
const pl = (n: number, mot: string) => `${n.toLocaleString("fr-FR")} ${mot}${n > 1 ? "s" : ""}`;
const cle = (t: Pick<Ticket, "caisseId" | "numero">) => `${t.caisseId}#${t.numero}`;
const heure = (iso: string, avecJour: boolean) =>
  new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", ...(avecJour ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit" });
const TYPES = { ANNULATION: "Annulation", REGLEMENT: "Règlement de compte", CORRECTION: "Correction de paiement", VENTE: "Ticket" } as const;

/** Filtre reçu d'un autre écran (statistiques › équipe) : la personne et la période. */
export interface FiltreTickets {
  serveur: string | null;
  du: string;
  au: string;
  /** Ticket à ouvrir à l'arrivée (recherche). */
  ticket?: { caisseId: string; numero: number };
}

/**
 * Tickets de l'établissement dans l'administration : consultation seule. Résumé par
 * serveur (une ligne touchée filtre la liste), recherche, puis le détail de chaque ticket.
 * Annuler, corriger, facturer ou imprimer un duplicata se fait sur l'appareil qui a
 * encaissé : c'est lui qui scelle les enregistrements.
 */
export function TicketsAdmin(props: { e: EtablissementAdmin; filtre?: FiltreTickets | null }) {
  const { e } = props;
  const aujourdhui = dateComptable(new Date(), HEURE_BASCULE);
  const [preset, setPreset] = useState<Preset | null>(props.filtre ? null : "aujourdhui");
  const [periode, setPeriode] = useState(() => (props.filtre ? { du: props.filtre.du, au: props.filtre.au } : periodeDe("aujourdhui", aujourdhui)));
  const [serveur, setServeur] = useState<string | null>(props.filtre?.serveur ?? null);
  const [recherche, setRecherche] = useState("");
  const [donnees, setDonnees] = useState<ReponseTickets | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const [choisi, setChoisi] = useState<Ticket | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setDonnees(await api.ticketsPeriode(e.id, periode.du, periode.au));
      setErreur(null);
    } catch (x) {
      setErreur(x instanceof Error ? x.message : String(x));
    } finally {
      setChargement(false);
    }
  }, [e.id, periode]);
  useEffect(() => void charger(), [charger]);
  // Ticket choisi dans la recherche : son détail s'ouvre une fois la liste lue.
  const aOuvrir = useRef(props.filtre?.ticket ?? null);
  useEffect(() => {
    const cible = aOuvrir.current;
    const t = cible && donnees?.tickets.find((x) => x.caisseId === cible.caisseId && x.numero === cible.numero);
    if (t) {
      aOuvrir.current = null;
      setChoisi(t);
    }
  }, [donnees]);

  const nomServeur = (id: string | null) => (id ? (e.utilisateurs.find((u) => u.id === id)?.nom ?? id) : "—");
  const nomTable = (id: string | null) => (!id || id === "comptoir" ? "Comptoir" : `Table ${e.tables.find((t) => t.id === id)?.nom ?? id}`);
  const appareil = (id: string) => donnees?.appareils[id] ?? id;

  const tickets = donnees?.tickets ?? [];
  const tous = useMemo(() => [...tickets, ...(donnees?.contexte ?? [])], [donnees]); // eslint-disable-line react-hooks/exhaustive-deps
  const annulees = useMemo(() => ventesAnnulees(tous), [tous]);
  const resume = useMemo(() => parServeur(tickets, tous), [tickets, tous]);
  const affiches = useMemo(
    () =>
      filtrerTickets(tickets, { ...FILTRES_VIDES, recherche, operateurs: serveur ? [serveur] : [] }, {
        tous,
        texte: (t) => `${nomTable(t.tableId)} ${nomServeur(t.operateurId)} ${appareil(t.caisseId)}`,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, tous, recherche, serveur],
  );
  const totaux = useMemo(() => totaliser(affiches, tous), [affiches, tous]);
  const plusieursJours = periode.du !== periode.au;
  /** Annulation qui vise ce ticket (faite pendant ou après la période). */
  const annulationDe = (t: Ticket) => tous.find((x) => x.type === "ANNULATION" && x.caisseId === t.caisseId && x.ticketOrigine?.numero === t.numero);

  const choisirPreset = (p: Preset) => {
    setPreset(p);
    setPeriode(periodeDe(p, aujourdhui));
  };
  const personnaliser = (champ: "du" | "au", valeur: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return;
    setPreset(null);
    setPeriode((p) => {
      const suivante = { ...p, [champ]: valeur };
      return suivante.du <= suivante.au ? suivante : { du: valeur, au: valeur };
    });
  };

  const libelleTicket = (t: Ticket) =>
    t.reglement
      ? `${t.type === "REGLEMENT" ? "Règlement" : "Annulation de règlement"} · ${t.client?.nom ?? ""}`
      : t.type === "CORRECTION"
        ? `Correction du n° ${t.ticketOrigine?.numero}`
        : t.type === "ANNULATION"
          ? `Annulation du n° ${t.ticketOrigine?.numero}`
          : nomTable(t.tableId);
  const paiementsTexte = (t: Ticket) =>
    t.type === "CORRECTION"
      ? `${t.paiements.filter((p) => p.montant < 0).map((p) => LIBELLES_PAIEMENT[p.mode]).join(", ")} → ${t.paiements.filter((p) => p.montant > 0).map((p) => LIBELLES_PAIEMENT[p.mode]).join(", ")}`
      : (t.type === "VENTE" ? paiementsEffectifs(t, tous) : t.paiements).map((p) => LIBELLES_PAIEMENT[p.mode]).join(", ") || "sans paiement";

  return (
    <>
    <EntetePage
      surtitre="Piloter"
      titre="Tickets"
      aide="Tous les appareils, en consultation. Un ticket ne se modifie pas : l'annulation, la correction du paiement, la facture et le duplicata se font sur l'appareil qui a encaissé."
      actions={<BoutonIcone icone={RefreshCw} libelle="Actualiser les tickets" disabled={chargement} onClick={() => void charger()} />}
    />
    <section className="admin-section tickets-admin">

      <div className="filtres-ligne" role="group" aria-label="Période">
        {PRESETS.map(([p, libelle]) => (
          <button key={p} className={`pastille${preset === p ? " active" : ""}`} aria-pressed={preset === p} onClick={() => choisirPreset(p)}>
            {libelle}
          </button>
        ))}
        <label className="filtre-date">
          Du
          <input type="date" value={periode.du} max={aujourdhui} onChange={(x) => personnaliser("du", x.target.value)} />
        </label>
        <label className="filtre-date">
          au
          <input type="date" value={periode.au} max={aujourdhui} onChange={(x) => personnaliser("au", x.target.value)} />
        </label>
      </div>

      {erreur && <p className="erreur">{erreur}</p>}
      {donnees?.tronque && <p className="erreur">Plus de 3 000 tickets sur la période : les plus anciens manquent. Réduisez la période.</p>}

      {resume.length > 0 && (
        <div className="tickets-serveurs">
          <h3>
            <AvecIcone icone={Users}>Par serveur</AvecIcone>
          </h3>
          <ul role="list">
            {resume.map((r) => (
              <li key={r.operateurId}>
                <button
                  className={`tickets-serveur${serveur === r.operateurId ? " actif" : ""}`}
                  aria-pressed={serveur === r.operateurId}
                  onClick={() => setServeur((s) => (s === r.operateurId ? null : r.operateurId))}
                >
                  <span className="tickets-serveur-nom">
                    <strong>{nomServeur(r.operateurId)}</strong>
                    <small>
                      {pl(r.ventes, "ticket")} · moyen {euros(r.ticketMoyen)}
                      {r.couverts ? ` · ${pl(r.couverts, "couvert")}` : ""}
                      {r.remisesTTC ? ` · remises ${euros(r.remisesTTC)}` : ""}
                      {r.annulees ? ` · ${pl(r.annulees, "vente annulée")} (${euros(r.montantAnnule)})` : ""}
                    </small>
                  </span>
                  <strong className="tickets-montant">{euros(r.ttc)}</strong>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="filtres-ligne">
        <label className="recherche-client recherche-tickets">
          <Search size={20} aria-hidden="true" />
          <input type="search" value={recherche} placeholder="N°, montant, table, client…" aria-label="Rechercher un ticket" onChange={(x) => setRecherche(x.target.value)} />
        </label>
        {serveur && (
          <button className="bouton discret" onClick={() => setServeur(null)}>
            <AvecIcone icone={X}>{`${nomServeur(serveur)} : tous les serveurs`}</AvecIcone>
          </button>
        )}
      </div>

      {donnees && tickets.length > 0 && (
        <p className="totaux-tickets" aria-live="polite">
          <strong>{pl(totaux.nombre, "ticket")}</strong>
          {affiches.length !== tickets.length && ` sur ${tickets.length}`} · ventes {euros(totaux.ventesTTC)}
          {(Object.keys(totaux.parMode) as Array<keyof typeof totaux.parMode>)
            .filter((m) => totaux.parMode[m])
            .map((m) => (
              <span key={m}>
                {" "}
                · {LIBELLES_PAIEMENT[m]} {euros(totaux.parMode[m]!)}
              </span>
            ))}
        </p>
      )}

      {!donnees && !erreur ? (
        <p className="explication">Chargement des tickets…</p>
      ) : tickets.length === 0 ? (
        <Vide>Aucun ticket sur cette période.</Vide>
      ) : affiches.length === 0 ? (
        <Vide>Aucun ticket ne correspond.</Vide>
      ) : (
        <ul className="tickets-liste" role="list" aria-label="Tickets">
          {affiches.map((t) => {
            const nature = natureDe(t, annulees);
            return (
              <li key={cle(t)}>
                <button className={`ticket-admin nature-${nature.toLowerCase()}`} onClick={() => setChoisi(t)}>
                  <span className="ticket-admin-texte">
                    <strong>
                      N° {t.numero} · {heure(t.horodatage, plusieursJours)} · {libelleTicket(t)}
                    </strong>
                    <small>
                      {nomServeur(t.operateurId)} · {appareil(t.caisseId)} · {paiementsTexte(t)}
                      {nature === "VENTE_ANNULEE" ? " · annulé" : ""}
                    </small>
                  </span>
                  <strong className="tickets-montant">{t.reglement ? euros(t.reglement.montantTTC) : t.type === "CORRECTION" ? "—" : euros(t.totalTTC)}</strong>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {choisi && (
        <Modale lateral titre={`${TYPES[choisi.type]} n° ${choisi.numero}`} onFermer={() => setChoisi(null)}>
          <p className="explication ticket-admin-entete">
            {new Date(choisi.horodatage).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" })}
            <br />
            {appareil(choisi.caisseId)} · {nomTable(choisi.tableId)}
            {choisi.couverts ? ` · ${pl(choisi.couverts, "couvert")}` : ""} · encaissé par {nomServeur(choisi.operateurId)}
          </p>
          {annulationDe(choisi) && (
            <p className="erreur">
              Annulé par le ticket n° {annulationDe(choisi)!.numero} ({annulationDe(choisi)!.motif}), {heure(annulationDe(choisi)!.horodatage, true)}.
            </p>
          )}
          {choisi.motif && <p className="explication">Motif : {choisi.motif}</p>}
          <DetailTicket ticket={choisi} tickets={tous} nomAppareil={appareil} />
          <p className="explication ticket-admin-empreinte">
            Journée comptable du {new Date(`${choisi.dateComptable}T12:00:00Z`).toLocaleDateString("fr-FR", { dateStyle: "long", timeZone: "UTC" })} ·
            empreinte {choisi.hash.slice(0, 16)}
          </p>
        </Modale>
      )}
    </section>
    </>
  );
}
