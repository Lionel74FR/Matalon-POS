import { Building2, ChevronLeft, ChevronRight, KeyRound, Printer, RefreshCw, Save, Smartphone, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { serieDisponible } from "../impression/serie";
import { AvecIcone, BoutonIcone } from "./icones";
import { NOM_APPAREIL } from "../donnees/appareil";
import { VERSION_NOYAU_FISCAL } from "@matalon/noyau-fiscal";
import { postesDeLaCarte } from "@matalon/catalogue";
import type { ImprimanteEtablissement } from "@matalon/serveur/partage";
import { useEffect, useState } from "react";
import {
  carteDe,
  hacherPin,
  imprimantesRecues,
  identifiantAleatoire,
  type Configuration,
  type Etablissement,
  type Role,
  type Utilisateur,
} from "../donnees/configuration";
import { ErreurApi } from "../serveur/client";
import { VERSION_APPLICATION } from "../fiscal/caisse";
import { imprimerSur } from "../impression/imprimantes";
import { ConnexionEpson } from "./ConnexionEpson";
import { EditeurImprimantes } from "./EditeurImprimantes";
import { ImprimantesAppareil, ImprimantesPortees } from "./ImprimantesAppareil";
import { gabaritBon } from "../impression/gabarits";
import { nouvelleCommande } from "../metier/commande";
import { euros, useCaisse } from "./contexte";

const CHAMPS: Array<[keyof Etablissement, string]> = [
  ["enseigne", "Enseigne"],
  ["raisonSociale", "Raison sociale"],
  ["adresse", "Adresse"],
  ["codePostalVille", "Code postal et ville"],
  ["telephone", "Téléphone"],
  ["siret", "SIRET"],
  ["tvaIntracom", "N° de TVA intracommunautaire"],
  ["mentionsLegales", "Forme, capital, RCS (factures)"],
];

/** Message lisible pour une modification refusée ou impossible hors ligne. */
export function messageServeur(e: unknown): string {
  if (e instanceof ErreurApi && e.code === "HORS_LIGNE") {
    return "Connexion Internet nécessaire : l'établissement et l'équipe sont partagés par toutes les caisses du groupe.";
  }
  return e instanceof Error ? e.message : String(e);
}

type OngletReglages = "appareil" | "imprimantes" | "etablissement" | "equipe";
const CLE_ONGLET = "matalon-reglages-onglet";

export function Reglages(props: { onAssistant: () => void }) {
  // Onglets (16 novembre 2026, ergonomie revue avec Lionel) ; le dernier ouvert est gardé le temps de la session.
  const [onglet, setOnglet] = useState<OngletReglages>(() => {
    const o = sessionStorage.getItem(CLE_ONGLET);
    return o === "imprimantes" || o === "etablissement" || o === "equipe" ? o : "appareil";
  });
  const choisirOnglet = (o: OngletReglages) => {
    setOnglet(o);
    setMenu(false);
    sessionStorage.setItem(CLE_ONGLET, o);
  };
  // iPhone (écran étroit) : menu des réglages, puis la rubrique choisie avec un retour au menu.
  const etroit = useEcranEtroit();
  const [menu, setMenu] = useState(true);
  const { caisse, config, majConfig, notifier, imprimer, synchro, synchroniser, utilisateur, demanderPinResponsable } = useCaisse();
  const carte = carteDe(config);
  const [envoi, setEnvoi] = useState(false);
  const [etablissement, setEtablissement] = useState(config.etablissement);
  const [seuil, setSeuil] = useState(config.seuilNoteAutomatique / 100);
  const [noteAuto, setNoteAuto] = useState(config.noteAutomatique !== false);
  const [nouveau, setNouveau] = useState<{ nom: string; role: Role; pin: string }>({ nom: "", role: "serveur", pin: "" });
  const [persistant, setPersistant] = useState<boolean | null>(null);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersistant);
  }, []);

  const enregistrer = async () => {
    const seuilNote = Math.round(seuil * 100);
    let suivante: Configuration = config;
    const partageModifie =
      JSON.stringify([etablissement, seuilNote, noteAuto]) !== JSON.stringify([config.etablissement, config.seuilNoteAutomatique, config.noteAutomatique !== false]);
    setEnvoi(true);
    try {
      if (partageModifie) {
        const { etablissement: e } = await caisse.client.enregistrerEtablissement({
          identite: { ...etablissement, siret: etablissement.siret.replace(/\s/g, "") },
          seuilNote,
          noteAutomatique: noteAuto,
        });
        // La carte suit sa propre mise à jour (téléchargement à la synchronisation).
        suivante = { ...suivante, etablissement: e.identite, tables: e.tables, seuilNoteAutomatique: e.seuilNote, noteAutomatique: e.noteAutomatique !== false };
        setEtablissement(e.identite);
      }
      await majConfig(suivante);
      notifier(partageModifie ? "Réglages enregistrés et partagés avec les autres caisses." : `Réglages de cet ${NOM_APPAREIL} enregistrés.`);
    } catch (e) {
      notifier(messageServeur(e), "erreur");
    } finally {
      setEnvoi(false);
    }
  };

  /** L'équipe est commune à l'établissement : la modification passe d'abord par le serveur. */
  const enregistrerMembre = async (u: Utilisateur, message: string) => {
    // Le serveur vérifie lui-même le code d'un responsable : il est demandé à chaque modification.
    const responsable = await demanderPinResponsable(`Modification de l'équipe : ${u.nom}.`);
    if (!responsable) return false;
    try {
      const { utilisateurs } = await caisse.client.enregistrerEquipe([u], responsable);
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

  /** Les imprimantes sont communes à l'établissement : enregistrées d'abord sur le serveur. */
  const enregistrerImprimantes = async (imprimantes: ImprimanteEtablissement[], postes: Record<string, string>) => {
    try {
      const { etablissement: e } = await caisse.client.enregistrerImprimantes({ imprimantes, postes });
      await majConfig({ ...config, ...imprimantesRecues(config, e) });
    } catch (e) {
      throw new Error(messageServeur(e));
    }
  };

  const testerImprimante = async (i: ImprimanteEtablissement) => {
    const bon = { poste: i.nom, annulation: false, articles: [{ quantite: 1, libelle: "Bon d'essai", details: [i.nom], suite: 0 as const }], ligneUids: [] };
    try {
      await imprimerSur({
        config,
        client: caisse.client,
        imprimante: i,
        recu: gabaritBon(bon, nouvelleCommande("comptoir", utilisateur.id), config, utilisateur.id),
        titre: `Essai ${i.nom}`,
        surEchec: (e) => notifier(`${i.nom} : ${e}`, "erreur"),
      });
      notifier(`Bon d'essai envoyé à « ${i.nom} ».`);
    } catch (e) {
      notifier(`${i.nom} : ${e instanceof Error ? e.message : String(e)}`, "erreur");
    }
  };

  const ordinateurs = new Set(config.ordinateurs ?? Object.keys(config.appareils ?? {}));
  if (serieDisponible()) ordinateurs.add(config.caisseId);
  const tous = { ...config.appareils, [config.caisseId]: config.caisseNom };
  const dalles = Object.fromEntries(Object.entries(tous).filter(([id]) => ordinateurs.has(id)));
  const ONGLETS: Array<[OngletReglages, string, typeof Save, string]> = [
    ["appareil", "Cet appareil", Smartphone, "Imprimantes des tickets et des additions, synchronisation"],
    ["imprimantes", "Imprimantes", Printer, "Liste de l'établissement, postes de production"],
    ["etablissement", "Établissement", Building2, "En-tête des notes, seuil de note"],
    ["equipe", "Équipe", Users, "Serveurs, responsables, codes PIN"],
  ];

  if (etroit && menu) {
    return (
      <div className="page reglages">
        <header className="page-tete">
          <h1>Réglages</h1>
        </header>
        <nav className="menu-reglages" aria-label="Réglages">
          {ONGLETS.map(([id, libelle, Icone, aide]) => (
            <button key={id} className="menu-reglages-entree" onClick={() => choisirOnglet(id)}>
              <Icone className="icone" size={22} aria-hidden="true" />
              <span>
                <strong>{libelle}</strong>
                <small>{aide}</small>
              </span>
              <ChevronRight className="icone" size={18} aria-hidden="true" />
            </button>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div className="page reglages">
      {etroit && (
        <button className="bouton discret retour-reglages" onClick={() => setMenu(true)}>
          <AvecIcone icone={ChevronLeft}>Réglages</AvecIcone>
        </button>
      )}
      <header className="page-tete">
        <h1>{etroit ? ONGLETS.find(([id]) => id === onglet)![1] : "Réglages"}</h1>
        {onglet === "etablissement" && (
          <button className="bouton principal" disabled={envoi} onClick={() => void enregistrer()}>
            <AvecIcone icone={Save}>{envoi ? "Enregistrement…" : "Enregistrer les réglages"}</AvecIcone>
          </button>
        )}
      </header>
      {!etroit && (
        <div className="stock-caisse-onglets onglets-reglages" role="tablist" aria-label="Réglages">
          {ONGLETS.map(([id, libelle, icone]) => (
            <button key={id} role="tab" aria-selected={onglet === id} className={`option${onglet === id ? " active" : ""}`} onClick={() => choisirOnglet(id)}>
              <AvecIcone icone={icone}>{libelle}</AvecIcone>
            </button>
          ))}
        </div>
      )}

      {onglet === "appareil" && (
        <div className="formulaire-colonnes">
          <div>
            <ImprimantesAppareil onAssistant={props.onAssistant} />
            <ConnexionEpson />
            <ImprimantesPortees />
          </div>
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
                  <AvecIcone icone={RefreshCw}>Synchroniser</AvecIcone>
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
                    ? `Oui, l'${NOM_APPAREIL} ne purgera pas les données`
                    : "Non : installez la caisse sur l'écran d'accueil (Partager › Sur l'écran d'accueil)"}
              </dd>
            </div>
            <div>
              <dt>Seuil de note</dt>
              <dd>
                {euros(config.seuilNoteAutomatique)} · {config.noteAutomatique === false ? "proposée à l'encaissement" : "imprimée d'office"}
              </dd>
            </div>
          </dl>
        </fieldset>
        </div>
      )}

      {onglet === "imprimantes" && (
        <fieldset>
          <legend>Imprimantes de l'établissement</legend>
          <p className="aide-champ">
            Réglées une fois pour tous les appareils : les postes de production y choisissent leur imprimante, et chaque appareil celle de ses
            tickets et de ses additions (rubrique « Cet appareil »). Une imprimante série ou réseau est portée par une dalle : les autres appareils
            impriment par elle.
          </p>
          <EditeurImprimantes
            imprimantes={config.imprimantes ?? []}
            postes={config.postesImprimantes ?? {}}
            postesCarte={carte ? postesDeLaCarte(carte) : []}
            appareils={dalles}
            nomsAppareils={tous}
            onEnregistrer={enregistrerImprimantes}
            onTester={(i) => void testerImprimante(i)}
            autoriserEpson
          />
        </fieldset>
      )}

      {onglet === "etablissement" && (
        <div className="formulaire-colonnes">
          <fieldset>
            <legend>En-tête des notes</legend>
            <p className="aide-champ">Commun à toutes les caisses de l'établissement. La modification demande une connexion Internet.</p>
            {CHAMPS.map(([cle, libelle]) => (
              <label key={cle} className="champ">
                <span>{libelle}</span>
                <input value={etablissement[cle] ?? ""} onChange={(e) => setEtablissement({ ...etablissement, [cle]: e.target.value })} />
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Notes</legend>
            <label className="champ">
              <span>
                Note due à partir de
                <small>En dessous, la note est remise à la demande du client</small>
              </span>
              <input type="number" min={0} step={1} value={seuil} onChange={(e) => setSeuil(Number(e.target.value))} />
            </label>
            <label className="case">
              <input type="checkbox" checked={noteAuto} onChange={(e) => setNoteAuto(e.target.checked)} />
              Imprimer la note d'office à partir de ce montant
            </label>
            {!noteAuto && (
              <p className="aide-champ">
                La note reste due au client sans qu'il la demande : sur papier, ou par QR code s'il préfère la version dématérialisée. L'écran d'encaissement le rappelle et propose l'impression ou le QR code. Commun à toutes les caisses.
              </p>
            )}
          </fieldset>
        </div>
      )}

      {onglet === "equipe" && (
        <fieldset>
          <legend>Équipe</legend>
          <table className="tableau">
            <tbody>
              {config.utilisateurs.map((u) => (
                <tr key={u.id} className={u.actif ? "" : "annule"}>
                  <td>{u.nom}</td>
                  <td>{u.role === "responsable" ? "Responsable" : "Serveur"}</td>
                  <td className="nombre">
                    <BoutonIcone icone={KeyRound} variante="discret" libelle={`Changer le code PIN de ${u.nom}`} onClick={() => void changerPin(u)} />
                    <BoutonIcone
                      icone={u.actif ? UserX : UserCheck}
                      variante="discret"
                      libelle={`${u.actif ? "Désactiver" : "Réactiver"} ${u.nom}`}
                      onClick={() => void basculerActif(u)}
                    />
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
              <AvecIcone icone={UserPlus}>Ajouter à l'équipe</AvecIcone>
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}

/** Écran étroit (iPhone) : les réglages passent par un menu plutôt que par des onglets. */
function useEcranEtroit(): boolean {
  const requete = "(max-width: 600px)";
  const [etroit, setEtroit] = useState(() => typeof matchMedia !== "undefined" && matchMedia(requete).matches);
  useEffect(() => {
    const m = matchMedia(requete);
    const suivre = () => setEtroit(m.matches);
    m.addEventListener("change", suivre);
    return () => m.removeEventListener("change", suivre);
  }, []);
  return etroit;
}
