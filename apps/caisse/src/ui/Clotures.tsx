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
import { useCallback, useEffect, useRef, useState } from "react";
import { HEURE_BASCULE } from "../fiscal/caisse";
import { gabaritCloture, gabaritLectureX, LIBELLES_PAIEMENT } from "../impression/gabarits";
import { comptageDeLaZ, detailsComptage, type EtatJournee, type SaisieComptage } from "../metier/tresorerie";
import { Modale, Vide } from "./communs";
import { ModaleComptage } from "./modales/ModaleComptage";
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
          <dt>{LIBELLES_PAIEMENT[p.mode]}</dt>
          <dd>{euros(p.montant)}</dd>
        </div>
      ))}
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

/** Lecture X, clôtures, export comptable, archives et contrôle d'intégrité. */
export function Clotures(props: { commandesOuvertes: number }) {
  const { caisse, config, utilisateur, notifier, imprimer, demanderResponsable, imprimanteConfiguree } = useCaisse();
  const [clotures, setClotures] = useState<Cloture[]>([]);
  const [lecture, setLecture] = useState<(TotauxPeriode & { dateComptable: string }) | null>(null);
  const [confirmationZ, setConfirmationZ] = useState(false);
  const [rapport, setRapport] = useState<RapportVerification | null>(null);
  const [choisie, setChoisie] = useState<Cloture | null>(null);
  const [comptageChoisie, setComptageChoisie] = useState<Evenement | null>(null);

  useEffect(() => {
    setComptageChoisie(null);
    let annule = false;
    if (choisie) void comptageDeLaZ(caisse.stockage, choisie).then((c) => !annule && setComptageChoisie(c));
    return () => {
      annule = true;
    };
  }, [choisie, caisse.stockage]);

  const charger = useCallback(async () => setClotures((await caisse.stockage.derniers("clotures", 120)).reverse()), [caisse.stockage]);
  useEffect(() => void charger(), [charger]);

  const moisCourant = dateComptable(new Date(), HEURE_BASCULE).slice(0, 7);
  const moisClos = new Set(clotures.filter((c) => c.periode === "MOIS").map((c) => c.identifiantPeriode));
  const moisAClore = [...new Set(clotures.filter((c) => c.periode === "JOUR").map((c) => c.identifiantPeriode.slice(0, 7)))]
    .filter((m) => m < moisCourant && !moisClos.has(m))
    .sort();

  const executer = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (e) {
      notifier(e instanceof ErreurFiscale ? e.message : String(e), "erreur");
    }
  };

  const lectureX = () =>
    executer(async () => {
      const x = await caisse.registre.lectureX(utilisateur.id);
      setLecture(x);
    });

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
        const z = await caisse.registre.cloturerJournee(responsable);
        setConfirmationZ(false);
        setLecture(null);
        if (imprimanteConfiguree) {
          for (const [i, c] of z.entries()) await imprimer(gabaritCloture(c, config, i === z.length - 1 ? comptage : null), `Clôture Z ${c.identifiantPeriode}`);
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
      const responsable = await demanderResponsable(`Clôture mensuelle de ${mois}.`);
      if (!responsable) return;
      const c = await caisse.registre.cloturerMois(mois, responsable);
      if (imprimanteConfiguree) await imprimer(gabaritCloture(c, config), `Clôture ${mois}`);
      notifier(`Mois ${mois} clôturé.`);
      await charger();
    });

  const exporterCSV = () =>
    executer(async () => {
      const toutes = await caisse.stockage.lister("clotures");
      telecharger(`clotures-${config.etablissementId}-${config.caisseId}.csv`, "﻿" + exporterCloturesCSV(toutes), "text/csv;charset=utf-8");
      await caisse.registre.journaliser("EXPORT", { format: "csv", clotures: toutes.length }, utilisateur.id);
    });

  const archiver = (c: Cloture) =>
    executer(async () => {
      const cles = await caisse.db.get("cles", "caisse");
      if (!cles) throw new Error("Clé de caisse introuvable.");
      const archive = await construireArchive(caisse.stockage, c.numero, signataireDepuis(cles));
      const nom = `archive-${config.etablissementId}-${config.caisseId}-${c.periode.toLowerCase()}-${c.identifiantPeriode}.json`;
      telecharger(nom, JSON.stringify({ ...archive, clePubliqueJwk: cles.clePubliqueJwk }, null, 1), "application/json");
      await caisse.registre.journaliser(
        "ARCHIVAGE",
        { cloture: c.numero, periode: c.periode, identifiantPeriode: c.identifiantPeriode, empreinte: archive.empreinte },
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
        <p>La clôture Z fige la journée. Elle est obligatoire chaque jour d'ouverture.</p>
      </header>

      <section className="actions-clotures">
        <button className="bouton" onClick={() => void lectureX()}>
          <AvecIcone icone={Eye}>Lecture X</AvecIcone>
        </button>
        <button className="bouton principal" onClick={() => setConfirmationZ(true)}>
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
            <h2>Lecture X · journée du {lecture.dateComptable}</h2>
            {imprimanteConfiguree && (
              <button className="bouton discret" onClick={() => void imprimer(gabaritLectureX(lecture, config, utilisateur.id), "Lecture X")}>
                <AvecIcone icone={Printer}>Imprimer</AvecIcone>
              </button>
            )}
          </header>
          <Totaux t={lecture} />
        </section>
      )}

      {clotures.length === 0 ? (
        <Vide>Aucune clôture. La première apparaîtra ici après la clôture Z du premier soir.</Vide>
      ) : (
        <table className="tableau tableau-clotures">
          <thead>
            <tr>
              <th>N°</th>
              <th>Type</th>
              <th>Période</th>
              <th>Tickets</th>
              <th className="nombre">Total TTC</th>
            </tr>
          </thead>
          <tbody>
            {[...clotures].reverse().map((c) => (
              <tr key={c.numero} onClick={() => setChoisie(c)}>
                <td>{c.numero}</td>
                <td>{LIBELLES[c.periode]}</td>
                <td>{c.identifiantPeriode}</td>
                <td>{c.premierTicket == null ? "—" : `${c.premierTicket} à ${c.dernierTicket}`}</td>
                <td className="nombre">{euros(c.totalTTC)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirmationZ && (
        <ModaleComptage
          commandesOuvertes={props.commandesOuvertes}
          enCours={enCoursZ}
          onValide={(saisie, etat) => void cloturerJour(saisie, etat)}
          onFermer={() => setConfirmationZ(false)}
        />
      )}

      {choisie && (
        <Modale
          titre={`${LIBELLES[choisie.periode]} ${choisie.identifiantPeriode} · n° ${choisie.numero}`}
          onFermer={() => setChoisie(null)}
          pied={
            <>
              <button className="bouton" onClick={() => void archiver(choisie)}>
                <AvecIcone icone={Download}>Télécharger l'archive</AvecIcone>
              </button>
              <button
                className="bouton"
                onClick={() => void imprimer(gabaritCloture(choisie, config, comptageChoisie), `Clôture ${choisie.identifiantPeriode}`)}
              >
                <AvecIcone icone={imprimanteConfiguree ? Printer : Eye}>{imprimanteConfiguree ? "Réimprimer" : "Voir le ticket Z"}</AvecIcone>
              </button>
            </>
          }
        >
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
