import { VERSION_NOYAU_FISCAL } from "@matalon/noyau-fiscal";
import { useEffect, useState } from "react";
import {
  genererTables,
  hacherPin,
  identifiantAleatoire,
  type Etablissement,
  type Role,
  type Utilisateur,
} from "../donnees/configuration";
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

export function Reglages(props: { onAssistant: () => void }) {
  const { caisse, config, majConfig, notifier, imprimer } = useCaisse();
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
    await majConfig({
      ...config,
      etablissement,
      imprimante: { ...imprimante, adresse: imprimante.adresse.trim() },
      seuilNoteAutomatique: Math.round(seuil * 100),
      tables: genererTables(salle, terrasse),
    });
    notifier("Réglages enregistrés.");
  };

  const ajouterUtilisateur = async () => {
    if (!nouveau.nom.trim() || !/^\d{4}$/.test(nouveau.pin)) {
      return notifier("Indiquez un prénom et un code PIN de 4 chiffres.", "erreur");
    }
    const id = identifiantAleatoire("u");
    const u: Utilisateur = { id, nom: nouveau.nom.trim(), role: nouveau.role, pinHash: await hacherPin(id, nouveau.pin), actif: true };
    await majConfig({ ...config, utilisateurs: [...config.utilisateurs, u] });
    setNouveau({ nom: "", role: "serveur", pin: "" });
    notifier(`${u.nom} peut maintenant se connecter.`);
  };

  const basculerActif = async (u: Utilisateur) => {
    const responsablesActifs = config.utilisateurs.filter((x) => x.role === "responsable" && x.actif);
    if (u.actif && u.role === "responsable" && responsablesActifs.length === 1) {
      return notifier("Il faut au moins un responsable actif.", "erreur");
    }
    await majConfig({ ...config, utilisateurs: config.utilisateurs.map((x) => (x.id === u.id ? { ...x, actif: !x.actif } : x)) });
  };

  const changerPin = async (u: Utilisateur) => {
    const pin = window.prompt(`Nouveau code PIN à 4 chiffres pour ${u.nom}`);
    if (pin == null) return;
    if (!/^\d{4}$/.test(pin)) return notifier("Le code PIN compte 4 chiffres.", "erreur");
    const pinHash = await hacherPin(u.id, pin);
    await majConfig({ ...config, utilisateurs: config.utilisateurs.map((x) => (x.id === u.id ? { ...x, pinHash } : x)) });
    notifier(`Code PIN de ${u.nom} modifié.`);
  };

  return (
    <div className="page reglages">
      <header className="page-tete">
        <h1>Réglages</h1>
        <button className="bouton principal" onClick={() => void enregistrer()}>
          Enregistrer les réglages
        </button>
      </header>

      <div className="formulaire-colonnes">
        <fieldset>
          <legend>Établissement (en-tête des notes)</legend>
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
            <dt>Identifiant</dt>
            <dd>{config.caisseId}</dd>
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
