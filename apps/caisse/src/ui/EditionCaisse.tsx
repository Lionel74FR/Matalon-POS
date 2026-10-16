import { Couts } from "@matalon/stock";
import type { ReponseStock } from "@matalon/serveur/partage";
import { BookOpen, ChefHat } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FournisseurAccesEdition, type AccesEdition } from "../admin/acces-edition";
import { EditeurCarte } from "../admin/EditeurCarte";
import { Recettes } from "../admin/Stock";
import { useCaisse } from "./contexte";
import { AvecIcone } from "./icones";
import { messageServeur } from "./Reglages";

/**
 * Carte et fiches techniques sur l'iPad (responsables, en ligne) : le même
 * éditeur que l'administration, sur la carte de l'établissement ; chaque
 * enregistrement passe par le serveur au nom du responsable connecté, puis
 * l'appareil reçoit la nouvelle carte à la synchronisation.
 */
export function EditionCaisse(props: { onRetour: () => void }) {
  const { caisse, config, utilisateur, synchroniser } = useCaisse();
  const [onglet, setOnglet] = useState<"carte" | "fiches">("carte");
  const [stock, setStock] = useState<ReponseStock | null>(null);
  const [erreur, setErreur] = useState("");

  const acces = useMemo<AccesEdition>(() => {
    const clair = async <T,>(f: () => Promise<T>) => {
      try {
        return await f();
      } catch (e) {
        // Garde le code (VERSION_DEPASSEE : l'éditeur propose de recharger), message en clair.
        const horsLigne = (e as { code?: string }).code === "HORS_LIGNE";
        const message = horsLigne ? "Connexion Internet nécessaire : la carte et les fiches techniques se modifient en ligne, puis parviennent aux caisses." : messageServeur(e);
        const x = new Error(message) as Error & { code?: string };
        x.code = (e as { code?: string }).code;
        throw x;
      }
    };
    return {
      stock: () => clair(() => caisse.client.editionStock()),
      carte: (id) => clair(() => caisse.client.editionCarte(id)),
      ventesCarte: (id) => clair(() => caisse.client.editionVentesCarte(id)),
      enregistrerCarte: (id, carte, version) => clair(() => caisse.client.enregistrerCarteEdition(id, carte, version, utilisateur.id)),
      enregistrerRecette: (recette) => clair(() => caisse.client.enregistrerRecetteEdition(recette, utilisateur.id)),
    };
  }, [caisse, utilisateur.id]);

  useEffect(() => {
    if (onglet !== "fiches" || stock) return;
    acces.stock().then(setStock, (e) => setErreur(e instanceof Error ? e.message : String(e)));
  }, [onglet, stock, acces]);
  const couts = useMemo(() => (stock ? new Couts(stock.referentiel, stock.prix, config.etablissementId) : null), [stock, config.etablissementId]);

  return (
    <FournisseurAccesEdition value={acces}>
      <div className="page edition-caisse">
        <div className="stock-caisse-onglets" role="tablist">
          <button role="tab" aria-selected={onglet === "carte"} className={`option${onglet === "carte" ? " active" : ""}`} onClick={() => setOnglet("carte")}>
            <AvecIcone icone={BookOpen}>Carte</AvecIcone>
          </button>
          <button role="tab" aria-selected={onglet === "fiches"} className={`option${onglet === "fiches" ? " active" : ""}`} onClick={() => setOnglet("fiches")}>
            <AvecIcone icone={ChefHat}>Fiches techniques</AvecIcone>
          </button>
        </div>
        {onglet === "carte" && (
          <EditeurCarte
            id={config.carteId}
            libelleRetour="Salle"
            onRetour={props.onRetour}
            onEnregistre={() => void synchroniser()}
          />
        )}
        {onglet === "fiches" &&
          (erreur ? (
            <p className="erreur">{erreur}</p>
          ) : !stock || !couts ? (
            <p className="explication">Chargement des fiches techniques…</p>
          ) : (
            <Recettes stock={stock} couts={couts} nomEtab={stock.etablissements[0]?.enseigne ?? ""} onStock={setStock} />
          ))}
      </div>
    </FournisseurAccesEdition>
  );
}
