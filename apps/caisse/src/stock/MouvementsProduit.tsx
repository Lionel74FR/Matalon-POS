import { BASE, formaterEnUnite, formaterQuantite, LIBELLES_MOUVEMENT, type Produit } from "@matalon/stock";
import type { MouvementApi } from "@matalon/serveur/partage";
import { useEffect, useState } from "react";
import { eurosMicro } from "../admin/stock-commun";
import { Modale } from "../ui/communs";
import "./stock.css";

/**
 * Mouvements d'un produit (caisse et administration), du plus récent au plus
 * ancien : ventes décomptées à la synchronisation, annulations, réceptions,
 * inventaires, pertes, transferts ; le stock après chaque mouvement se
 * recalcule à rebours depuis le stock théorique actuel.
 */

const signe = (q: number, p: Produit) => `${q > 0 ? "+" : q < 0 ? "−" : ""}${q === 0 ? "0" : formaterQuantite({ valeur: Math.abs(q), unite: BASE[p.unite] })}`;

export function origineMouvement(m: MouvementApi): string {
  const o = m.origine;
  if (o.libelle) return `${String(o.libelle)} · ticket ${String(o.ticket)}`;
  if (o.annulation && o.reception) return "Réception annulée";
  if (o.fournisseur) return `${String(o.fournisseur)}${o.commande ? ` · commande n° ${String(o.commande)}` : ""}${o.numero ? ` · BL ${String(o.numero)}` : ""}`;
  if (o.motif) return `${String(o.motif)}${o.composant ? ` · ${String(o.composant)}` : ""}`;
  if (o.inventaire) return `${o.ouverture ? "Stock d'ouverture" : "Inventaire"}${o.zone ? ` · ${String(o.zone)}` : ""}`;
  if (o.vers) return `Vers ${String(o.vers)}`;
  if (o.de) return `Depuis ${String(o.de)}`;
  return "";
}

export function MouvementsProduit(props: { produit: Produit; stockActuel: number | null; charger: () => Promise<MouvementApi[]>; onFermer: () => void }) {
  const p = props.produit;
  const [mouvements, setMouvements] = useState<MouvementApi[] | null>(null);
  const [erreur, setErreur] = useState("");
  const { charger } = props;
  useEffect(() => {
    charger()
      .then(setMouvements)
      .catch((e) => setErreur(e instanceof Error ? e.message : String(e)));
  }, [charger]);
  // Stock après chaque mouvement, à rebours depuis le stock actuel (liste du plus récent au plus ancien).
  let solde = props.stockActuel;
  const lignes = (mouvements ?? []).map((m) => {
    const apres = solde;
    if (solde != null) solde -= m.quantite;
    return { m, apres };
  });
  return (
    <Modale large titre={`Mouvements · ${p.nom}`} onFermer={props.onFermer}>
      {props.stockActuel != null && (
        <p className="mouvements-solde">
          Stock théorique : <strong>{formaterEnUnite(props.stockActuel, p.unite)}</strong>
        </p>
      )}
      {erreur ? (
        <p className="erreur">{erreur}</p>
      ) : !mouvements ? (
        <p className="explication">Chargement…</p>
      ) : !mouvements.length ? (
        <p className="explication">Aucun mouvement : ni vente reliée à une fiche, ni réception, ni inventaire pour ce produit.</p>
      ) : (
        <ul className="mouvements-liste">
          {lignes.map(({ m, apres }) => (
            <li key={m.id} className={`mouvement-${m.type}`}>
              <span>
                <strong>{LIBELLES_MOUVEMENT[m.type]}</strong>
                <small>{origineMouvement(m)}</small>
                <small>
                  {new Date(m.le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  {m.par ? ` · ${m.par}` : ""}
                </small>
              </span>
              <span className="mouvement-quantite">
                <strong>{signe(m.quantite, p)}</strong>
                <small>{m.valeurMicro == null ? "sans prix" : `${eurosMicro(Math.abs(m.valeurMicro))} HT`}</small>
                {apres != null && <small>stock {formaterEnUnite(apres, p.unite)}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {mouvements && mouvements.length >= 300 && <p className="explication">Les 300 derniers mouvements.</p>}
    </Modale>
  );
}
