import { dateComptable, type Cloture, type Evenement, type ModePaiement } from "@matalon/noyau-fiscal";
import { Archive, ChevronLeft, ChevronRight, Download, FileSpreadsheet, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HEURE_BASCULE } from "../fiscal/caisse";
import { LIBELLES_PAIEMENT } from "../metier/libelles";
import { datePeriode, LIBELLES_CLOTURE, nbTickets, ResumeComptage, Totaux } from "../ui/Clotures";
import { Modale, Vide } from "../ui/communs";
import { euros } from "../ui/contexte";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api, type EtablissementAdmin } from "./api";

const moisLong = (mois: string) => new Date(`${mois}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const jourLong = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const decalerMois = (mois: string, n: number) => {
  const d = new Date(`${mois}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
const finDeMois = (mois: string) => {
  const d = new Date(`${decalerMois(mois, 1)}-01T12:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};
const pl = (n: number, mot: string) => `${n.toLocaleString("fr-FR")} ${mot}${n > 1 ? "s" : ""}`;
const cle = (c: Pick<Cloture, "caisseId" | "numero">) => `${c.caisseId}#${c.numero}`;
/** Écarts non nuls d'un comptage, en clair (« écart espèces -1,00 € · écart CB 2,00 € »). */
const ECARTS: Array<[string, string]> = [
  ["ecartEspeces", "espèces"],
  ["ecartCb", "CB"],
  ["ecartTrCarte", "titres carte"],
  ["ecartTrPapier", "titres papier"],
];
const ecartsDe = (d: Evenement["details"]) =>
  ECARTS.flatMap(([k, nom]) => (typeof d[k] === "number" && d[k] !== 0 ? [`écart ${nom} ${euros(d[k] as number)}`] : [])).join(" · ");

/**
 * Clôtures de l'établissement dans l'administration : les Z d'un mois (ou d'une année),
 * quel que soit l'appareil qui les a faites, leurs totaux, leur comptage et leur archive,
 * et les exports comptables de la période. Consultation : une clôture se fait sur la caisse.
 */
export function CloturesAdmin(props: { e: EtablissementAdmin }) {
  const { e } = props;
  const aujourdhui = dateComptable(new Date(), HEURE_BASCULE);
  const [mois, setMois] = useState(aujourdhui.slice(0, 7));
  const [annee, setAnnee] = useState(false);
  const periode = annee ? { du: `${mois.slice(0, 4)}-01-01`, au: `${mois.slice(0, 4)}-12-31` } : { du: `${mois}-01`, au: finDeMois(mois) };
  const [donnees, setDonnees] = useState<{ clotures: Cloture[]; comptages: Record<string, Evenement["details"]>; appareils: Record<string, string> } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [choisie, setChoisie] = useState<Cloture | null>(null);

  const charger = useCallback(async () => {
    setDonnees(null);
    try {
      setDonnees(await api.cloturesPeriode(e.id, periode.du, periode.au));
      setErreur(null);
    } catch (x) {
      setErreur(x instanceof Error ? x.message : String(x));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, periode.du, periode.au]);
  useEffect(() => void charger(), [charger]);

  const clotures = donnees?.clotures ?? [];
  const jours = clotures.filter((c) => c.periode === "JOUR");
  const mensuelles = clotures.filter((c) => c.periode === "MOIS");
  const appareil = (id: string) => donnees?.appareils[id] ?? id;
  const comptage = (c: Cloture) => donnees?.comptages[cle(c)] ?? null;
  /** Totaux des Z de la période (chaque Z couvre tout l'établissement ce jour-là). */
  const total = useMemo(() => {
    const parMode = new Map<ModePaiement, number>();
    for (const z of jours) for (const p of z.paiements) parMode.set(p.mode, (parMode.get(p.mode) ?? 0) + p.montant);
    return {
      ttc: jours.reduce((s, z) => s + z.totalTTC, 0),
      ht: jours.reduce((s, z) => s + z.totalHT, 0),
      tva: jours.reduce((s, z) => s + z.totalTVA, 0),
      ventes: jours.reduce((s, z) => s + z.nbVentes, 0),
      parMode: [...parMode].filter(([, m]) => m !== 0),
    };
  }, [jours]);
  const moisPasse = !annee && mois < aujourdhui.slice(0, 7);
  const libellePeriode = annee ? `l'année ${mois.slice(0, 4)}` : moisLong(mois);

  return (
    <section className="admin-section clotures-admin">
      <div className="tickets-admin-tete">
        <h2>
          <AvecIcone icone={Archive}>Clôtures et exports comptables</AvecIcone>
        </h2>
        <BoutonIcone icone={RefreshCw} variante="discret" libelle="Actualiser les clôtures" onClick={() => void charger()} />
      </div>
      <p className="explication">
        Les Z de tout l'établissement, quel que soit l'appareil qui les a faites. Une clôture se fait sur la caisse (menu › Clôtures) ;
        ici, on la consulte, on télécharge son archive et on exporte la période pour la comptabilité.
      </p>

      <div className="filtres-ligne" role="group" aria-label="Période">
        <BoutonIcone icone={ChevronLeft} variante="discret" libelle={annee ? "Année précédente" : "Mois précédent"} onClick={() => setMois((m) => decalerMois(m, annee ? -12 : -1))} />
        {annee ? (
          <strong className="clotures-periode">{mois.slice(0, 4)}</strong>
        ) : (
          <input type="month" aria-label="Mois" value={mois} max={aujourdhui.slice(0, 7)} onChange={(x) => /^\d{4}-\d{2}$/.test(x.target.value) && setMois(x.target.value)} />
        )}
        <BoutonIcone
          icone={ChevronRight}
          variante="discret"
          libelle={annee ? "Année suivante" : "Mois suivant"}
          disabled={annee ? mois.slice(0, 4) >= aujourdhui.slice(0, 4) : mois >= aujourdhui.slice(0, 7)}
          onClick={() => setMois((m) => decalerMois(m, annee ? 12 : 1))}
        />
        <button className={`pastille${!annee ? " active" : ""}`} aria-pressed={!annee} onClick={() => setAnnee(false)}>
          Mois
        </button>
        <button className={`pastille${annee ? " active" : ""}`} aria-pressed={annee} onClick={() => setAnnee(true)}>
          Année
        </button>
      </div>

      <div className="clotures-exports">
        <a className="bouton principal" href={api.urlExportClotures(e.id, periode.du, periode.au)}>
          <AvecIcone icone={FileSpreadsheet}>Export comptable (CSV)</AvecIcone>
        </a>
        <a className="bouton" href={api.urlExportComptages(e.id, periode.du, periode.au)}>
          <AvecIcone icone={Download}>Comptages de caisse (CSV)</AvecIcone>
        </a>
        <p className="explication">
          Export comptable : une ligne par clôture de {libellePeriode} (Z, mois, exercice), HT, TVA et TTC par taux, encaissements par moyen de
          paiement, remises, règlements de comptes clients, grand total perpétuel et empreinte ; séparateur « ; », montants à la virgule.
          Comptages : espèces attendues et comptées, cartes et titres-restaurant face au TPE, écarts et leur motif, dépenses en espèces, fond
          conservé et remise en banque.
        </p>
      </div>

      {erreur && <p className="erreur">{erreur}</p>}
      {!donnees && !erreur ? (
        <p className="explication">Chargement des clôtures…</p>
      ) : (
        <>
          {jours.length > 0 && (
            <div className="clotures-total" aria-label={`Total de ${libellePeriode}`}>
              <span>
                <strong>{euros(total.ttc)}</strong> TTC sur {pl(jours.length, "Z")} · {euros(total.ht)} HT · TVA {euros(total.tva)} · {pl(total.ventes, "vente")}
              </span>
              <small>{total.parMode.map(([m, v]) => `${m === "EN_COMPTE" ? "Porté en compte" : LIBELLES_PAIEMENT[m]} ${euros(v)}`).join(" · ")}</small>
            </div>
          )}
          {moisPasse && jours.length > 0 && mensuelles.length === 0 && (
            <p className="admin-alerte">Le mois de {moisLong(mois)} n'est pas encore clôturé : la clôture mensuelle se fait sur la caisse, menu › Clôtures.</p>
          )}
          {clotures.length === 0 ? (
            <Vide>Aucune clôture sur {libellePeriode}.</Vide>
          ) : (
            <ul className="tickets-liste" role="list" aria-label="Clôtures">
              {[...clotures].reverse().map((c) => {
                const ct = comptage(c);
                const ecarts = ct ? ecartsDe(ct) : "";
                const n = nbTickets(c);
                return (
                  <li key={cle(c)}>
                    <button className="ticket-admin" onClick={() => setChoisie(c)}>
                      <span className="ticket-admin-texte">
                        <strong>
                          {LIBELLES_CLOTURE[c.periode]} {c.periode === "JOUR" ? jourLong(c.identifiantPeriode) : datePeriode(c.identifiantPeriode)} · n° {c.numero}
                        </strong>
                        <small>
                          {appareil(c.caisseId)}
                          {n != null ? ` · ${pl(n, "ticket")}` : ""}
                          {c.periode === "JOUR" ? (ct ? ` · ${ecarts || "comptage sans écart"}` : " · sans comptage") : ""}
                        </small>
                      </span>
                      <strong className="tickets-montant">{euros(c.totalTTC)}</strong>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {choisie && (
        <Modale
          titre={`${LIBELLES_CLOTURE[choisie.periode]} ${datePeriode(choisie.identifiantPeriode)} · n° ${choisie.numero}`}
          onFermer={() => setChoisie(null)}
          pied={
            <a className="bouton" href={api.urlArchive(choisie.caisseId, choisie.numero)}>
              <AvecIcone icone={Archive}>Télécharger l'archive (JSON)</AvecIcone>
            </a>
          }
        >
          <p className="explication">
            Faite sur « {appareil(choisie.caisseId)} » le{" "}
            {new Date(choisie.horodatage).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" })}.
          </p>
          {choisie.etablissement && choisie.periode === "JOUR" && (
            <ul className="detail-lignes">
              {choisie.etablissement.caisses.map((x) => (
                <li key={x.caisseId}>
                  <span>{appareil(x.caisseId)}</span>
                  <span>{x.premierTicket == null ? "aucun ticket" : `tickets ${x.premierTicket} à ${x.dernierTicketCouvert}`}</span>
                </li>
              ))}
            </ul>
          )}
          <Totaux t={choisie} />
          <p className="explication">Grand total perpétuel : {euros(choisie.grandTotalPerpetuel)}</p>
          {comptage(choisie) ? (
            <ResumeComptage e={{ details: comptage(choisie)! }} />
          ) : (
            choisie.periode === "JOUR" && <p className="explication">Pas de comptage enregistré pour cette journée.</p>
          )}
          <p className="explication ticket-admin-empreinte">
            <AvecIcone icone={ShieldCheck} taille={14}>{`Empreinte ${choisie.hash}`}</AvecIcone>
          </p>
        </Modale>
      )}
    </section>
  );
}
