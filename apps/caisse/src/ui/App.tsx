import { CLIENT_ID_VALIDE } from "@matalon/serveur/partage";
import { NOM_APPAREIL } from "../donnees/appareil";
import { AvecIcone } from "./icones";
import { Link, RefreshCw, RotateCw } from "lucide-react";
import type { Catalogue } from "@matalon/catalogue";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import type { BaseCaisse, ConnexionServeur } from "../donnees/base";
import { carteATelecharger, fusionnerReferentiel, type Configuration, type Utilisateur } from "../donnees/configuration";
import {
  demarrer,
  effacerCaisseDeTest,
  enregistrerConfiguration,
  MODE_TEST,
  prendreVerrouCaisse,
  type Caisse,
} from "../fiscal/caisse";
import { envoyerEpson } from "../impression/epson";
import type { Recu } from "../impression/recu";
import { AssistantImprimante } from "./AssistantImprimante";
import { Connexion } from "./Connexion";
import { Contexte, type ContexteCaisse } from "./contexte";
import { Coque } from "./Coque";
import { blocageEncaissement, Synchroniseur, type EtatSynchro } from "../serveur/synchro";
import { Rattachement } from "./Rattachement";
import { ModaleApercu } from "./modales/ModaleApercu";
import { journaliserBlocagePin, ModalePin } from "./modales/ModalePin";

type Phase =
  | { nom: "chargement" }
  | { nom: "autreOnglet" }
  | { nom: "erreur"; message: string }
  | { nom: "rattachement"; db: BaseCaisse }
  | { nom: "ancienne"; db: BaseCaisse }
  | { nom: "assistantImprimante"; caisse: Caisse }
  | { nom: "connexion"; caisse: Caisse }
  | { nom: "caisse"; caisse: Caisse; utilisateur: Utilisateur };

const ETAT_INITIAL: EtatSynchro = {
  statut: "en_attente",
  enAttente: 0,
  derniereSynchro: null,
  decalageHorloge: 0,
  message: null,
  enCours: false,
};

interface Toast {
  id: number;
  message: string;
  ton: "info" | "erreur";
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ nom: "chargement" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [apercu, setApercu] = useState<{ recu: Recu; titre: string; erreur?: string } | null>(null);
  const [demandePin, setDemandePin] = useState<{ raison: string; resoudre: (r: { id: string; pin: string } | null) => void } | null>(null);
  const [synchro, setSynchro] = useState<EtatSynchro | null>(null);
  const synchroniseur = useRef<Synchroniseur | null>(null);
  const caisseCourante = useRef<Caisse | null>(null);
  const {
    needRefresh: [majDisponible],
    updateServiceWorker,
  } = useRegisterSW();

  if ("caisse" in phase) caisseCourante.current = phase.caisse;

  /** Remplace la caisse (nouvelle configuration) dans la phase en cours. */
  const remplacerCaisse = useCallback((caisse: Caisse) => {
    caisseCourante.current = caisse;
    setPhase((p) => {
      if (p.nom !== "caisse") return "caisse" in p ? { ...p, caisse } : p;
      const u = caisse.config.utilisateurs.find((x) => x.id === p.utilisateur.id);
      // Membre désactivé depuis l'administration : retour à l'écran de connexion.
      if (!u?.actif) return { nom: "connexion", caisse };
      return { ...p, caisse, utilisateur: u };
    });
  }, []);

