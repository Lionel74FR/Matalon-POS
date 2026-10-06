import { useEffect, useMemo, useState } from "react";
import { COUPURES, etatJournee, rapprocher, totalCoupures, type EtatJournee, type SaisieComptage } from "../../metier/tresorerie";
import { centimesDepuisSaisie, ChampEuros, Modale, saisieDepuisCentimes } from "../communs";
import { euros, useCaisse } from "../contexte";

const coupureLisible = (c: number) => (c >= 100 ? `${c / 100} €` : `${c} c`);

function Ecart(props: { valeur: number }) {
  if (props.valeur === 0) return <span className="ecart nul">Juste</span>;
  return (
    <span className="ecart">
      {props.valeur > 0 ? "Excédent" : "Manque"} {euros(Math.abs(props.valeur))}
    </span>
  );
}

/**
 * Comptage avant la clôture Z : espèces (fond + encaissements nets), CB et
 * titres-restaurant rapprochés du TPE. Tout écart demande un motif ; le
 * comptage est tracé au journal puis repris sur le ticket Z.
 */
export function ModaleComptage(props: {
  commandesOuvertes: number;
  enCours?: boolean;
  onValide: (saisie: SaisieComptage, etat: EtatJournee) => void;
  onFermer: () => void;
}) {
  const { caisse, imprimanteConfiguree } = useCaisse();
  const [etat, setEtat] = useState<EtatJournee | null>(null);
  const [fond, setFond] = useState("");
  const [detail, setDetail] = useState<SaisieComptage["detail"]>({});
  const [totalDirect, setTotalDirect] = useState<string | null>(null);
  const [cbTpe, setCbTpe] = useState("");
  const [trCarteTpe, setTrCarteTpe] = useState("");
  const [trPapier, setTrPapier] = useState("");
  const [fondConserve, setFondConserve] = useState<string | null>(null);
  const [motif, setMotif] = useState("");

  useEffect(() => {
    void etatJournee(caisse.stockage).then((e) => {
      setEtat(e);
      setFond(saisieDepuisCentimes(e.fondDeclare ?? e.fondPropose ?? null));
    });
  }, [caisse.stockage]);

  const especesComptees = totalDirect != null ? centimesDepuisSaisie(totalDirect) : totalCoupures(detail);
  const trPapierCaisse = etat?.totaux.paiements.find((p) => p.mode === "TITRE_RESTAURANT_PAPIER")?.montant ?? 0;
  const saisie: SaisieComptage | null = useMemo(() => {
    const valeurs = {
      fondInitial: centimesDepuisSaisie(fond),
      especesComptees,
      cbTpe: centimesDepuisSaisie(cbTpe),
      trCarteTpe: centimesDepuisSaisie(trCarteTpe),
      trPapierComptes: trPapierCaisse === 0 && trPapier.trim() === "" ? 0 : centimesDepuisSaisie(trPapier),
    };
    if (Object.values(valeurs).some((v) => v == null)) return null;
    const fc = fondConserve == null ? valeurs.fondInitial! : centimesDepuisSaisie(fondConserve);
    if (fc == null) return null;
    return { ...(valeurs as Record<keyof typeof valeurs, number>), detail: totalDirect != null ? {} : detail, fondConserve: fc, motif };
  }, [fond, especesComptees, cbTpe, trCarteTpe, trPapier, trPapierCaisse, fondConserve, totalDirect, detail, motif]);

  const r = etat && saisie ? rapprocher(etat.totaux, saisie) : null;
  const motifManquant = !!r?.avecEcart && motif.trim().length < 3;
  const fondTropGrand = !!saisie && saisie.fondConserve > saisie.especesComptees;

  if (!etat) {
    return (
      <Modale titre="Comptage de fin de journée" onFermer={props.onFermer}>
        <p>Calcul des totaux…</p>
      </Modale>
    );
  }
  const t = etat.totaux;
  const encaisseEspeces = t.paiements.find((p) => p.mode === "ESPECES")?.montant ?? 0;
  const cbCaisse = t.paiements.find((p) => p.mode === "CB")?.montant ?? 0;
  const trCarteCaisse = t.paiements.find((p) => p.mode === "TITRE_RESTAURANT_CARTE")?.montant ?? 0;

  return (
    <Modale
      titre={`Comptage et clôture${etat.dateComptable ? ` · journée du ${etat.dateComptable}` : ""}`}
      large
      onFermer={props.onFermer}
      pied={
        <>
          {r && (
            <span className="comptage-resume">
              {r.avecEcart ? "Écart à justifier" : "Aucun écart"} · remise en banque {euros(Math.max(0, r.remiseEnBanque))}
            </span>
          )}
          <button
            className="bouton principal"
            disabled={!saisie || motifManquant || fondTropGrand || props.enCours}
            onClick={() => saisie && props.onValide(saisie, etat)}
          >
            {imprimanteConfiguree ? "Valider, clôturer et imprimer le Z" : "Valider et clôturer la journée"}
          </button>
        </>
      }
    >
      <p className="explication">
        {t.nbVentes} vente{t.nbVentes > 1 ? "s" : ""} pour {euros(t.totalTTC)}. La clôture fige la journée et ne peut pas être annulée.
      </p>
      {etat.journees.length > 1 && (
        <p className="erreur">
          La clôture de la veille a été oubliée : {etat.journees.length} Z seront produites ({etat.journees.join(", ")}). Le comptage
          porte sur l'ensemble et figure sur la dernière.
        </p>
      )}
      {props.commandesOuvertes > 0 && (
        <p className="erreur">
          {props.commandesOuvertes} commande{props.commandesOuvertes > 1 ? "s ouvertes seront comptées" : " ouverte sera comptée"} sur la
          journée de leur encaissement.
        </p>
      )}

      <div className="comptage">
        <section>
          <h3>Espèces</h3>
          <ChampEuros
            libelle="Fond de caisse du matin"
            aide={etat.fondDeclare == null ? "Non déclaré à l'ouverture : saisissez-le" : "Déclaré à l'ouverture"}
            valeur={fond}
            onChange={setFond}
          />
          <dl className="comptage-lignes">
            <div>
              <dt>Encaissé en espèces (rendu déduit)</dt>
              <dd>{euros(encaisseEspeces)}</dd>
            </div>
            <div>
              <dt>Attendu dans le tiroir</dt>
              <dd>{centimesDepuisSaisie(fond) == null ? "—" : euros(centimesDepuisSaisie(fond)! + encaisseEspeces)}</dd>
            </div>
          </dl>
          {totalDirect == null ? (
            <>
              <div className="coupures">
                {COUPURES.map((c) => (
                  <label key={c}>
                    <span>{coupureLisible(c)}</span>
                    <input
                      inputMode="numeric"
                      placeholder="0"
                      value={detail[c] ?? ""}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/\D/g, "").slice(0, 4));
                        setDetail((d) => ({ ...d, [c]: n || undefined }));
                      }}
                    />
                  </label>
                ))}
              </div>
              <button className="bouton discret" onClick={() => setTotalDirect(saisieDepuisCentimes(totalCoupures(detail) || null))}>
                Saisir le total directement
              </button>
            </>
          ) : (
            <>
              <ChampEuros libelle="Espèces comptées" valeur={totalDirect} onChange={setTotalDirect} />
              <button className="bouton discret" onClick={() => setTotalDirect(null)}>
                Compter par billets et pièces
              </button>
            </>
          )}
          <dl className="comptage-lignes">
            <div>
              <dt>Compté</dt>
              <dd className="fort">{especesComptees == null ? "—" : euros(especesComptees)}</dd>
            </div>
            <div>
              <dt>Écart espèces</dt>
              <dd>{r ? <Ecart valeur={r.ecartEspeces} /> : "—"}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3>Cartes (ticket de fin de journée du TPE)</h3>
          <ChampEuros libelle="Total CB du TPE" aide={`Caisse : ${euros(cbCaisse)}`} valeur={cbTpe} onChange={setCbTpe} />
          {r && <p className="comptage-ecart">Écart CB : <Ecart valeur={r.ecartCb} /></p>}
          <ChampEuros
            libelle="Titres-restaurant carte du TPE"
            aide={`Caisse : ${euros(trCarteCaisse)}`}
            valeur={trCarteTpe}
            onChange={setTrCarteTpe}
          />
          {r && <p className="comptage-ecart">Écart titres carte : <Ecart valeur={r.ecartTrCarte} /></p>}
          {trPapierCaisse > 0 && (
            <>
              <ChampEuros
                libelle="Titres-restaurant papier comptés"
                aide={`Caisse : ${euros(trPapierCaisse)}`}
                valeur={trPapier}
                onChange={setTrPapier}
              />
              {r && <p className="comptage-ecart">Écart titres papier : <Ecart valeur={r.ecartTrPapier} /></p>}
            </>
          )}

          <h3>Pour demain</h3>
          <ChampEuros
            libelle="Fond laissé dans le tiroir"
            aide="Le reste part en remise en banque"
            valeur={fondConserve ?? fond}
            onChange={setFondConserve}
          />
          {fondTropGrand && <p className="erreur">Le fond laissé dépasse les espèces comptées.</p>}
          {r?.avecEcart && (
            <label className="champ champ-motif">
              <span>
                Motif de l'écart
                <small>Obligatoire, tracé au journal</small>
              </span>
              <input value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={200} placeholder="Erreur de rendu, oubli de saisie…" />
            </label>
          )}
        </section>
      </div>
    </Modale>
  );
}
