import {
  construireArchive,
  dateComptable,
  ErreurFiscale,
  exporterCloturesCSV,
  signataireDepuis,
  verifierRegistre,
  type Cloture,
  type RapportVerification,
  type TotauxPeriode,
} from "@matalon/noyau-fiscal";
import { useCallback, useEffect, useState } from "react";
import { HEURE_BASCULE } from "../fiscal/caisse";
import { gabaritCloture, gabaritLectureX, LIBELLES_PAIEMENT } from "../impression/gabarits";
import { Modale, Vide } from "./communs";
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

/** Lecture X, clôtures, export comptable, archives et contrôle d'intégrité. */
export function Clotures(props: { commandesOuvertes: number }) {
  const { caisse, config, utilisateur, notifier, imprimer, demanderResponsable } = useCaisse();
  const [clotures, setClotures] = useState<Cloture[]>([]);
  const [lecture, setLecture] = useState<(TotauxPeriode & { dateComptable: string }) | null>(null);
  const [confirmationZ, setConfirmationZ] = useState(false);
  const [rapport, setRapport] = useState<RapportVerification | null>(null);
  const [choisie, setChoisie] = useState<Cloture | null>(null);

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

  const cloturerJour = () =>
    executer(async () => {
      const responsable = await demanderResponsable("Clôture Z de la journée.");
      if (!responsable) return;
      const z = await caisse.registre.cloturerJournee(responsable);
      setConfirmationZ(false);
      setLecture(null);
      for (const c of z) await imprimer(gabaritCloture(c, config), `Clôture Z ${c.identifiantPeriode}`);
      notifier(z.length > 1 ? `${z.length} journées clôturées.` : `Journée du ${z[0]!.identifiantPeriode} clôturée.`);
      await charger();
    });

  const cloturerMois = (mois: string) =>
    executer(async () => {
      const responsable = await demanderResponsable(`Clôture mensuelle de ${mois}.`);
      if (!responsable) return;
      const c = await caisse.registre.cloturerMois(mois, responsable);
      await imprimer(gabaritCloture(c, config), `Clôture ${mois}`);
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
          Lecture X
        </button>
        <button className="bouton principal" onClick={() => setConfirmationZ(true)}>
          Clôturer la journée (Z)
        </button>
        {moisAClore.map((m) => (
          <button key={m} className="bouton" onClick={() => void cloturerMois(m)}>
            Clôturer le mois {m}
          </button>
        ))}
        <span className="espace" />
        <button className="bouton discret" onClick={() => void exporterCSV()}>
          Export comptable CSV
        </button>
        <button className="bouton discret" onClick={() => void verifier()}>
          Vérifier l'intégrité
        </button>
      </section>

      {lecture && (
        <section className="carte-lecture">
          <header>
            <h2>Lecture X · journée du {lecture.dateComptable}</h2>
            <button className="bouton discret" onClick={() => void imprimer(gabaritLectureX(lecture, config, utilisateur.id), "Lecture X")}>
              Imprimer
            </button>
          </header>
          <Totaux t={lecture} />
        </section>
      )}

      {clotures.length === 0 ? (
        <Vide>Aucune clôture. La première apparaîtra ici après la clôture Z du premier soir.</Vide>
      ) : (
        <table className="tableau">
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
        <Modale
          titre="Clôturer la journée"
          onFermer={() => setConfirmationZ(false)}
          pied={
            <button className="bouton principal" onClick={() => void cloturerJour()}>
              Clôturer et imprimer le Z
            </button>
          }
        >
          <p className="explication">
            Tous les tickets encaissés depuis la dernière clôture sont figés. La clôture ne peut pas être annulée.
          </p>
          {props.commandesOuvertes > 0 && (
            <p className="erreur">
              {props.commandesOuvertes} commande{props.commandesOuvertes > 1 ? "s sont" : " est"} encore ouverte
              {props.commandesOuvertes > 1 ? "s" : ""}. Elle{props.commandesOuvertes > 1 ? "s seront comptées" : " sera comptée"} sur la
              journée où elle{props.commandesOuvertes > 1 ? "s seront encaissées" : " sera encaissée"}.
            </p>
          )}
        </Modale>
      )}

      {choisie && (
        <Modale
          titre={`${LIBELLES[choisie.periode]} ${choisie.identifiantPeriode} · n° ${choisie.numero}`}
          onFermer={() => setChoisie(null)}
          pied={
            <>
              <button className="bouton" onClick={() => void archiver(choisie)}>
                Télécharger l'archive
              </button>
              <button className="bouton" onClick={() => void imprimer(gabaritCloture(choisie, config), `Clôture ${choisie.identifiantPeriode}`)}>
                Réimprimer
              </button>
            </>
          }
        >
          <Totaux t={choisie} />
          <p className="explication">Grand total perpétuel : {euros(choisie.grandTotalPerpetuel)}</p>
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
