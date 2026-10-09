import { Couts } from "@matalon/stock";
import type { ReponseStockCaisse } from "@matalon/serveur/partage";
import { ClipboardList, Package, PackagePlus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FormulaireInventaire, FormulairePerte, FormulaireReception, ListePieces, TableauStock } from "../stock/OperationsStock";
import { Vide } from "./communs";
import { useCaisse } from "./contexte";
import { AvecIcone, BoutonIcone } from "./icones";
import { messageServeur } from "./Reglages";

type Onglet = "inventaire" | "reception" | "perte" | "stock";

/**
 * Stock sur l'iPad ou l'iPhone (responsables, en ligne) : inventaire par
 * zone, réception d'une livraison, perte ; stock théorique et dernières
 * pièces. Les ventes décomptent le stock d'elles-mêmes, à la synchronisation.
 */
export function StockCaisse() {
  const { caisse, config, utilisateur, notifier } = useCaisse();
  const [donnees, setDonnees] = useState<ReponseStockCaisse | null>(null);
  const [erreur, setErreur] = useState("");
  const [onglet, setOnglet] = useState<Onglet>("inventaire");
  const charger = useCallback(async () => {
    try {
      setDonnees(await caisse.client.stock());
      setErreur("");
    } catch (e) {
      setErreur(messageServeur(e));
    }
  }, [caisse]);
  useEffect(() => {
    void charger();
  }, [charger]);
  const couts = useMemo(() => (donnees ? new Couts(donnees.referentiel, donnees.prix, config.etablissementId) : null), [donnees, config.etablissementId]);

  const enregistrer = (type: "receptions" | "inventaires" | "pertes") => async (corps: Record<string, unknown>) => {
    try {
      const r = await caisse.client.operationStock(type, { ...corps, utilisateurId: utilisateur.id });
      setDonnees((d) => (d ? { ...d, etat: r.etat, documents: [r.document, ...d.documents] } : d));
      if (type === "receptions") void charger();
      notifier(type === "inventaires" ? "Inventaire enregistré." : type === "receptions" ? "Réception enregistrée." : "Perte enregistrée.");
    } catch (e) {
      throw new Error(messageServeur(e));
    }
  };

  return (
    <div className="page stock-caisse">
      <header className="page-tete">
        <h1 className="titre-icone">
          <AvecIcone icone={Package} taille={26}>Stock</AvecIcone>
        </h1>
        <BoutonIcone icone={RefreshCw} variante="discret" libelle="Actualiser" onClick={() => void charger()} />
      </header>
      {erreur && <p className="erreur">{erreur}</p>}
      {!donnees || !couts ? (
        !erreur && <p className="explication">Chargement du stock…</p>
      ) : !donnees.referentiel.produits.length ? (
        <Vide>Aucun produit : les produits, fournisseurs et recettes se créent dans l'administration (Stock et recettes).</Vide>
      ) : (
        <>
          <div className="stock-caisse-onglets" role="tablist">
            {(
              [
                ["inventaire", "Inventaire", ClipboardList],
                ["reception", "Réception", PackagePlus],
                ["perte", "Perte", Trash2],
                ["stock", "Stock et pièces", Package],
              ] as const
            ).map(([id, libelle, icone]) => (
              <button key={id} role="tab" aria-selected={onglet === id} className={`option${onglet === id ? " active" : ""}`} onClick={() => setOnglet(id)}>
                <AvecIcone icone={icone}>{libelle}</AvecIcone>
              </button>
            ))}
          </div>
          {onglet === "inventaire" && <FormulaireInventaire referentiel={donnees.referentiel} etat={donnees.etat} onEnregistrer={enregistrer("inventaires")} />}
          {onglet === "reception" && <FormulaireReception referentiel={donnees.referentiel} prix={donnees.prix} etablissementId={config.etablissementId} onEnregistrer={enregistrer("receptions")} />}
          {onglet === "perte" && <FormulairePerte referentiel={donnees.referentiel} couts={couts} onEnregistrer={enregistrer("pertes")} />}
          {onglet === "stock" && (
            <>
              <TableauStock referentiel={donnees.referentiel} etat={donnees.etat} />
              <h2>Dernières pièces</h2>
              <ListePieces documents={donnees.documents} referentiel={donnees.referentiel} />
            </>
          )}
        </>
      )}
    </div>
  );
}
