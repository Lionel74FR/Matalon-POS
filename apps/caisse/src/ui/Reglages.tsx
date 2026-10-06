import { VERSION_NOYAU_FISCAL } from "@matalon/noyau-fiscal";
import { useEffect, useState } from "react";
import {
  genererTables,
  hacherPin,
  identifiantAleatoire,
  type Configuration,
  type Etablissement,
  type Role,
  type Utilisateur,
} from "../donnees/configuration";
import { ErreurApi } from "../serveur/client";
import { VERSION_APPLICATION } from "../fiscal/caisse";
import { gabaritTest } from "../impression/gabarits";
import { euros, useCaisse } from "./contexte";

const CHAMPS: Array<[keyof Etablissement, string]> = [
  ["enseigne", "Enseigne"],
  ["raisonSociale", "Raison sociale"],
  ["adresse", "Adresse"],
  ["codePostalVille", "Code postal et ville"],
  ["telephone", "Téléphone"],
  ["siret", "SIRET"],
  ["tvaIntracom", "N° de TVA intracommunautaire"],
];

/** Message lisible pour une modification refusée ou impossible hors ligne. */
function messageServeur(e: unknown): string {
  if (e instanceof ErreurApi && e.code === "HORS_LIGNE") {
    return "Connexion Internet nécessaire : l'établissement et l'équipe sont partagés par toutes les caisses du groupe.";
  }
  return e instanceof Error ? e.message : String(e);
}

