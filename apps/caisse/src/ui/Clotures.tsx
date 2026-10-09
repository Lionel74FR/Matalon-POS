import { CalendarCheck, Download, Eye, FileSpreadsheet, Lock, Printer, ShieldCheck } from "lucide-react";
import { AvecIcone } from "./icones";
import {
  construireArchive,
  dateComptable,
  ErreurFiscale,
  exporterCloturesCSV,
  signataireDepuis,
  verifierRegistre,
  type Cloture,
  type Evenement,
  type RapportVerification,
  type TotauxPeriode,
} from "@matalon/noyau-fiscal";
import type { ReponseJournee } from "@matalon/serveur/partage";
import { useCallback, useEffect, useRef, useState } from "react";
import { HEURE_BASCULE } from "../fiscal/caisse";
import { chargerJournee, journeePourCloture, rendreVerrou } from "../fiscal/journee";
import { ErreurApi } from "../serveur/client";
import { gabaritCloture, gabaritLectureX, LIBELLES_PAIEMENT } from "../impression/gabarits";
import { comptageDeLaZ, detailsComptage, type EtatJournee, type SaisieComptage } from "../metier/tresorerie";
import { Modale, Vide } from "./communs";
import { AppareilsDeLaJournee, ModaleComptage } from "./modales/ModaleComptage";
import { euros, useCaisse } from "./contexte";

function telecharger(nom: string, contenu: string, type: string) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nom });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const LIBELLES = { JOUR: "Z", MOIS: "Mois", EXERCICE: "Exercice" } as const;

/** Nombre de tickets couverts par une clôture (toutes caisses pour une clôture d'établissement), ou null. */
function nbTickets(c: Cloture): number | null {
  if (c.etablissement) {
    if (c.periode !== "JOUR") return null;
    return c.etablissement.caisses.reduce((n, x) => n + (x.premierTicket == null ? 0 : x.dernierTicketCouvert - x.premierTicket + 1), 0);
  }
  return c.premierTicket == null ? 0 : c.dernierTicket! - c.premierTicket + 1;
}

function Totaux({ t }: { t: TotauxPeriode }) {
  return (
    <dl className="totaux">
      <div>
        <dt>Total TTC</dt>
        <dd className="fort">{euros(t.totalTTC)}</dd>
      </div>
      <div>
        <dt>Ventes</dt>
        <dd>{t.nbVentes}</dd>
      </div>
      <div>
        <dt>Annulations</dt>
        <dd>{t.nbAnnulations}</dd>
      </div>
      <div>
        <dt>Remises et offerts</dt>
        <dd>{euros(t.totalRemisesTTC)}</dd>
      </div>
      {t.ventilationTVA.map((v) => (
        <div key={v.tauxTVA}>
          <dt>TVA {v.tauxTVA / 100} %</dt>
          <dd>
            {euros(v.montantTVA)} <small>sur {euros(v.baseHT)} HT</small>
          </dd>
        </div>
      ))}
      {t.paiements.map((p) => (
        <div key={p.mode}>
          <dt>{p.mode === "EN_COMPTE" ? "Porté en compte" : LIBELLES_PAIEMENT[p.mode]}</dt>
          <dd>{euros(p.montant)}</dd>
        </div>
      ))}
      {t.comptesClients && (
        <>
          <div>
            <dt>Règlements de comptes reçus ({t.comptesClients.nbReglements})</dt>
            <dd>{euros(t.comptesClients.reglementsTTC)}</dd>
          </div>
          <div>
            <dt>TVA exigible (sommes encaissées)</dt>
            <dd>{euros(t.comptesClients.ventilationTVAExigible.reduce((s, v) => s + v.montantTVA, 0))}</dd>
          </div>
        </>
      )}
    </dl>
  );
}

const montant = (v: unknown) => (typeof v === "number" ? euros(v) : "—");