  /** Démarre la réplication vers le serveur, une fois par caisse ouverte. */
  const brancherSynchro = useCallback(
    (caisse: Caisse, connexion: ConnexionServeur) => {
      if (synchroniseur.current) return;
      const s = new Synchroniseur(
        {
          db: caisse.db,
          stockage: caisse.stockage,
          client: caisse.client,
          async surReferentiel(etat) {
            const actuelle = caisseCourante.current;
            if (!actuelle) return;
            // Nouvelle carte publiée dans l'administration : téléchargée une fois, gardée pour le hors ligne.
            let carteRecue: { carte: Catalogue; version: number } | null = null;
            if (carteATelecharger(actuelle.config, etat)) {
              try {
                carteRecue = await actuelle.client.carte();
              } catch {
                /* nouvel essai à la prochaine synchronisation ; on garde la carte en place */
              }
            }
            // Clients créés ici hors ligne : leur fiche complète (téléphone, e-mail) part dès que le serveur répond.
            // Le serveur a pu apprendre le client par le ticket en compte (nom seul) : la fiche est alors complétée.
            const connus = etat.clients;
            if (connus) {
              for (const c of (caisseCourante.current ?? actuelle).config.clients ?? []) {
                const s = connus.find((x) => x.id === c.id);
                const nue = !!s && !s.telephone && !s.email && !!(c.telephone || c.email);
                if (CLIENT_ID_VALIDE.test(c.id) && (!s || nue)) await actuelle.client.enregistrerClient(c).catch(() => undefined);
              }
            }
            // Relue après l'attente réseau : une modification locale faite entre-temps (imprimante…) est conservée.
            const fraiche = caisseCourante.current ?? actuelle;
            let config = fusionnerReferentiel(fraiche.config, etat);
            if (carteRecue) config = { ...(config ?? fraiche.config), carteId: carteRecue.carte.id, carte: carteRecue.carte, carteVersion: carteRecue.version };
            if (config) remplacerCaisse(await enregistrerConfiguration(fraiche, config));
          },
        },
        connexion,
      );
      synchroniseur.current = s;
      s.abonner(setSynchro);
      caisse.stockage.surEcriture(() => s.signalerEcriture());
      void s.synchroniser();
    },
    [remplacerCaisse],
  );

