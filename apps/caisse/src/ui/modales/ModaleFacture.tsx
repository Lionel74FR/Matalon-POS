import type { Ticket } from "@matalon/noyau-fiscal";
import { useEffect, useState } from "react";
import { gabaritFacture } from "../../impression/gabarits";
import {
  CLIENT_VIDE,
  controlerClient,
  emettreFacture,
  impressionsFacture,
  listerFactures,
  mentionsVendeurManquantes,
  tracerImpressionFacture,
  type ClientFacture,
  type Facture,
} from "../../metier/facture";
import { Modale } from "../communs";
import { useCaisse } from "../contexte";
import { DocumentFacture, imprimerA4, ZoneImpressionA4 } from "../DocumentFacture";

const CHAMPS: Array<[keyof ClientFacture, string, string?]> = [
  ["nom", "Nom ou raison sociale"],
  ["adresse", "Adresse"],
  ["codePostalVille", "Code postal et ville"],
  ["siren", "SIREN ou SIRET", "Client professionnel, facultatif"],
  ["tvaIntracom", "N° de TVA intracommunautaire", "Facultatif"],
];

/**
 * Facture sur demande d'un ticket, ou affichage de la facture / de l'avoir
 * déjà émis. La première impression est l'original ; les suivantes sont des
 * duplicatas, et chacune est tracée au journal.
 */
export function ModaleFacture(props: { ticket: Ticket; onFermer: () => void }) {
  const { caisse, config, utilisateur, notifier, imprimer, imprimanteConfiguree } = useCaisse();
  const [facture, setFacture] = useState<Facture | null | undefined>(undefined);
  const [impressions, setImpressions] = useState(0);
  const [client, setClient] = useState<ClientFacture>(CLIENT_VIDE);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const manquantes = mentionsVendeurManquantes(config.etablissement);

  useEffect(() => {
    let annule = false;
    void listerFactures(caisse.stockage).then(async (liste) => {
      // Une facture pointe sur la vente, un avoir sur le ticket d'annulation.
      const f = liste.find((x) => x.ticket === props.ticket.numero) ?? null;
      const n = f ? await impressionsFacture(caisse.stockage, f.numero) : 0;
      if (!annule) {
        setFacture(f);
        setImpressions(n);
      }
    });
    return () => {
      annule = true;
    };
  }, [caisse.stockage, props.ticket.numero]);

  const emettre = async () => {
    const e = controlerClient(client);
    if (e) return setErreur(e);
    setEnCours(true);
    setErreur("");
    try {
      const r = await emettreFacture(caisse.registre, caisse.stockage, { ticket: props.ticket, client, operateurId: utilisateur.id, caisseId: config.caisseId });
      setFacture(r.facture);
      setImpressions(await impressionsFacture(caisse.stockage, r.facture.numero));
      notifier(`Facture n° ${r.facture.numero} émise.`);
    } catch (x) {
      setErreur(x instanceof Error ? x.message : String(x));
    } finally {
      setEnCours(false);
    }
  };

  if (facture === undefined) return null;

  if (facture) {
    const duplicata = impressions > 0;
    const tracer = async (canal: string) => {
      await tracerImpressionFacture(caisse.registre, caisse.stockage, facture, canal, utilisateur.id);
      setImpressions((n) => n + 1);
    };
    return (
      <>
        <Modale
          titre={`${facture.nature === "AVOIR" ? "Avoir" : "Facture"} n° ${facture.numero}`}
          large
          onFermer={props.onFermer}
          pied={
            <>
              <button
                className="bouton"
                onClick={() =>
                  void (async () => {
                    await imprimer(gabaritFacture(facture, props.ticket, config, duplicata), `Facture ${facture.numero}`);
                    await tracer(imprimanteConfiguree ? "papier" : "ecran");
                  })()
                }
              >
                {imprimanteConfiguree ? "Imprimer sur l'imprimante ticket" : "Format ticket"}
              </button>
              <button
                className="bouton principal"
                onClick={() => {
                  imprimerA4();
                  void tracer("a4");
                }}
              >
                Imprimer en A4 ou PDF
              </button>
            </>
          }
        >
          {duplicata && <p className="explication">Document déjà imprimé : les nouvelles impressions portent la mention duplicata.</p>}
          <div className="apercu-facture">
            <DocumentFacture facture={facture} ticket={props.ticket} config={config} duplicata={duplicata} />
          </div>
        </Modale>
        <ZoneImpressionA4>
          <DocumentFacture facture={facture} ticket={props.ticket} config={config} duplicata={duplicata} />
        </ZoneImpressionA4>
      </>
    );
  }

  return (
    <Modale
      titre={`Facture du ticket n° ${props.ticket.numero}`}
      onFermer={props.onFermer}
      pied={
        <button className="bouton principal" disabled={enCours || manquantes.length > 0} onClick={() => void emettre()}>
          Émettre la facture
        </button>
      }
    >
      {manquantes.length > 0 ? (
        <p className="erreur">
          Identité de l'établissement incomplète pour facturer : {manquantes.join(", ")}. Complétez-la dans l'administration ou les réglages.
        </p>
      ) : (
        <p className="explication">
          La facture reprend le ticket à l'identique. Son numéro suit la série de cette caisse ; elle ne pourra plus être modifiée.
        </p>
      )}
      {CHAMPS.map(([cle, libelle, aide]) => (
        <label key={cle} className="champ">
          <span>
            {libelle}
            {aide && <small>{aide}</small>}
          </span>
          <input value={client[cle]} onChange={(e) => setClient({ ...client, [cle]: e.target.value })} autoComplete="off" />
        </label>
      ))}
      <p className="erreur" aria-live="assertive">
        {erreur}
      </p>
    </Modale>
  );
}
