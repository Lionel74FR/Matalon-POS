import { erreurImprimantes, nouvelIdImprimante, type BranchementImprimante, type ImprimanteEtablissement } from "@matalon/serveur/partage";
import { Plus, Printer, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { URL_SCRIPT_RESEAU } from "../impression/reseau";
import { AvecIcone, BoutonIcone } from "./icones";

/**
 * Imprimantes de l'établissement (16 novembre 2026, demande de Lionel) : la liste réglée une fois,
 * puis les postes de production de la carte qui y choisissent leur imprimante. Chaque appareil choisit
 * ensuite dans ses Réglages celle de ses tickets et celle de ses additions. Commun à l'administration
 * et aux Réglages de la caisse.
 */
export function EditeurImprimantes(props: {
  imprimantes: ImprimanteEtablissement[];
  postes: Record<string, string>;
  /** Postes nommés dans la carte de l'établissement. */
  postesCarte: string[];
  /** Appareils de l'établissement (identifiant → nom) : les dalles qui peuvent porter une imprimante. */
  appareils: Record<string, string>;
  onEnregistrer: (imprimantes: ImprimanteEtablissement[], postes: Record<string, string>) => Promise<void>;
  /** Bon d'essai (caisse seulement : l'administration n'est pas sur le réseau de l'établissement). */
  onTester?: (imprimante: ImprimanteEtablissement) => void;
}) {
  const [liste, setListe] = useState(props.imprimantes);
  const [postes, setPostes] = useState(props.postes);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const [fait, setFait] = useState("");
  useEffect(() => setListe(props.imprimantes), [props.imprimantes]);
  useEffect(() => setPostes(props.postes), [props.postes]);

  const noms = [...props.postesCarte, ...Object.keys(postes).filter((n) => !props.postesCarte.includes(n))];
  const propres = (p: Record<string, string>) => Object.fromEntries(Object.entries(p).filter(([, id]) => id).sort(([a], [b]) => a.localeCompare(b)));
  const modifie = JSON.stringify([liste, propres(postes)]) !== JSON.stringify([props.imprimantes, propres(props.postes)]);
  const dalles = Object.entries(props.appareils);

  const maj = (id: string, v: Partial<ImprimanteEtablissement>) => {
    setFait("");
    setListe(liste.map((i) => (i.id === id ? { ...i, ...v } : i)));
  };
  const changerType = (i: ImprimanteEtablissement, type: BranchementImprimante["type"]) => {
    const adresse = "adresse" in i.branchement ? i.branchement.adresse : "";
    const dalleId = "dalleId" in i.branchement ? i.branchement.dalleId : (dalles[0]?.[0] ?? "");
    maj(i.id, { branchement: type === "epson" ? { type, adresse } : type === "serie" ? { type, dalleId } : { type, adresse, dalleId } });
  };
  const ajouter = () => {
    setFait("");
    let nom = "Imprimante";
    for (let k = 2; liste.some((i) => i.nom.toLowerCase() === nom.toLowerCase()); k++) nom = `Imprimante ${k}`;
    setListe([...liste, { id: nouvelIdImprimante(), nom, branchement: { type: "epson", adresse: "" }, sansAccents: false }]);
  };
  const retirer = (i: ImprimanteEtablissement) => {
    setFait("");
    setListe(liste.filter((x) => x.id !== i.id));
    setPostes(Object.fromEntries(Object.entries(postes).filter(([, id]) => id !== i.id)));
  };
  const enregistrer = async () => {
    const nettes = liste.map((i) => ({
      ...i,
      nom: i.nom.trim(),
      branchement: "adresse" in i.branchement ? { ...i.branchement, adresse: i.branchement.adresse.trim() } : i.branchement,
    })) as ImprimanteEtablissement[];
    const p = propres(postes);
    const e = erreurImprimantes(nettes, p, new Set(Object.keys(props.appareils)));
    if (e) return setErreur(e);
    setErreur("");
    setEnvoi(true);
    try {
      await props.onEnregistrer(nettes, p);
      setFait("Imprimantes enregistrées pour tout l'établissement.");
    } catch (x) {
      setErreur(x instanceof Error ? x.message : String(x));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="imprimantes-etablissement">
      {liste.length === 0 ? (
        <p className="aide-champ">Aucune imprimante. Ajoutez celles de l'établissement : Epson réseau, imprimante série d'une dalle, imprimante réseau envoyée par une dalle.</p>
      ) : (
        <table className="tableau">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Branchement</th>
              <th>Adresse ou dalle</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {liste.map((i) => {
              const b = i.branchement;
              return (
                <tr key={i.id}>
                  <td>
                    <input aria-label={`Nom de l'imprimante ${i.nom}`} value={i.nom} onChange={(e) => maj(i.id, { nom: e.target.value })} />
                  </td>
                  <td>
                    <select aria-label={`Branchement de ${i.nom}`} value={b.type} onChange={(e) => changerType(i, e.target.value as BranchementImprimante["type"])}>
                      <option value="epson">Epson réseau</option>
                      <option value="serie">Série sur une dalle</option>
                      <option value="reseau">Réseau par une dalle (script)</option>
                    </select>
                  </td>
                  <td className="imprimante-lieu">
                    {b.type !== "serie" && (
                      <input
                        aria-label={`Adresse IP de ${i.nom}`}
                        value={b.adresse}
                        placeholder={b.type === "epson" ? "192.168.1.50" : "192.168.1.248"}
                        inputMode="decimal"
                        onChange={(e) => maj(i.id, { branchement: { ...b, adresse: e.target.value } })}
                      />
                    )}
                    {b.type === "reseau" && (
                      <a className="lien-script" href={URL_SCRIPT_RESEAU} download title="Script à lancer sur la dalle (clic droit › Exécuter avec PowerShell)">
                        Script de la dalle
                      </a>
                    )}
                    {b.type !== "epson" && (
                      <select aria-label={`Dalle de ${i.nom}`} value={b.dalleId} onChange={(e) => maj(i.id, { branchement: { ...b, dalleId: e.target.value } })}>
                        {!props.appareils[b.dalleId] && <option value={b.dalleId}>Choisir la dalle…</option>}
                        {dalles.map(([id, nom]) => (
                          <option key={id} value={id}>
                            {nom}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="imprimante-actions">
                    <label className="case">
                      <input type="checkbox" checked={i.sansAccents} onChange={(e) => maj(i.id, { sansAccents: e.target.checked })} />
                      Sans accents
                    </label>
                    {props.onTester && (
                      <BoutonIcone
                        icone={Printer}
                        variante="discret"
                        libelle={`Imprimer un essai sur ${i.nom}`}
                        disabled={modifie}
                        onClick={() => props.onTester!(i)}
                      />
                    )}
                    <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer ${i.nom}`} onClick={() => retirer(i)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <button className="bouton" onClick={ajouter}>
        <AvecIcone icone={Plus}>Ajouter une imprimante</AvecIcone>
      </button>

      <h3 className="sous-titre-reglages">Postes de production</h3>
      {noms.length === 0 ? (
        <p className="aide-champ">
          Aucun poste dans la carte. Dans l'éditeur de carte, indiquez pour chaque catégorie son poste de production (« Bar », « Cuisine »), puis
          revenez ici lui choisir une imprimante.
        </p>
      ) : (
        <table className="tableau postes-production">
          <tbody>
            {noms.map((nom) => (
              <tr key={nom}>
                <td>
                  <strong>{nom}</strong>
                  {!props.postesCarte.includes(nom) && <small className="aide-champ"> · n'est plus dans la carte</small>}
                </td>
                <td>
                  <select
                    aria-label={`Imprimante du poste ${nom}`}
                    value={postes[nom] ?? ""}
                    onChange={(e) => {
                      setFait("");
                      setPostes({ ...postes, [nom]: e.target.value });
                    }}
                  >
                    <option value="">Sans imprimante (préparé d'après l'écran)</option>
                    {liste.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nom}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {erreur && <p className="erreur">{erreur}</p>}
      {fait && <p className="succes">{fait}</p>}
      <button className="bouton principal" disabled={!modifie || envoi} onClick={() => void enregistrer()}>
        <AvecIcone icone={Save}>{envoi ? "Enregistrement…" : "Enregistrer les imprimantes"}</AvecIcone>
      </button>
    </div>
  );
}
