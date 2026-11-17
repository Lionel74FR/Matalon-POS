import { ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NOM_APPAREIL } from "../donnees/appareil";
import { ErreurImpression, testerEpson } from "../impression/epson";
import type { ImprimanteEtablissement } from "../impression/imprimantes";
import { useCaisse } from "./contexte";
import { AvecIcone } from "./icones";

type Etat = { etat: "verification" } | { etat: "ok" } | { etat: "certificat" } | { etat: "injoignable"; message: string };

/**
 * Connexion aux imprimantes Epson depuis cet appareil (17 novembre 2026, Lionel : le bouton pour accepter
 * la connexion manquait sur l'iPhone). La caisse parle aux Epson en connexion chiffrée : chaque appareil
 * accepte une fois le certificat de chaque Epson qu'il utilise (tickets, additions, bons de production).
 */
export function ConnexionEpson() {
  const { config } = useCaisse();
  const epsons = (config.imprimantes ?? []).filter((i) => i.branchement.type === "epson");
  const [etats, setEtats] = useState<Record<string, Etat>>({});
  const verifier = useCallback(async (i: ImprimanteEtablissement) => {
    if (i.branchement.type !== "epson") return;
    setEtats((e) => ({ ...e, [i.id]: { etat: "verification" } }));
    let etat: Etat;
    try {
      await testerEpson(i.branchement.adresse);
      etat = { etat: "ok" };
    } catch (x) {
      etat =
        x instanceof ErreurImpression && x.cause_ === "certificat"
          ? { etat: "certificat" }
          : { etat: "injoignable", message: x instanceof Error ? x.message : String(x) };
    }
    setEtats((e) => ({ ...e, [i.id]: etat }));
  }, []);
  const cles = epsons.map((i) => `${i.id}:${i.branchement.type === "epson" ? i.branchement.adresse : ""}`).join(",");
  useEffect(() => {
    for (const i of epsons) void verifier(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cles, verifier]);
  if (!epsons.length) return null;

  return (
    <fieldset>
      <legend>Connexion aux imprimantes Epson</legend>
      <p className="aide-champ">
        Une fois par {NOM_APPAREIL} et par imprimante : « Autoriser » ouvre l'imprimante dans Safari, qui affiche « Cette connexion n'est pas
        privée ». Touchez « Afficher les détails », puis « consulter ce site web », confirmez, puis revenez sur la caisse et touchez « Vérifier ».
      </p>
      <div className="connexions-epson">
        {epsons.map((i) => {
          const adresse = i.branchement.type === "epson" ? i.branchement.adresse : "";
          const e = etats[i.id];
          return (
            <div key={i.id} className="connexion-epson">
              <span>
                <strong>{i.nom}</strong>
                <small>
                  {adresse} ·{" "}
                  {!e || e.etat === "verification" ? (
                    "vérification…"
                  ) : e.etat === "ok" ? (
                    <span className="etat bon">● connectée</span>
                  ) : e.etat === "certificat" ? (
                    <span className="etat attention">● à autoriser sur cet appareil</span>
                  ) : (
                    <span className="etat attention">● ne répond pas (Wi-Fi de l'établissement ?)</span>
                  )}
                </small>
              </span>
              <a className={`bouton${e?.etat === "certificat" ? " principal" : ""}`} href={`https://${adresse}/`} target="_blank" rel="noreferrer">
                <AvecIcone icone={e?.etat === "certificat" ? ShieldCheck : ExternalLink}>Autoriser</AvecIcone>
              </a>
              <button className="bouton" disabled={e?.etat === "verification"} onClick={() => void verifier(i)}>
                <AvecIcone icone={RefreshCw}>Vérifier</AvecIcone>
              </button>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
