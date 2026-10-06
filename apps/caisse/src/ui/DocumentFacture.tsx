import { baseHT, formaterEuros, VERSION_NOYAU_FISCAL, type Ticket } from "@matalon/noyau-fiscal";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Configuration } from "../donnees/configuration";
import { dateLongue } from "../impression/gabarits";
import { mentionsPaiement, natureOperation, prixUnitaireHT, type Facture } from "../metier/facture";
import { MODE_TEST } from "../fiscal/caisse";

const taux = (t: number) => `${(t / 100).toLocaleString("fr-FR")} %`;

/** Facture ou avoir au format A4, pour l'impression AirPrint ou l'enregistrement en PDF. */
export function DocumentFacture(props: { facture: Facture; ticket: Ticket; config: Configuration; duplicata?: boolean }) {
  const { facture: f, ticket: t, config } = props;
  const e = config.etablissement;
  const mentions = mentionsPaiement(f.nature, t, dateLongue);
  return (
    <article className="document-facture">
      {MODE_TEST && <p className="facture-test">Caisse de test — document sans valeur</p>}
      <header>
        <div>
          <h1>{e.enseigne}</h1>
          <p>
            {e.raisonSociale}
            <br />
            {e.adresse}
            <br />
            {e.codePostalVille}
            {e.telephone && (
              <>
                <br />
                Tél. {e.telephone}
              </>
            )}
          </p>
          <p className="facture-petit">
            {e.mentionsLegales}
            {e.mentionsLegales && <br />}
            SIRET {e.siret} · TVA {e.tvaIntracom}
          </p>
        </div>
        <div className="facture-titre">
          <h2>{f.nature === "AVOIR" ? "Avoir" : "Facture"}</h2>
          <p className="facture-numero">n° {f.numero}</p>
          {props.duplicata && <p className="facture-duplicata">Duplicata</p>}
          {f.factureOrigine && <p>Annule la facture n° {f.factureOrigine}</p>}
          <p>
            Émise le {dateLongue(f.evenement.horodatage)}
            <br />
            {f.nature === "AVOIR" ? (
              <>
                Annulation du {dateLongue(t.horodatage)}
                {t.ticketOrigine && (
                  <>
                    <br />
                    Vente d'origine : ticket n° {t.ticketOrigine.numero}
                  </>
                )}
              </>
            ) : (
              <>Vente du {dateLongue(t.horodatage)}</>
            )}
          </p>
        </div>
      </header>

      <section className="facture-client">
        <h3>Client</h3>
        <p>
          <strong>{f.client.nom}</strong>
          <br />
          {f.client.adresse}
          <br />
          {f.client.codePostalVille}
          {f.client.siren && (
            <>
              <br />
              SIREN/SIRET {f.client.siren}
            </>
          )}
          {f.client.tvaIntracom && (
            <>
              <br />
              TVA {f.client.tvaIntracom}
            </>
          )}
        </p>
      </section>

      <table className="facture-lignes">
        <thead>
          <tr>
            <th>Désignation</th>
            <th className="nombre">Qté</th>
            <th className="nombre">PU HT</th>
            <th className="nombre">TVA</th>
            <th className="nombre">Remise TTC</th>
            <th className="nombre">Total HT</th>
            <th className="nombre">Total TTC</th>
          </tr>
        </thead>
        <tbody>
          {t.lignes.map((l, i) => (
            <tr key={i}>
              <td>{l.libelle}</td>
              <td className="nombre">{l.quantite}</td>
              <td className="nombre">{formaterEuros(prixUnitaireHT(l))}</td>
              <td className="nombre">{taux(l.tauxTVA)}</td>
              <td className="nombre">{l.remiseTTC ? formaterEuros(l.remiseTTC) : ""}</td>
              <td className="nombre">{formaterEuros(baseHT(l.montantTTC, l.tauxTVA))}</td>
              <td className="nombre">{formaterEuros(l.montantTTC)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="facture-bas">
        <table className="facture-tva">
          <thead>
            <tr>
              <th>Taux</th>
              <th className="nombre">Base HT</th>
              <th className="nombre">TVA</th>
              <th className="nombre">TTC</th>
            </tr>
          </thead>
          <tbody>
            {t.ventilationTVA
              .filter((v) => v.montantTTC !== 0)
              .map((v) => (
                <tr key={v.tauxTVA}>
                  <td>{taux(v.tauxTVA)}</td>
                  <td className="nombre">{formaterEuros(v.baseHT)}</td>
                  <td className="nombre">{formaterEuros(v.montantTVA)}</td>
                  <td className="nombre">{formaterEuros(v.montantTTC)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <dl className="facture-totaux">
          <div>
            <dt>Total HT</dt>
            <dd>{formaterEuros(t.totalHT)} €</dd>
          </div>
          <div>
            <dt>Total TVA</dt>
            <dd>{formaterEuros(t.totalTVA)} €</dd>
          </div>
          <div className="fort">
            <dt>Total TTC</dt>
            <dd>{formaterEuros(t.totalTTC)} €</dd>
          </div>
        </dl>
      </div>

      <footer>
        <p>
          {mentions.paiement} {natureOperation(t)}, pas d'escompte.
          Établie d'après le ticket de caisse n° {t.numero}.
        </p>
        {f.client.siren && <p>{mentions.professionnels}</p>}
        <p className="facture-petit">
          {config.caisseId} · Matalon POS {VERSION_NOYAU_FISCAL} · empreinte du ticket {t.hash.slice(0, 16)}
        </p>
      </footer>
    </article>
  );
}

/**
 * Document A4 toujours présent (invisible) tant que la facture est affichée :
 * `imprimerA4()` l'imprime par la feuille du système (AirPrint ou PDF). Rien
 * ne dépend de l'événement « afterprint », capricieux dans une PWA iPadOS.
 */
export function ZoneImpressionA4(props: { children: React.ReactNode }) {
  useEffect(() => {
    const fin = () => document.documentElement.classList.remove("impression-a4-active");
    window.addEventListener("afterprint", fin);
    return () => {
      window.removeEventListener("afterprint", fin);
      fin();
    };
  }, []);
  return createPortal(<div className="impression-a4">{props.children}</div>, document.body);
}

export function imprimerA4(): void {
  document.documentElement.classList.add("impression-a4-active");
  window.print();
}
