import type { ClientApi } from "@matalon/serveur/partage";
import { Check, Search, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { nouvelIdClient } from "../../donnees/clients";
import { AvecIcone } from "../icones";
import { Modale } from "../communs";
import { useCaisse } from "../contexte";


const normaliser = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Choix du client d'un compte (ardoise) : recherche parmi les clients de
 * l'établissement, ou création sur place (nom, téléphone facultatif).
 */
export function ModaleClient(props: {
  titre: string;
  /** `nouveau` : fiche créée ici, à enregistrer par l'appelant une fois l'opération validée. */
  onChoisir: (c: ClientApi, nouveau: boolean) => void;
  onFermer: () => void;
}) {
  const { config, notifier } = useCaisse();
  const [recherche, setRecherche] = useState("");
  const [creation, setCreation] = useState(false);
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const clients = useMemo(() => {
    const q = normaliser(recherche.trim());
    return (config.clients ?? [])
      .filter((c) => c.actif && (!q || normaliser(`${c.nom} ${c.telephone}`).includes(q)))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }, [config.clients, recherche]);

  const creer = async () => {
    const n = nom.trim().replace(/\s+/g, " ");
    if (!n) return notifier("Indiquez le nom du client.", "erreur");
    if (n.length > 80) return notifier("Nom trop long (80 caractères au plus).", "erreur");
    props.onChoisir({ id: nouvelIdClient(), nom: n, telephone: telephone.trim().slice(0, 30), actif: true }, true);
  };

  return (
    <Modale titre={props.titre} onFermer={props.onFermer}>
      {creation ? (
        <form
          className="formulaire-client"
          onSubmit={(e) => {
            e.preventDefault();
            void creer();
          }}
        >
          <label className="champ">
            <span>Nom du client</span>
            <input value={nom} onChange={(e) => setNom(e.target.value)} autoFocus maxLength={80} placeholder="Prénom Nom ou société" />
          </label>
          <label className="champ">
            <span>
              Téléphone <small>Facultatif</small>
            </span>
            <input value={telephone} onChange={(e) => setTelephone(e.target.value)} inputMode="tel" maxLength={30} />
          </label>
          <div className="options">
            <button type="button" className="bouton" onClick={() => setCreation(false)}>
              Retour à la liste
            </button>
            <button className="bouton principal" disabled={!nom.trim()}>
              <AvecIcone icone={Check}>Créer et choisir</AvecIcone>
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="recherche-client">
            <Search className="icone" size={20} aria-hidden="true" />
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher un client"
              aria-label="Rechercher un client"
            />
          </div>
          <ul className="liste-clients">
            {clients.map((c) => (
              <li key={c.id}>
                <button className="client-choix" onClick={() => props.onChoisir(c, false)}>
                  <strong>{c.nom}</strong>
                  {c.telephone && <small>{c.telephone}</small>}
                </button>
              </li>
            ))}
            {clients.length === 0 && <li className="explication">{recherche ? "Aucun client ne correspond." : "Aucun client pour l'instant."}</li>}
          </ul>
          <button
            className="bouton"
            onClick={() => {
              setNom(recherche.trim());
              setCreation(true);
            }}
          >
            <AvecIcone icone={UserPlus}>Nouveau client</AvecIcone>
          </button>
        </>
      )}
    </Modale>
  );
}
