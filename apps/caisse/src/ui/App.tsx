import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import type { BaseCaisse } from "../donnees/base";
import type { Configuration, Utilisateur } from "../donnees/configuration";
import { demarrer, enregistrerConfiguration, prendreVerrouCaisse, type Caisse } from "../fiscal/caisse";
import { envoyerEpson } from "../impression/epson";
import type { Recu } from "../impression/recu";
import { Connexion } from "./Connexion";
import { Contexte, type ContexteCaisse } from "./contexte";
import { Coque } from "./Coque";
import { Installation } from "./Installation";
import { ModaleApercu } from "./modales/ModaleApercu";
import { ModalePin } from "./modales/ModalePin";

type Phase =
  | { nom: "chargement" }
  | { nom: "autreOnglet" }
  | { nom: "erreur"; message: string }
  | { nom: "installation"; db: BaseCaisse }
  | { nom: "connexion"; caisse: Caisse }
  | { nom: "caisse"; caisse: Caisse; utilisateur: Utilisateur };

interface Toast {
  id: number;
  message: string;
  ton: "info" | "erreur";
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ nom: "chargement" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [apercu, setApercu] = useState<{ recu: Recu; titre: string; erreur?: string } | null>(null);
  const [demandePin, setDemandePin] = useState<{ raison: string; resoudre: (id: string | null) => void } | null>(null);
  const {
    needRefresh: [majDisponible],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    void (async () => {
      try {
        if (!(await prendreVerrouCaisse())) return setPhase({ nom: "autreOnglet" });
        const d = await demarrer();
        setPhase(d.etat === "installation" ? { nom: "installation", db: d.db } : { nom: "connexion", caisse: d.caisse });
      } catch (e) {
        setPhase({ nom: "erreur", message: e instanceof Error ? e.message : String(e) });
      }
    })();
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
        const c = await enregistrerConfiguration(caisse, config);
        const u = config.utilisateurs.find((x) => x.id === utilisateur.id) ?? utilisateur;
        setPhase({ nom: "caisse", caisse: c, utilisateur: u });
      },
      notifier,
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
        return new Promise((resoudre) => setDemandePin({ raison, resoudre }));
      },
      deconnecter() {
        void caisse.registre.journaliser("DECONNEXION", {}, utilisateur.id);
        setPhase({ nom: "connexion", caisse });
      },
    };
  }, [phase, notifier]);

  let contenu: React.ReactNode;
  switch (phase.nom) {
    case "chargement":
      contenu = <div className="ecran-centre">Ouverture de la caisse…</div>;
      break;
    case "autreOnglet":
      contenu = (
        <div className="ecran-centre">
          <h1>La caisse est déjà ouverte</h1>
          <p>Elle tourne dans un autre onglet ou une autre fenêtre de cet iPad. Fermez cet onglet et utilisez l'autre.</p>
        </div>
      );
      break;
    case "erreur":
      contenu = (
        <div className="ecran-centre">
          <h1>La caisse ne peut pas démarrer</h1>
          <p>{phase.message}</p>
          <button className="bouton principal" onClick={() => location.reload()}>
            Réessayer
          </button>
        </div>
      );
      break;
    case "installation":
      contenu = <Installation db={phase.db} onInstallee={(caisse) => setPhase({ nom: "connexion", caisse })} />;
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
            Mettre à jour
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
          onValide={(u) => {
            demandePin.resoudre(u.id);
            setDemandePin(null);
          }}
          onAnnuler={() => {
            demandePin.resoudre(null);
            setDemandePin(null);
          }}
        />
      )}
    </>
  );
}
