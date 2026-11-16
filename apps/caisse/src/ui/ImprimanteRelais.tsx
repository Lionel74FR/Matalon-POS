import type { RelaisImpression } from "@matalon/serveur/partage";
import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { NOM_APPAREIL } from "../donnees/appareil";
import { gabaritTest } from "../impression/gabarits";
import { useCaisse } from "./contexte";
import { AvecIcone } from "./icones";

/**
 * Impression relayée par une dalle (16 novembre 2026, backlog n° 5) : un iPad ou un iPhone fait sortir
 * ses tickets sur l'imprimante série d'une dalle de l'établissement. Affiché seulement si une dalle
 * relais existe (ou si cet appareil en utilise une) : rien ne change au Moka.
 */
export function ImprimanteRelais() {
  const { caisse, config, majConfig, imprimer } = useCaisse();
  const choisi = config.imprimanteRelais;
  const [relais, setRelais] = useState<RelaisImpression[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let vivant = true;
    caisse.client
      .relais()
      .then((r) => vivant && setRelais(r.relais))
      .catch((e) => vivant && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      vivant = false;
    };
  }, [caisse.client]);
  if (config.imprimanteSerie || (!choisi && !relais?.length)) return null;

  const liste = relais ?? [];
  const choisir = (r: RelaisImpression | null) =>
    void majConfig(
      r ? { ...config, imprimanteRelais: { relaisId: r.id, nom: r.nom } } : (({ imprimanteRelais: _, ...reste }) => reste)(config),
    );
  return (
    <fieldset>
      <legend>Imprimer sur une dalle</legend>
      <p className="aide-champ">
        Les tickets, notes et clôtures de cet {NOM_APPAREIL} sortent sur l'imprimante d'une dalle de l'établissement, qui les imprime pour lui. Il
        faut Internet, et la caisse ouverte sur la dalle. Les bons de production ne changent pas.
      </p>
      <div className="options" role="radiogroup" aria-label="Dalle des tickets">
        {liste.map((r) => (
          <button key={r.id} role="radio" aria-checked={choisi?.relaisId === r.id} className={`bouton${choisi?.relaisId === r.id ? " actif" : ""}`} onClick={() => choisir(r)}>
            {r.nom}
            <small> · {r.enLigne ? "en ligne" : "ne répond pas"}</small>
          </button>
        ))}
        {choisi && !liste.some((r) => r.id === choisi.relaisId) && (
          <button role="radio" aria-checked className="bouton actif">
            {choisi.nom}
            <small> · {relais ? "n'imprime plus pour les autres" : "hors ligne"}</small>
          </button>
        )}
        <button role="radio" aria-checked={!choisi} className={`bouton${!choisi ? " actif" : ""}`} onClick={() => choisir(null)}>
          Aucune
        </button>
      </div>
      {erreur && !relais && <p className="aide-champ">Liste des dalles indisponible : {erreur}</p>}
      {choisi && (
        <button className="bouton" onClick={() => void imprimer(gabaritTest(config), "Test")}>
          <AvecIcone icone={Printer}>Imprimer un essai sur la dalle</AvecIcone>
        </button>
      )}
    </fieldset>
  );
}
