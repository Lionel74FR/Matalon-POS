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
  /** Ordinateurs (dalles) de l'établissement, identifiant → nom : seuls à pouvoir porter une imprimante. */
  appareils: Record<string, string>;
  /** Noms de tous les appareils (pour nommer une dalle qui ne peut plus porter d'imprimante). */
  nomsAppareils?: Record<string, string>;
  onEnregistrer: (imprimantes: ImprimanteEtablissement[], postes: Record<string, string>) => Promise<void>;
  /** Bon d'essai (caisse seulement : l'administration n'est pas sur le réseau de l'établissement). */
  onTester?: (imprimante: ImprimanteEtablissement) => void;
  /** Caisse : lien pour accepter le certificat d'une Epson sur cet appareil. */
  autoriserEpson?: boolean;
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
    // L'Epson coupe toujours en entier : la coupe partielle ne vaut que pour les imprimantes ESC/POS.
    maj(i.id, {
      branchement: type === "epson" ? { type, adresse } : type === "serie" ? { type, dalleId } : { type, adresse, dalleId },
      ...(type === "epson" ? { coupe: undefined } : {}),
    });
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
    const nettes = liste.map(({ coupe, ...i }) => ({
      ...i,
      ...(coupe === "partielle" && i.branchement.type !== "epson" ? { coupe } : {}),
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
        <div className="liste-imprimantes" role="table" aria-label="Imprimantes de l'établissement">
          <div className="imprimante-ligne entete" role="row">
            <span role="columnheader">Nom</span>
            <span role="columnheader">Branchement</span>
            <span role="columnheader">Adresse IP</span>
            <span role="columnheader">Dalle qui la porte</span>
            <span role="columnheader">Accents</span>
            <span role="columnheader">Coupe</span>
            <span role="columnheader" />
          </div>
          {liste.map((i) => {
            const b = i.branchement;
            const dalleInvalide = b.type !== "epson" && !props.appareils[b.dalleId];
            return (
              <div key={i.id} className="imprimante-ligne" role="row">
                <input aria-label={`Nom de l'imprimante ${i.nom}`} value={i.nom} onChange={(e) => maj(i.id, { nom: e.target.value })} />
                <select aria-label={`Branchement de ${i.nom}`} value={b.type} onChange={(e) => changerType(i, e.target.value as BranchementImprimante["type"])}>
                  <option value="epson">Epson réseau</option>
                  <option value="serie">Série sur une dalle</option>
                  <option value="reseau">Réseau par une dalle (script)</option>
                </select>
                {b.type === "serie" ? (
                  <span className="sans-objet">port COM de la dalle</span>
                ) : (
                  <input
                    aria-label={`Adresse IP de ${i.nom}`}
                    value={b.adresse}
                    placeholder={b.type === "epson" ? "192.168.1.50" : "192.168.1.248"}
                    inputMode="decimal"
                    onChange={(e) => maj(i.id, { branchement: { ...b, adresse: e.target.value } })}
                  />
                )}
                {b.type === "epson" ? (
                  <span className="sans-objet">en direct</span>
                ) : (
                  <select
                    aria-label={`Dalle de ${i.nom}`}
                    aria-invalid={dalleInvalide}
                    value={b.dalleId}
                    onChange={(e) => maj(i.id, { branchement: { ...b, dalleId: e.target.value } })}
                  >
                    {dalleInvalide && (
                      <option value={b.dalleId}>
                        {props.nomsAppareils?.[b.dalleId] ? `${props.nomsAppareils[b.dalleId]} : pas une dalle, à changer` : "Choisir la dalle…"}
                      </option>
                    )}
                    {dalles.map(([id, nom]) => (
                      <option key={id} value={id}>
                        {nom}
                      </option>
                    ))}
                  </select>
                )}
                <label className="case">
                  <input type="checkbox" checked={!i.sansAccents} onChange={(e) => maj(i.id, { sansAccents: !e.target.checked })} />
                  <span>Avec accents</span>
                </label>
                {b.type === "epson" ? (
                  <span className="sans-objet">totale</span>
                ) : (
                  <select
                    aria-label={`Coupe de ${i.nom}`}
                    value={i.coupe ?? "totale"}
                    onChange={(e) => {
                      const { coupe: _, ...sans } = i;
                      maj(i.id, e.target.value === "partielle" ? { coupe: "partielle" } : { ...sans, coupe: undefined });
                    }}
                  >
                    <option value="totale">Totale</option>
                    <option value="partielle">Partielle (ticket accroché)</option>
                  </select>
                )}
                <span className="imprimante-actions">
                  {props.onTester && (
                    <BoutonIcone icone={Printer} variante="discret" libelle={`Imprimer un essai sur ${i.nom}`} disabled={modifie} onClick={() => props.onTester!(i)} />
                  )}
                  <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer ${i.nom}`} onClick={() => retirer(i)} />
                </span>
                {dalleInvalide && (
                  <p className="erreur imprimante-note">
                    Seul un ordinateur (dalle, caisse ouverte dans Chrome) peut porter « {i.nom} » : un iPad ou un iPhone n'a ni port COM ni script.
                  </p>
                )}
                {b.type === "epson" && props.autoriserEpson && b.adresse.trim() && (
                  <p className="aide-champ imprimante-note">
                    Sur chaque iPad ou iPhone qui l'utilise, une fois :{" "}
                    <a href={`https://${b.adresse.trim()}/`} target="_blank" rel="noreferrer">
                      autoriser la connexion
                    </a>{" "}
                    (Safari : « Afficher les détails », puis « consulter ce site web »). État : rubrique Cet appareil.
                  </p>
                )}
                {b.type === "reseau" && !dalleInvalide && (
                  <p className="aide-champ imprimante-note">
                    Le script doit tourner sur {props.appareils[b.dalleId]} :{" "}
                    <a href={URL_SCRIPT_RESEAU} download>
                      télécharger le script
                    </a>
                    , puis clic droit › « Exécuter avec PowerShell » sur la dalle.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <button className="bouton" onClick={ajouter}>
        <AvecIcone icone={Plus}>Ajouter une imprimante</AvecIcone>
      </button>

      <h3 className="sous-titre-reglages">Postes de production</h3>
      <p className="aide-champ">« Envoyer » sur une commande imprime les nouveaux articles au poste de leur catégorie ; le reste part à l'encaissement.</p>
      {noms.length === 0 ? (
        <p className="aide-champ">
          Aucun poste dans la carte. Dans l'éditeur de carte, indiquez pour chaque catégorie son poste de production (« Bar », « Cuisine »), puis
          revenez ici lui choisir une imprimante.
        </p>
      ) : (
        <div className="postes-production">
            {noms.map((nom) => (
              <label key={nom} className="champ">
                <span>
                  {nom}
                  {!props.postesCarte.includes(nom) && <small>n'est plus dans la carte</small>}
                </span>
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
              </label>
            ))}
        </div>
      )}
      {erreur && <p className="erreur">{erreur}</p>}
      {fait && <p className="succes">{fait}</p>}
      <button className="bouton principal" disabled={!modifie || envoi} onClick={() => void enregistrer()}>
        <AvecIcone icone={Save}>{envoi ? "Enregistrement…" : "Enregistrer les imprimantes"}</AvecIcone>
      </button>
    </div>
  );
}
