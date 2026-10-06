import { useCallback, useEffect, useState } from "react";
import { ID_COMPTOIR } from "../donnees/configuration";
import { nouvelleCommande, type Commande } from "../metier/commande";
import { nomTable } from "../impression/gabarits";
import { MODE_TEST } from "../fiscal/caisse";
import type { EtatSynchro } from "../serveur/synchro";
import { AssistantImprimante } from "./AssistantImprimante";
import { Clotures } from "./Clotures";
import { useCaisse } from "./contexte";
import { PriseCommande } from "./PriseCommande";
import { Reglages } from "./Reglages";
import { Salle } from "./Salle";
import { Tickets } from "./Tickets";

type Vue = { nom: "salle" } | { nom: "commande"; tableId: string } | { nom: "tickets" } | { nom: "clotures" } | { nom: "reglages" };

const LIBELLES_SYNCHRO: Record<EtatSynchro["statut"], string> = {
  synchronise: "Synchronisé",
  en_attente: "En attente",
  hors_ligne: "Hors ligne",
  divergence: "Divergence",
  revoquee: "Révoquée",
  erreur: "Erreur serveur",
};

function PuceSynchro(props: { etat: EtatSynchro; onToucher: () => void }) {
  const { etat } = props;
  const detail = [
    etat.enAttente > 0 ? `${etat.enAttente} enregistrement${etat.enAttente > 1 ? "s" : ""} à envoyer` : null,
    etat.derniereSynchro ? `dernière synchronisation ${new Date(etat.derniereSynchro).toLocaleString("fr-FR")}` : "jamais synchronisée",
    etat.message,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      className={`puce-synchro ${etat.statut}${etat.enCours ? " en-cours" : ""}`}
      title={detail}
      aria-label={`${LIBELLES_SYNCHRO[etat.statut]} : ${detail}`}
      onClick={props.onToucher}
    >
      <span className="libelle-synchro">
        {LIBELLES_SYNCHRO[etat.statut]}
        {etat.enAttente > 0 && etat.statut !== "synchronise" ? ` (${etat.enAttente})` : ""}
      </span>
    </button>
  );
}

