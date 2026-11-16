import { adresseLocale, type RelaisImpression } from "@matalon/serveur/partage";
import { Download, Printer, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { NOM_APPAREIL } from "../donnees/appareil";
import { gabaritTest } from "../impression/gabarits";
import { etatScriptReseau, URL_SCRIPT_RESEAU } from "../impression/reseau";
import { serieDisponible } from "../impression/serie";
import { useCaisse } from "./contexte";
import { AvecIcone } from "./icones";

/**
 * Imprimante des additions (16 novembre 2026, backlog n° 5) : une imprimante réseau ESC/POS (l'Oxhoo de
 * la salle du Chardon, 192.168.1.248) jointe par le script d'une dalle, soit sur cette dalle, soit par une
 * dalle relais pour un iPad ou un iPhone. Affiché sur une dalle (Chrome avec port série), ou s'il existe une
 * dalle relais : rien ne change au Moka.
 */
export function ImprimanteAdditions() {
  const { caisse, config, majConfig, imprimer } = useCaisse();
  const a = config.imprimanteAdditions;
  const ici = serieDisponible();
  const [relais, setRelais] = useState<RelaisImpression[] | null>(null);
  const [adresse, setAdresse] = useState(a?.adresse ?? "");
  const [script, setScript] = useState<{ texte: string; erreur?: boolean } | null>(null);
  useEffect(() => {
    let vivant = true;
    caisse.client
      .relais()
      .then((r) => vivant && setRelais(r.relais.filter((x) => x.id !== config.caisseId)))
      .catch(() => vivant && setRelais([]));
    return () => {
      vivant = false;
    };
  }, [caisse.client, config.caisseId]);
  if (!ici && !a && !relais?.length) return null;

  const valide = adresseLocale(adresse.trim());
  const choisir = (par: { relaisId: string; relaisNom: string } | "ici" | null) => {
    if (!par) {
      const { imprimanteAdditions: _, ...reste } = config;
      return void majConfig(reste);
    }
    void majConfig({
      ...config,
      imprimanteAdditions: { adresse: adresse.trim(), sansAccents: a?.sansAccents ?? false, ...(par === "ici" ? {} : par) },
    });
  };
  const verifier = async () => {
    setScript({ texte: "Vérification…" });
    const v = await etatScriptReseau();
    setScript(
      v === null
        ? { texte: "Le script ne répond pas sur cette dalle : installez-le, ou autorisez Chrome à accéder au réseau local.", erreur: true }
        : { texte: `Script lancé sur cette dalle (version ${v}).` },
    );
  };
  const actuel = !a ? "aucune" : a.relaisId ?? "ici";
  return (
    <fieldset>
      <legend>Imprimante des additions</legend>
      <p className="aide-champ">
        Les additions de cet {NOM_APPAREIL} sortent sur une imprimante réseau (Oxhoo de la salle), envoyées par le script d'une dalle. Les tickets,
        notes et bons ne changent pas.
      </p>
      <label className="champ">
        <span>
          Adresse IP de l'imprimante
          <small>Réseau local, port 9100</small>
        </span>
        <input
          value={adresse}
          placeholder="192.168.1.248"
          inputMode="decimal"
          onChange={(e) => setAdresse(e.target.value)}
          onBlur={() => a && valide && adresse.trim() !== a.adresse && void majConfig({ ...config, imprimanteAdditions: { ...a, adresse: adresse.trim() } })}
        />
      </label>
      <div className="options" role="radiogroup" aria-label="Envoyées par">
        {ici && (
          <button role="radio" aria-checked={actuel === "ici"} disabled={!valide} className={`bouton${actuel === "ici" ? " actif" : ""}`} onClick={() => choisir("ici")}>
            Cette dalle (script installé)
          </button>
        )}
        {(relais ?? []).map((r) => (
          <button
            key={r.id}
            role="radio"
            aria-checked={actuel === r.id}
            disabled={!valide}
            className={`bouton${actuel === r.id ? " actif" : ""}`}
            onClick={() => choisir({ relaisId: r.id, relaisNom: r.nom })}
          >
            Par {r.nom}
            <small> · {r.enLigne ? "en ligne" : "ne répond pas"}</small>
          </button>
        ))}
        {a?.relaisId && !(relais ?? []).some((r) => r.id === a.relaisId) && (
          <button role="radio" aria-checked className="bouton actif">
            Par {a.relaisNom ?? "une dalle"}
            <small> · {relais ? "n'imprime plus pour les autres" : "hors ligne"}</small>
          </button>
        )}
        <button role="radio" aria-checked={actuel === "aucune"} className={`bouton${actuel === "aucune" ? " actif" : ""}`} onClick={() => choisir(null)}>
          Aucune : comme les tickets
        </button>
      </div>
      {!valide && adresse.trim() !== "" && <p className="aide-champ">Adresse du réseau local attendue (192.168.x.x, 10.x.x.x ou 172.16 à 31.x.x).</p>}
      {ici && (
        <>
          <p className="aide-champ">
            Sur la dalle qui envoie les additions (la vôtre ou celle d'un iPad), une fois : téléchargez le script, puis clic droit › « Exécuter
            avec PowerShell ». Il se relance à chaque ouverture de session. Chrome demande ensuite d'autoriser l'accès au réseau local : acceptez.
          </p>
          <div className="options">
            <a className="bouton" href={URL_SCRIPT_RESEAU} download>
              <AvecIcone icone={Download}>Télécharger le script</AvecIcone>
            </a>
            <button className="bouton" onClick={() => void verifier()}>
              <AvecIcone icone={RefreshCw}>Vérifier le script</AvecIcone>
            </button>
          </div>
          {script && <p className={script.erreur ? "erreur" : "succes"} role="status">{script.texte}</p>}
        </>
      )}
      {a && (
        <>
          <label className="case">
            <input type="checkbox" checked={a.sansAccents} onChange={(e) => void majConfig({ ...config, imprimanteAdditions: { ...a, sansAccents: e.target.checked } })} />
            Imprimer sans accents (si l'euro ou les accents sortent mal)
          </label>
          <button className="bouton" onClick={() => void imprimer(gabaritTest(config), "Addition d'essai", { addition: true })}>
            <AvecIcone icone={Printer}>Imprimer une addition d'essai</AvecIcone>
          </button>
        </>
      )}
    </fieldset>
  );
}