  useEffect(() => {
    void (async () => {
      try {
        if (!(await prendreVerrouCaisse())) return setPhase({ nom: "autreOnglet" });
        const d = await demarrer();
        if (d.etat === "rattachement") return setPhase({ nom: "rattachement", db: d.db });
        if (d.etat === "ancienne") return setPhase({ nom: "ancienne", db: d.db });
        brancherSynchro(d.caisse, d.connexion);
        setPhase({ nom: "connexion", caisse: d.caisse });
      } catch (e) {
        setPhase({ nom: "erreur", message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [brancherSynchro]);

  // Rattrapage : toutes les minutes, au retour du réseau et au retour sur l'app.
  useEffect(() => {
    const relancer = () => void synchroniseur.current?.synchroniser();
    const visible = () => document.visibilityState === "visible" && relancer();
    const minuterie = setInterval(relancer, 60_000);
    window.addEventListener("online", relancer);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(minuterie);
      window.removeEventListener("online", relancer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  const compteur = useRef(0);
  const notifier = useCallback((message: string, ton: "info" | "erreur" = "info") => {
    const id = ++compteur.current;
    setToasts((t) => [...t, { id, message, ton }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ton === "erreur" ? 7000 : 3500);
  }, []);

  const contexte = useMemo<ContexteCaisse | null>(() => {
    if (phase.nom !== "caisse") return null;
    const { caisse, utilisateur } = phase;
    return {
      caisse,
      config: caisse.config,
      utilisateur,
      async majConfig(config: Configuration) {
        remplacerCaisse(await enregistrerConfiguration(caisse, config));
      },
      notifier,
      imprimanteConfiguree: !!caisse.config.imprimante.adresse,
      async imprimer(recu: Recu, titre: string) {
        const { adresse, sansAccents } = caisse.config.imprimante;
        if (!adresse) return setApercu({ recu, titre });
        try {
          await envoyerEpson(adresse, recu, { sansAccents });
        } catch (e) {
          setApercu({ recu, titre, erreur: e instanceof Error ? e.message : String(e) });
        }
      },
      demanderResponsable(raison: string) {
        if (utilisateur.role === "responsable") return Promise.resolve(utilisateur.id);
        return new Promise((resoudre) => setDemandePin({ raison, resoudre: (r) => resoudre(r?.id ?? null) }));
      },
      demanderPinResponsable(raison: string) {
        // Toujours saisi, même par un responsable connecté : le serveur vérifie lui-même ce code.
        return new Promise((resoudre) => setDemandePin({ raison, resoudre }));
      },
      deconnecter() {
        void caisse.registre.journaliser("DECONNEXION", {}, utilisateur.id);
        setPhase({ nom: "connexion", caisse });
      },
      synchro: synchro ?? ETAT_INITIAL,
      synchroniser: () => synchroniseur.current?.synchroniser() ?? Promise.resolve(),
      blocage: synchro ? blocageEncaissement(synchro) : null,
    };
  }, [phase, notifier, synchro, remplacerCaisse]);

  let contenu: React.ReactNode;
  switch (phase.nom) {
    case "chargement":
      contenu = <div className="ecran-centre">Ouverture de la caisse…</div>;
      break;
    case "autreOnglet":
      contenu = (
        <div className="ecran-centre">
          <h1>La caisse est déjà ouverte</h1>
          <p>Elle tourne dans un autre onglet ou une autre fenêtre de cet {NOM_APPAREIL}. Fermez cet onglet et utilisez l'autre.</p>
        </div>
      );
      break;
    case "erreur":
      contenu = (
        <div className="ecran-centre">
          <h1>La caisse ne peut pas démarrer</h1>
          <p>{phase.message}</p>
          <button className="bouton principal" onClick={() => location.reload()}>
            <AvecIcone icone={RotateCw}>Réessayer</AvecIcone>
          </button>
        </div>
      );
      break;
    case "rattachement":
      contenu = (
        <Rattachement
          db={phase.db}
          onRattachee={(caisse, connexion) => {
            brancherSynchro(caisse, connexion);
            setPhase({ nom: "assistantImprimante", caisse });
          }}
        />
      );
      break;
    case "ancienne":
      contenu = (
        <div className="ecran-centre">
          <h1>Caisse d'une version précédente</h1>
          <p>
            Cet {NOM_APPAREIL} a été mis en service avant le rattachement aux établissements du groupe. Ses tickets ne peuvent pas
            rejoindre le serveur.
          </p>
          {MODE_TEST ? (
            <div className="actions-ecran">
              <button
                className="bouton principal"
                onClick={() => {
                  if (!window.confirm(`Effacer les tickets de test de cet ${NOM_APPAREIL} (sans valeur) et le rattacher à un établissement ?`)) return;
                  void effacerCaisseDeTest(phase.db).then(() => setPhase({ nom: "rattachement", db: phase.db }));
                }}
              >
                <AvecIcone icone={Link}>Effacer les données de test et rattacher l'{NOM_APPAREIL}</AvecIcone>
              </button>
            </div>
          ) : (
            <p>Contactez l'administrateur : ces données doivent être exportées avant toute nouvelle mise en service.</p>
          )}
        </div>
      );
      break;
    case "assistantImprimante":
      contenu = (
        <AssistantImprimante
          config={phase.caisse.config}
          onTerminer={(imprimante) =>
            void enregistrerConfiguration(caisseCourante.current ?? phase.caisse, {
              ...(caisseCourante.current ?? phase.caisse).config,
              imprimante,
            }).then((caisse) => setPhase({ nom: "connexion", caisse }))
          }
          onPlusTard={() => setPhase({ nom: "connexion", caisse: phase.caisse })}
        />
      );
      break;
    case "connexion":
      contenu = (
        <Connexion
          caisse={phase.caisse}
          onConnecte={(utilisateur) => {
            void phase.caisse.registre.journaliser("CONNEXION", {}, utilisateur.id);
            setPhase({ nom: "caisse", caisse: phase.caisse, utilisateur });
          }}
        />
      );
      break;
    case "caisse":
      contenu = (
        <Contexte.Provider value={contexte}>
          <Coque />
        </Contexte.Provider>
      );
      break;
  }

  return (
    <>
      {contenu}
      {majDisponible && phase.nom === "caisse" && phase.utilisateur.role === "responsable" && (
        <div className="bandeau-maj">
          Une nouvelle version de la caisse est prête.
          <button className="bouton" onClick={() => void updateServiceWorker(true)}>
            <AvecIcone icone={RefreshCw}>Mettre à jour</AvecIcone>
          </button>
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.ton}`}>
            {t.message}
          </div>
        ))}
      </div>
      {apercu && <ModaleApercu {...apercu} onFermer={() => setApercu(null)} />}
      {demandePin && phase.nom === "caisse" && (
        <ModalePin
          titre="Validation responsable"
          raison={demandePin.raison}
          utilisateurs={phase.caisse.config.utilisateurs.filter((u) => u.role === "responsable")}
          onValide={(u, pin) => {
            demandePin.resoudre({ id: u.id, pin });
            setDemandePin(null);
          }}
          onBloque={(u) => void journaliserBlocagePin(phase.caisse, u, "validation")}
          onAnnuler={() => {
            demandePin.resoudre(null);
            setDemandePin(null);
          }}
        />
      )}
    </>
  );
}