function useHorloge() {
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setMaintenant(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  return maintenant;
}

export function Coque() {
  const { caisse, config, utilisateur, deconnecter, majConfig, notifier, synchro, synchroniser, blocage } = useCaisse();
  const [assistant, setAssistant] = useState(false);
  const [vue, setVue] = useState<Vue>({ nom: "salle" });
  const [commandes, setCommandes] = useState<Map<string, Commande>>(new Map());
  const [horlogeSuspecte, setHorlogeSuspecte] = useState(false);
  const maintenant = useHorloge();

  useEffect(() => {
    void caisse.db.getAll("commandes").then((liste) => setCommandes(new Map(liste.map((c) => [c.tableId, c]))));
  }, [caisse.db]);

  // Une heure d'iPad antérieure au dernier ticket signale une horloge déréglée.
  useEffect(() => {
    void caisse.stockage.dernier("tickets").then((t) => {
      setHorlogeSuspecte(!!t && Date.parse(t.horodatage) - maintenant.getTime() > 5 * 60_000);
    });
  }, [caisse.stockage, maintenant]);

  const enregistrerCommande = useCallback(
    async (c: Commande | null, tableId: string) => {
      setCommandes((m) => {
        const copie = new Map(m);
        if (c && c.lignes.length > 0) copie.set(tableId, c);
        else copie.delete(tableId);
        return copie;
      });
      if (c && c.lignes.length > 0) await caisse.db.put("commandes", c);
      else await caisse.db.delete("commandes", tableId);
    },
    [caisse.db],
  );

  const ouvrirTable = (tableId: string) => setVue({ nom: "commande", tableId });

  const onglets: Array<{ vue: Vue["nom"]; libelle: string; responsable?: boolean }> = [
    { vue: "salle", libelle: "Salle" },
    { vue: "tickets", libelle: "Tickets" },
    { vue: "clotures", libelle: "Clôtures" },
    { vue: "reglages", libelle: "Réglages", responsable: true },
  ];

  return (
    <div className="coque">
      <nav className="barre">
        <div className="barre-marque">
          <img src="/icone.svg" alt="" width={34} height={34} />
          <span>{config.etablissement.enseigne}</span>
        </div>
        <div className="barre-onglets" role="tablist">
          {onglets
            .filter((o) => !o.responsable || utilisateur.role === "responsable")
            .map((o) => (
              <button
                key={o.vue}
                role="tab"
                aria-selected={vue.nom === o.vue || (o.vue === "salle" && vue.nom === "commande")}
                className="onglet"
                onClick={() => setVue({ nom: o.vue } as Vue)}
              >
                {o.libelle}
              </button>
            ))}
          <button className="onglet comptoir" onClick={() => ouvrirTable(ID_COMPTOIR)}>
            Vente comptoir
          </button>
        </div>
        <div className="barre-etat">
          <PuceSynchro etat={synchro} onToucher={() => void synchroniser()} />
          <time>{maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time>
          <button className="bouton discret" onClick={deconnecter} title="Changer d'utilisateur">
            <span className="nom-utilisateur">{utilisateur.nom} · </span>Quitter
          </button>
        </div>
      </nav>
      {MODE_TEST && (
        <div className="bandeau-test">Caisse de test : les tickets n'ont aucune valeur et restent séparés de la vraie caisse.</div>
      )}
      {blocage && (
        <div className="bandeau-alerte" role="alert">
          <span>{blocage}</span>
          {synchro.statut !== "revoquee" && (
            <button className="bouton" onClick={() => void synchroniser()}>
              Vérifier
            </button>
          )}
        </div>
      )}
      {synchro.statut === "divergence" && utilisateur.role === "responsable" && (
        <div className="bandeau-alerte" role="alert">
          <span>
            Divergence avec le serveur : {synchro.message}. La caisse continue d'encaisser ; prévenez l'administrateur, qui
            vérifiera les deux copies.
          </span>
        </div>
      )}
      {horlogeSuspecte && (
        <div className="bandeau-alerte">
          L'heure de l'iPad est antérieure au dernier ticket. Réglez la date et l'heure dans les réglages de l'iPad avant
          d'encaisser.
        </div>
      )}
      {!config.imprimante.adresse && utilisateur.role === "responsable" && (
        <div className="bandeau-info">
          <span className="bandeau-texte">
            Caisse sans imprimante : les notes passent par QR code, les Z restent consultables dans Clôtures.
          </span>
          <button className="bouton" onClick={() => setAssistant(true)}>
            Connecter l'imprimante
          </button>
        </div>
      )}
      <main className="contenu">
        {vue.nom === "salle" && <Salle commandes={commandes} onOuvrir={ouvrirTable} />}
        {vue.nom === "commande" && (
          <PriseCommande
            key={vue.tableId}
            titre={nomTable(config, vue.tableId)}
            commande={commandes.get(vue.tableId) ?? nouvelleCommande(vue.tableId, utilisateur.id)}
            onChange={(c) => void enregistrerCommande(c, vue.tableId)}
            onTerminee={() => {
              void enregistrerCommande(null, vue.tableId);
              setVue({ nom: "salle" });
            }}
            onRetour={() => setVue({ nom: "salle" })}
          />
        )}
        {vue.nom === "tickets" && <Tickets />}
        {vue.nom === "clotures" && <Clotures commandesOuvertes={commandes.size} />}
        {vue.nom === "reglages" && <Reglages onAssistant={() => setAssistant(true)} />}
      </main>
      {assistant && (
        <div className="assistant-calque">
          <AssistantImprimante
            config={config}
            onTerminer={(imprimante) => {
              void majConfig({ ...config, imprimante }).then(() => notifier("Imprimante connectée."));
              setAssistant(false);
            }}
            onPlusTard={() => setAssistant(false)}
          />
        </div>
      )}
    </div>
  );
}
