import type { PostesProduction } from "@matalon/serveur/partage";
import { Printer, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { ADRESSE_IPV4 } from "../impression/epson";
import { AvecIcone, BoutonIcone } from "./icones";

/**
 * Imprimantes de production : à chaque poste nommé dans la carte (catégorie
 * › Poste de production), l'adresse de l'imprimante de l'établissement qui
 * reçoit ses bons. Un poste sans adresse se prépare d'après l'écran.
 * Partagé par la caisse (Réglages) et l'administration.
 */
export function EditeurPostes(props: {
  /** Postes nommés dans la carte de l'établissement. */
  postesCarte: string[];
  valeur: PostesProduction;
  onEnregistrer: (p: PostesProduction) => Promise<void>;
  /** Impression d'un bon d'essai (caisse seulement : l'administration n'est pas sur le réseau de l'établissement). */
  onTester?: (poste: string, adresse: string, sansAccents: boolean) => void;
}) {
  const [postes, setPostes] = useState(props.valeur);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  useEffect(() => setPostes(props.valeur), [props.valeur]);

  // Les postes de la carte, puis ceux réglés mais retirés de la carte depuis (à vider).
  const noms = [...props.postesCarte, ...Object.keys(postes).filter((n) => !props.postesCarte.includes(n))];
  const modifie = JSON.stringify(nettoyer(postes)) !== JSON.stringify(nettoyer(props.valeur));

  const enregistrer = async () => {
    const p = nettoyer(postes);
    const invalide = Object.entries(p).find(([, v]) => v.adresse && !ADRESSE_IPV4.test(v.adresse));
    if (invalide) return setErreur(`${invalide[0]} : adresse IP invalide (ex. 192.168.1.51).`);
    setErreur("");
    setEnvoi(true);
    try {
      await props.onEnregistrer(p);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvoi(false);
    }
  };

  if (noms.length === 0) {
    return (
      <p className="aide-champ">
        Aucun poste dans la carte. Dans l'éditeur de carte, indiquez pour chaque catégorie son poste de production (« Bar »,
        « Cuisine »), puis revenez ici lui associer une imprimante.
      </p>
    );
  }

  return (
    <div className="postes-production">
      <table className="tableau">
        <tbody>
          {noms.map((nom) => {
            const p = postes[nom] ?? { adresse: "", sansAccents: false };
            const maj = (v: Partial<typeof p>) => setPostes({ ...postes, [nom]: { ...p, ...v } });
            return (
              <tr key={nom}>
                <td>
                  <strong>{nom}</strong>
                  {!props.postesCarte.includes(nom) && <small className="aide-champ"> · n'est plus dans la carte</small>}
                </td>
                <td>
                  <input
                    aria-label={`Adresse IP de l'imprimante ${nom}`}
                    value={p.adresse}
                    placeholder="Sans imprimante"
                    inputMode="decimal"
                    onChange={(e) => maj({ adresse: e.target.value.trim() })}
                  />
                </td>
                <td>
                  <label className="case">
                    <input type="checkbox" checked={p.sansAccents} onChange={(e) => maj({ sansAccents: e.target.checked })} />
                    Sans accents
                  </label>
                </td>
                {props.onTester && (
                  <td className="nombre">
                    <BoutonIcone
                      icone={Printer}
                      variante="discret"
                      libelle={`Imprimer un bon d'essai sur ${nom}`}
                      disabled={!ADRESSE_IPV4.test(p.adresse)}
                      onClick={() => props.onTester!(nom, p.adresse, p.sansAccents)}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {erreur && <p className="erreur">{erreur}</p>}
      <button className="bouton" disabled={!modifie || envoi} onClick={() => void enregistrer()}>
        <AvecIcone icone={Save}>{envoi ? "Enregistrement…" : "Enregistrer les imprimantes"}</AvecIcone>
      </button>
    </div>
  );
}

/** Seuls les postes reliés à une imprimante sont gardés ; les autres se préparent d'après l'écran. */
function nettoyer(p: PostesProduction): PostesProduction {
  return Object.fromEntries(
    Object.entries(p)
      .filter(([, v]) => v.adresse.trim())
      .map(([k, v]) => [k, { adresse: v.adresse.trim(), sansAccents: v.sansAccents }])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
}