function ResumeComptage({ e }: { e: Evenement }) {
  const d = e.details;
  const ligne = (libelle: string, caisse: unknown, compte: unknown, ecart: unknown) => (
    <tr>
      <td>{libelle}</td>
      <td className="nombre">{montant(caisse)}</td>
      <td className="nombre">{montant(compte)}</td>
      <td className={`nombre${ecart ? " erreur" : ""}`}>{montant(ecart)}</td>
    </tr>
  );
  return (
    <>
      <h3>Comptage</h3>
      <table className="tableau">
        <thead>
          <tr>
            <th />
            <th className="nombre">Caisse</th>
            <th className="nombre">Compté / TPE</th>
            <th className="nombre">Écart</th>
          </tr>
        </thead>
        <tbody>
          {ligne("Espèces (fond inclus)", d.especesAttendues, d.especesComptees, d.ecartEspeces)}
          {ligne("CB", d.cbCaisse, d.cbTpe, d.ecartCb)}
          {ligne("Titres-restaurant carte", d.trCarteCaisse, d.trCarteTpe, d.ecartTrCarte)}
          {d.trPapierCaisse ? ligne("Titres-restaurant papier", d.trPapierCaisse, d.trPapierComptes, d.ecartTrPapier) : null}
        </tbody>
      </table>
      <p className="explication">
        Fond du matin {montant(d.fondInitial)} · fond laissé {montant(d.fondConserve)} · remise en banque {montant(d.remiseEnBanque)}
        {d.motif ? ` · motif : ${String(d.motif)}` : ""}
      </p>
    </>
  );
}