export function Reglages(props: { onAssistant: () => void }) {
  const { caisse, config, majConfig, notifier, imprimer, synchro, synchroniser } = useCaisse();
  const [envoi, setEnvoi] = useState(false);
  const [etablissement, setEtablissement] = useState(config.etablissement);
  const [imprimante, setImprimante] = useState(config.imprimante);
  const [seuil, setSeuil] = useState(config.seuilNoteAutomatique / 100);
  const [salle, setSalle] = useState(config.tables.filter((t) => t.zone === "Salle").length);
  const [terrasse, setTerrasse] = useState(config.tables.filter((t) => t.zone === "Terrasse").length);
  const [nouveau, setNouveau] = useState<{ nom: string; role: Role; pin: string }>({ nom: "", role: "serveur", pin: "" });
  const [persistant, setPersistant] = useState<boolean | null>(null);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersistant);
  }, []);

  const enregistrer = async () => {
    const tables = [...genererTables(salle, terrasse), ...config.tables.filter((t) => t.zone !== "Salle" && t.zone !== "Terrasse")];
    const seuilNote = Math.round(seuil * 100);
    let suivante: Configuration = { ...config, imprimante: { ...imprimante, adresse: imprimante.adresse.trim() } };
    const partageModifie =
      JSON.stringify([etablissement, tables, seuilNote]) !== JSON.stringify([config.etablissement, config.tables, config.seuilNoteAutomatique]);
    setEnvoi(true);
    try {
      if (partageModifie) {
        const { etablissement: e } = await caisse.client.enregistrerEtablissement({
          identite: { ...etablissement, siret: etablissement.siret.replace(/\s/g, "") },
          tables,
          seuilNote,
        });
        suivante = { ...suivante, etablissement: e.identite, tables: e.tables, seuilNoteAutomatique: e.seuilNote, carteId: e.carteId };
        setEtablissement(e.identite);
      }
      await majConfig(suivante);
      notifier(partageModifie ? "Réglages enregistrés et partagés avec les autres caisses." : "Réglages de cet iPad enregistrés.");
    } catch (e) {
      notifier(messageServeur(e), "erreur");
    } finally {
      setEnvoi(false);
    }
  };

  /** L'équipe est commune à l'établissement : la modification passe d'abord par le serveur. */
  const enregistrerMembre = async (u: Utilisateur, message: string) => {
    try {
      const { utilisateurs } = await caisse.client.enregistrerEquipe([u]);
      await majConfig({ ...config, utilisateurs });
      notifier(message);
      return true;
    } catch (e) {
      notifier(messageServeur(e), "erreur");
      return false;
    }
  };

  const ajouterUtilisateur = async () => {
    if (!nouveau.nom.trim() || !/^\d{4}$/.test(nouveau.pin)) {
      return notifier("Indiquez un prénom et un code PIN de 4 chiffres.", "erreur");
    }
    const id = identifiantAleatoire("u");
    const u: Utilisateur = { id, nom: nouveau.nom.trim(), role: nouveau.role, pinHash: await hacherPin(id, nouveau.pin), actif: true };
    if (await enregistrerMembre(u, `${u.nom} peut maintenant se connecter sur toutes les caisses.`)) {
      setNouveau({ nom: "", role: "serveur", pin: "" });
    }
  };

  const basculerActif = async (u: Utilisateur) => {
    const responsablesActifs = config.utilisateurs.filter((x) => x.role === "responsable" && x.actif);
    if (u.actif && u.role === "responsable" && responsablesActifs.length === 1) {
      return notifier("Il faut au moins un responsable actif.", "erreur");
    }
    await enregistrerMembre({ ...u, actif: !u.actif }, u.actif ? `${u.nom} est désactivé.` : `${u.nom} est réactivé.`);
  };

  const changerPin = async (u: Utilisateur) => {
    const pin = window.prompt(`Nouveau code PIN à 4 chiffres pour ${u.nom}`);
    if (pin == null) return;
    if (!/^\d{4}$/.test(pin)) return notifier("Le code PIN compte 4 chiffres.", "erreur");
    await enregistrerMembre({ ...u, pinHash: await hacherPin(u.id, pin) }, `Code PIN de ${u.nom} modifié.`);
  };

  return (
    <div className="page reglages">
      <header className="page-tete">
        <h1>Réglages</h1>
        <button className="bouton principal" disabled={envoi} onClick={() => void enregistrer()}>
          {envoi ? "Enregistrement…" : "Enregistrer les réglages"}
        </button>
      </header>

      <div className="formulaire-colonnes">
        <fieldset>
          <legend>Établissement (en-tête des notes)</legend>
          <p className="aide-champ">Commun à toutes les caisses de l'établissement. La modification demande une connexion Internet.</p>
          {CHAMPS.map(([cle, libelle]) => (
            <label key={cle} className="champ">
              <span>{libelle}</span>
              <input value={etablissement[cle]} onChange={(e) => setEtablissement({ ...etablissement, [cle]: e.target.value })} />
            </label>
          ))}
        </fieldset>

        <div>
          <fieldset>
            <legend>Imprimante Epson</legend>
            <button className="bouton principal" onClick={props.onAssistant}>
              Assistant de connexion
            </button>
            <label className="champ">
              <span>
                Adresse IP
                <small>Imprimez la page d'état (bouton Feed au démarrage) pour la trouver</small>
              </span>
              <input
                value={imprimante.adresse}
                placeholder="192.168.1.50"
                inputMode="decimal"
                onChange={(e) => setImprimante({ ...imprimante, adresse: e.target.value })}
              />
            </label>
            <label className="case">
              <input type="checkbox" checked={imprimante.sansAccents} onChange={(e) => setImprimante({ ...imprimante, sansAccents: e.target.checked })} />
              Imprimer sans accents (si l'impression les déforme)
            </label>
            <button
              className="bouton"
              onClick={() =>
                void imprimer(gabaritTest({ ...config, etablissement, imprimante: { ...imprimante, adresse: imprimante.adresse.trim() } }), "Test")
              }
            >
              Imprimer un test
            </button>
            <label className="champ">
              <span>
                Note imprimée d'office à partir de
                <small>En dessous, la note est imprimée à la demande du client</small>
              </span>
              <input type="number" min={0} step={1} value={seuil} onChange={(e) => setSeuil(Number(e.target.value))} />
            </label>
          </fieldset>

          <fieldset>
            <legend>Salle</legend>
            <label className="champ">
              <span>Tables en salle</span>
              <input type="number" min={0} max={60} value={salle} onChange={(e) => setSalle(Number(e.target.value))} />
            </label>
            <label className="champ">
              <span>Tables en terrasse</span>
              <input type="number" min={0} max={60} value={terrasse} onChange={(e) => setTerrasse(Number(e.target.value))} />
            </label>
          </fieldset>
        </div>
      </div>

      <fieldset>
        <legend>Équipe</legend>
        <table className="tableau">
          <tbody>
            {config.utilisateurs.map((u) => (
              <tr key={u.id} className={u.actif ? "" : "annule"}>
                <td>{u.nom}</td>
                <td>{u.role === "responsable" ? "Responsable" : "Serveur"}</td>
                <td className="nombre">
                  <button className="bouton discret" onClick={() => void changerPin(u)}>
                    Changer le code
                  </button>
                  <button className="bouton discret" onClick={() => void basculerActif(u)}>
                    {u.actif ? "Désactiver" : "Réactiver"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ajout-utilisateur">
          <input placeholder="Prénom" value={nouveau.nom} onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} />
          <select value={nouveau.role} onChange={(e) => setNouveau({ ...nouveau, role: e.target.value as Role })}>
            <option value="serveur">Serveur</option>
            <option value="responsable">Responsable</option>
          </select>
          <input
            placeholder="Code PIN"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={nouveau.pin}
            onChange={(e) => setNouveau({ ...nouveau, pin: e.target.value.replace(/\D/g, "") })}
          />
          <button className="bouton" onClick={() => void ajouterUtilisateur()}>
            Ajouter à l'équipe
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Cette caisse</legend>
        <dl className="totaux">
          <div>
            <dt>Caisse</dt>
            <dd>
              {config.caisseNom} · {config.caisseId}
            </dd>
          </div>
          <div>
            <dt>Établissement</dt>
            <dd>
              {config.etablissementId} · carte {config.carteId}
            </dd>
          </div>
          <div>
            <dt>Synchronisation</dt>
            <dd className={["divergence", "revoquee", "erreur"].includes(synchro.statut) ? "erreur" : ""}>
              {synchro.statut === "synchronise"
                ? "À jour"
                : synchro.statut === "hors_ligne"
                  ? "Hors ligne"
                  : synchro.statut === "en_attente"
                    ? "En attente"
                    : synchro.message}
              {synchro.enAttente > 0 && ` · ${synchro.enAttente} à envoyer`}
              {synchro.derniereSynchro && ` · dernière le ${new Date(synchro.derniereSynchro).toLocaleString("fr-FR")}`}{" "}
              <button className="bouton discret" onClick={() => void synchroniser()}>
                Synchroniser
              </button>
            </dd>
          </div>
          <div>
            <dt>Mise en service</dt>
            <dd>{new Date(config.installeeLe).toLocaleDateString("fr-FR")}</dd>
          </div>
          <div>
            <dt>Empreinte de la clé</dt>
            <dd>
              <code>{caisse.cle.empreinte.slice(0, 32)}</code>
            </dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>
              Noyau fiscal {VERSION_NOYAU_FISCAL} · application {VERSION_APPLICATION}
            </dd>
          </div>
          <div>
            <dt>Stockage protégé</dt>
            <dd className={persistant ? "" : "erreur"}>
              {persistant == null
                ? "Inconnu"
                : persistant
                  ? "Oui, l'iPad ne purgera pas les données"
                  : "Non : installez la caisse sur l'écran d'accueil (Partager › Sur l'écran d'accueil)"}
            </dd>
          </div>
          <div>
            <dt>Seuil de note</dt>
            <dd>{euros(config.seuilNoteAutomatique)}</dd>
          </div>
        </dl>
      </fieldset>
    </div>
  );
}