/** Date de la période close : « 08/10/2026 » pour une Z, « octobre 2026 » pour un mois, l'année pour un exercice. */
export function datePeriode(identifiant: string): string {
  const jour = /^(\d{4})-(\d{2})-(\d{2})$/.exec(identifiant);
  if (jour) return `${jour[3]}/${jour[2]}/${jour[1]}`;
  const mois = /^(\d{4})-(\d{2})$/.exec(identifiant);
  if (mois) return new Date(Date.UTC(+mois[1]!, +mois[2]! - 1, 15)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return identifiant;
}

/** Lecture X, clôtures, export comptable, archives et contrôle d'intégrité. */
export function Clotures(props: { commandesOuvertes: number }) {
  const { caisse, config, utilisateur, notifier, imprimer, demanderResponsable, imprimanteConfiguree, synchroniser } = useCaisse();
  /** Clôtures scellées sur cet appareil. */
  const [clotures, setClotures] = useState<Cloture[]>([]);
  /** Clôtures des autres appareils, depuis le serveur ; null : hors ligne. */
  const [distantes, setDistantes] = useState<{ clotures: Cloture[]; appareils: Record<string, string> } | null>(null);
  const [lecture, setLecture] = useState<(TotauxPeriode & { dateComptable: string; journee: ReponseJournee | null }) | null>(null);
  /** Journée de l'établissement reçue avec le verrou de clôture : le comptage et la Z portent sur elle. */
  const [zEnCours, setZEnCours] = useState<{ journee: ReponseJournee | null } | null>(null);
  const journeeZ = zEnCours?.journee ?? null;
  const [rapport, setRapport] = useState<RapportVerification | null>(null);
  const [choisie, setChoisie] = useState<Cloture | null>(null);
  const [comptageChoisie, setComptageChoisie] = useState<Evenement | null>(null);

  useEffect(() => {
    setComptageChoisie(null);
    let annule = false;
    // Le comptage est un événement de l'appareil qui a clôturé : introuvable ici pour une autre caisse.
    if (choisie && choisie.caisseId === config.caisseId) void comptageDeLaZ(caisse.stockage, choisie).then((c) => !annule && setComptageChoisie(c));
    return () => {
      annule = true;
    };
  }, [choisie, caisse.stockage, config.caisseId]);

  const charger = useCallback(async () => {
    setClotures((await caisse.stockage.derniers("clotures", 120)).reverse());
    try {
      const r = await caisse.client.cloturesEtablissement(120);
      setDistantes({ clotures: r.clotures.filter((c) => c.caisseId !== config.caisseId), appareils: r.appareils });
    } catch {
      setDistantes(null);
    }
  }, [caisse.stockage, caisse.client, config.caisseId]);
  const locale = (c: Cloture) => c.caisseId === config.caisseId;
  const appareil = (c: Cloture) => (locale(c) ? config.caisseNom : (distantes?.appareils[c.caisseId] ?? c.caisseId));
  /** Toutes les clôtures de l'établissement, de la plus récente à la plus ancienne. */
  const toutes = [...clotures, ...(distantes?.clotures ?? [])].sort(
    (a, b) => b.horodatage.localeCompare(a.horodatage) || b.numero - a.numero,
  );
  const plusieursAppareils = new Set(toutes.map((c) => c.caisseId)).size > 1 || Object.keys(distantes?.appareils ?? {}).length > 1;
  useEffect(() => void charger(), [charger]);

  // Mois à clôturer pour l'établissement : un mois terminé qui a des Z (sur n'importe quel appareil) et pas encore sa clôture.
  const moisCourant = dateComptable(new Date(), HEURE_BASCULE).slice(0, 7);
  const moisClos = new Set(toutes.filter((c) => c.periode === "MOIS" && (c.etablissement || locale(c))).map((c) => c.identifiantPeriode));
  const moisAClore = [...new Set(toutes.filter((c) => c.periode === "JOUR").map((c) => c.identifiantPeriode.slice(0, 7)))]
    .filter((m) => m < moisCourant && !moisClos.has(m))
    .sort();

  const executer = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (e) {
      notifier(e instanceof Error ? e.message : String(e), "erreur");
    }
  };

  /** Lecture X de l'établissement ; hors ligne, de cet appareil seul (signalé). */
  const lectureX = () =>
    executer(async () => {
      let journee: ReponseJournee | null = null;
      try {
        journee = await chargerJournee(caisse, synchroniser);
      } catch (e) {
        if (!(e instanceof ErreurApi && e.code === "HORS_LIGNE")) throw e;
      }
      const x = await caisse.registre.lectureX(utilisateur.id, journee?.contexte);
      setLecture({ ...x, journee });
    });

  /** Z : verrou de clôture (un appareil à la fois), puis comptage sur la journée de tout l'établissement. */
  const [preparationZ, setPreparationZ] = useState(false);
  const ouvrirZ = () =>
    executer(async () => {
      if (preparationZ) return;
      setPreparationZ(true);
      try {
        setZEnCours({ journee: await journeePourCloture(caisse, synchroniser) });
      } finally {
        setPreparationZ(false);
      }
    });
  const fermerZ = () => {
    if (journeeZ) rendreVerrou(caisse);
    setZEnCours(null);
  };

  const clotureEnCours = useRef(false);
  const [enCoursZ, setEnCoursZ] = useState(false);
  const cloturerJour = (saisie: SaisieComptage, etat: EtatJournee) =>
    executer(async () => {
      // Un double appui ne doit pas produire une seconde Z.
      if (clotureEnCours.current) return;
      clotureEnCours.current = true;
      setEnCoursZ(true);
      try {
        const responsable = await demanderResponsable("Comptage et clôture Z de la journée.");
        if (!responsable) return;
        // Le comptage déclare la journée de la dernière Z produite : celle du dernier ticket, ou aujourd'hui sans ticket.
        const journee = etat.dateComptable ?? dateComptable(new Date(), HEURE_BASCULE);
        const comptage = await caisse.registre.journaliser("COMPTAGE_CAISSE", detailsComptage(etat.totaux, saisie, journee), responsable);
        const z = await caisse.registre.cloturerJournee(responsable, journeeZ?.contexte);
        setZEnCours(null);
        setLecture(null);
        // Envoyée tout de suite : le serveur rend le verrou en la recevant, les autres appareils la voient.
        await synchroniser();
        if (imprimanteConfiguree) {
          for (const [i, c] of z.entries()) {
          await imprimer(gabaritCloture(c, config, i === z.length - 1 ? comptage : null, journeeZ?.appareils), `Clôture Z ${c.identifiantPeriode}`);
        }
        }
        notifier(z.length > 1 ? `${z.length} journées clôturées.` : `Journée du ${z[0]!.identifiantPeriode} clôturée.`);
        await charger();
      } finally {
        clotureEnCours.current = false;
        setEnCoursZ(false);
      }
    });

  const cloturerMois = (mois: string) =>
    executer(async () => {
      const journee = await journeePourCloture(caisse, synchroniser);
      try {
        const responsable = await demanderResponsable(`Clôture mensuelle de ${mois} pour tout l'établissement.`);
        if (!responsable) return;
        const c = await caisse.registre.cloturerMois(mois, responsable, journee?.contexte);
        await synchroniser();
        if (imprimanteConfiguree) await imprimer(gabaritCloture(c, config, null, journee?.appareils), `Clôture ${mois}`);
        notifier(`Mois ${mois} clôturé pour l'établissement.`);
        await charger();
      } finally {
        if (journee) rendreVerrou(caisse);
      }
    });

  const exporterCSV = () =>
    executer(async () => {
      const toutes = await caisse.stockage.lister("clotures");
      telecharger(`clotures-${config.etablissementId}-${config.caisseId}.csv`, "﻿" + exporterCloturesCSV(toutes), "text/csv;charset=utf-8");
      await caisse.registre.journaliser("EXPORT", { format: "csv", clotures: toutes.length }, utilisateur.id);
    });

  /**
   * Archive d'une clôture : signée par cet appareil quand elle ne couvre que
   * lui ; sinon celle du serveur, qui détient les chaînes de toutes les caisses.
   */
  const archiver = (c: Cloture) =>
    executer(async () => {
      const nom = `archive-${config.etablissementId}-${c.caisseId}-${c.periode.toLowerCase()}-${c.identifiantPeriode}.json`;
      let empreinte: string;
      let locale = c.caisseId === config.caisseId;
      if (locale) {
        const cles = await caisse.db.get("cles", "caisse");
        if (!cles) throw new Error("Clé de caisse introuvable.");
        try {
          const archive = await construireArchive(caisse.stockage, c.numero, signataireDepuis(cles));
          telecharger(nom, JSON.stringify({ ...archive, clePubliqueJwk: cles.clePubliqueJwk }, null, 1), "application/json");
          empreinte = archive.empreinte;
        } catch (e) {
          if (!(e instanceof ErreurFiscale && e.code === "ARCHIVE_ETABLISSEMENT")) throw e;
          locale = false;
        }
      }
      if (!locale) {
        const archive = await caisse.client.archive(c.caisseId, c.numero);
        telecharger(nom, JSON.stringify(archive, null, 1), "application/json");
        empreinte = String(archive.empreinte);
      }
      await caisse.registre.journaliser(
        "ARCHIVAGE",
        { caisse: c.caisseId, cloture: c.numero, periode: c.periode, identifiantPeriode: c.identifiantPeriode, empreinte: empreinte!, source: locale ? "appareil" : "serveur" },
        utilisateur.id,
      );
    });

  const verifier = () =>
    executer(async () => {
      setRapport(await verifierRegistre(caisse.stockage, caisse.resoudreCle));
    });

  return (
    <div className="page">
      <header className="page-tete">
        <h1>Clôtures</h1>
        <p>
          La clôture Z fige la journée de tout l'établissement, tous appareils confondus ; elle se fait depuis n'importe lequel, en
          ligne. Elle est obligatoire chaque jour d'ouverture.
        </p>
      </header>

      <section className="actions-clotures">
        <button className="bouton" onClick={() => void lectureX()}>
          <AvecIcone icone={Eye}>Lecture X</AvecIcone>
        </button>
        <button className="bouton principal" disabled={preparationZ} onClick={() => void ouvrirZ()}>
          <AvecIcone icone={Lock}>Clôturer la journée (Z)</AvecIcone>
        </button>
        {moisAClore.map((m) => (
          <button key={m} className="bouton" onClick={() => void cloturerMois(m)}>
            <AvecIcone icone={CalendarCheck}>Clôturer le mois {m}</AvecIcone>
          </button>
        ))}
        <span className="espace" />
        <button className="bouton discret" onClick={() => void exporterCSV()}>
          <AvecIcone icone={FileSpreadsheet}>Export comptable CSV</AvecIcone>
        </button>
        <button className="bouton discret" onClick={() => void verifier()}>
          <AvecIcone icone={ShieldCheck}>Vérifier l'intégrité</AvecIcone>
        </button>
      </section>

      {lecture && (
        <section className="carte-lecture">
          <header>
            <h2>
              Lecture X · journée du {lecture.dateComptable}
              {lecture.journee ? "" : " · cet appareil seulement (hors ligne)"}
            </h2>
            {imprimanteConfiguree && (
              <button className="bouton discret" onClick={() => void imprimer(gabaritLectureX(lecture, config, utilisateur.id), "Lecture X")}>
                <AvecIcone icone={Printer}>Imprimer</AvecIcone>
              </button>
            )}
          </header>
          {lecture.journee && <AppareilsDeLaJournee journee={lecture.journee} caisseId={config.caisseId} />}
          <Totaux t={lecture} />
        </section>
      )}

      {distantes === null && <p className="explication">Hors ligne : seules les clôtures de cet appareil sont affichées.</p>}
      {toutes.length === 0 ? (
        <Vide>Aucune clôture. La première apparaîtra ici après la clôture Z du premier soir.</Vide>
      ) : (
        <table className="tableau tableau-clotures">
          <thead>
            <tr>
              <th>Date</th>
              {plusieursAppareils && <th>Appareil</th>}
              <th>Type</th>
              <th>Tickets</th>
              <th className="nombre">Total TTC</th>
            </tr>
          </thead>
          <tbody>
            {toutes.map((c) => (
              <tr key={`${c.caisseId}#${c.numero}`} onClick={() => setChoisie(c)}>
                <td className="date-cloture">{datePeriode(c.identifiantPeriode)}</td>
                {plusieursAppareils && <td>{appareil(c)}</td>}
                <td>{LIBELLES[c.periode]}</td>
                <td>{nbTickets(c) ?? "—"}</td>
                <td className="nombre">{euros(c.totalTTC)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {zEnCours && (
        <ModaleComptage
          commandesOuvertes={props.commandesOuvertes}
          journee={journeeZ}
          enCours={enCoursZ}
          onValide={(saisie, etat) => void cloturerJour(saisie, etat)}
          onFermer={fermerZ}
        />
      )}

      {choisie && (
        <Modale
          titre={`${LIBELLES[choisie.periode]} ${datePeriode(choisie.identifiantPeriode)} · n° ${choisie.numero}${plusieursAppareils ? ` · ${appareil(choisie)}` : ""}`}
          onFermer={() => setChoisie(null)}
          pied={
            <>
              {(locale(choisie) || distantes) && (
                <button className="bouton" onClick={() => void archiver(choisie)}>
                  <AvecIcone icone={Download}>Télécharger l'archive</AvecIcone>
                </button>
              )}
              <button
                className="bouton"
                onClick={() => void imprimer(gabaritCloture(choisie, config, comptageChoisie, distantes?.appareils), `Clôture ${choisie.identifiantPeriode}`)}
              >
                <AvecIcone icone={imprimanteConfiguree ? Printer : Eye}>{imprimanteConfiguree ? "Réimprimer" : "Voir le ticket Z"}</AvecIcone>
              </button>
            </>
          }
        >
          {!locale(choisie) && (
            <p className="explication">
              Clôture faite sur « {appareil(choisie)} » : son comptage se consulte sur cet appareil ; l'archive vient du serveur.
            </p>
          )}
          {choisie.etablissement && choisie.periode === "JOUR" && (
            <ul className="detail-lignes">
              {choisie.etablissement.caisses.map((x) => (
                <li key={x.caisseId}>
                  <span>{x.caisseId === config.caisseId ? config.caisseNom : (distantes?.appareils[x.caisseId] ?? x.caisseId)}</span>
                  <span>{x.premierTicket == null ? "aucun ticket" : `tickets ${x.premierTicket} à ${x.dernierTicketCouvert}`}</span>
                </li>
              ))}
            </ul>
          )}
          <Totaux t={choisie} />
          <p className="explication">Grand total perpétuel : {euros(choisie.grandTotalPerpetuel)}</p>
          {comptageChoisie && <ResumeComptage e={comptageChoisie} />}
        </Modale>
      )}

      {rapport && (
        <Modale titre="Contrôle d'intégrité" onFermer={() => setRapport(null)}>
          {rapport.integre ? (
            <p className="succes">
              Chaînes intactes : {rapport.compteurs.tickets} tickets, {rapport.compteurs.evenements} événements et{" "}
              {rapport.compteurs.clotures} clôtures vérifiés, signatures valides.
            </p>
          ) : (
            <>
              <p className="erreur">{rapport.anomalies.length} anomalie(s) détectée(s). Prévenez immédiatement le responsable.</p>
              <ul className="detail-lignes">
                {rapport.anomalies.slice(0, 50).map((a, i) => (
                  <li key={i}>
                    <span>
                      {a.chaine} n° {a.numero} · {a.code}
                    </span>
                    <span>{a.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Modale>
      )}
    </div>
  );
}
