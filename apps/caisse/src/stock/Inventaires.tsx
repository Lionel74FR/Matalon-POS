import { formaterEnUnite, normaliserNom, type Referentiel } from "@matalon/stock";
import type { DocumentStock, EtatStock } from "@matalon/serveur/partage";
import { ClipboardList, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { eurosMicro } from "../admin/stock-commun";
import { Modale } from "../ui/communs";
import { AvecIcone } from "../ui/icones";
import { dateLongue, FormulaireInventaire } from "./OperationsStock";
import "./stock.css";

/**
 * Onglet Inventaire (caisse et administration) : les inventaires déjà faits
 * d'abord, chacun avec son détail (compté, théorique, écart), puis
 * « Nouvel inventaire » pour un comptage, du jour ou d'un jour passé.
 */

interface LigneInventaire {
  produitId: string;
  compte: number;
  theorique: number;
  ecart: number;
  valeurEcart: number | null;
  ouverture?: boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const lignesDe = (d: DocumentStock) => ((d.contenu.lignes as LigneInventaire[] | undefined) ?? []);
/** Journée du comptage : celle de la pièce (inventaires d'avant la date saisie : leur horodatage). */
const journee = (d: DocumentStock) => (typeof d.contenu.date === "string" ? d.contenu.date : new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date(d.le)));
const ouverture = (d: DocumentStock) => lignesDe(d).length > 0 && lignesDe(d).every((l) => l.ouverture);

export function Inventaires(props: {
  referentiel: Referentiel;
  etat: EtatStock | null;
  charger: () => Promise<DocumentStock[]>;
  onEnregistrer: (corps: Record<string, unknown>) => Promise<unknown>;
}) {
  const { charger } = props;
  const [nouveau, setNouveau] = useState(false);
  const [liste, setListe] = useState<DocumentStock[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [avis, setAvis] = useState("");
  const [ouvert, setOuvert] = useState<DocumentStock | null>(null);
  const recharger = useCallback(async () => {
    try {
      setListe(await charger());
      setErreur("");
    } catch (e) {
      setErreur(message(e));
    }
  }, [charger]);
  useEffect(() => {
    void recharger();
  }, [recharger]);

  if (nouveau) {
    if (!props.etat) return <p className="explication">Chargement du stock…</p>;
    return (
      <FormulaireInventaire
        referentiel={props.referentiel}
        etat={props.etat}
        onEnregistrer={props.onEnregistrer}
        onRetour={() => setNouveau(false)}
        onFait={(m) => {
          setAvis(m);
          setNouveau(false);
          void recharger();
        }}
      />
    );
  }

  return (
    <section className="operation-stock inventaires">
      <div className="commandes-tete">
        <h2 className="titre-icone">
          <AvecIcone icone={ClipboardList} taille={22}>Inventaires</AvecIcone>
        </h2>
        <button className="bouton principal" onClick={() => (setAvis(""), setNouveau(true))}>
          <AvecIcone icone={Plus}>Nouvel inventaire</AvecIcone>
        </button>
      </div>
      {avis && <p className="admin-ok succes">{avis}</p>}
      {erreur && <p className="erreur">{erreur}</p>}
      {!liste ? (
        !erreur && <p className="explication">Chargement des inventaires…</p>
      ) : !liste.length ? (
        <p className="explication">Aucun inventaire pour l'instant. Le premier inventaire d'un produit donne son stock d'ouverture.</p>
      ) : (
        <ul className="commandes-liste">
          {liste.map((d) => {
            const n = lignesDe(d).length;
            return (
              <li key={d.id}>
                <button className="commande-carte" onClick={() => setOuvert(d)}>
                  <span>
                    <strong>{dateLongue(journee(d))}</strong>
                    <small>
                      {d.contenu.zone ? String(d.contenu.zone) : "Produits choisis"} · {n} produit{n > 1 ? "s" : ""}
                      {d.par ? ` · ${d.par}` : ""}
                    </small>
                  </span>
                  <span className={`statut-commande${ouverture(d) ? " envoyee" : ""}`}>{ouverture(d) ? "Stock d'ouverture" : `Écart ${eurosMicro(Number(d.contenu.valeurEcart ?? 0))}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {ouvert && <DetailInventaire document={ouvert} referentiel={props.referentiel} onFermer={() => setOuvert(null)} />}
    </section>
  );
}

function DetailInventaire(props: { document: DocumentStock; referentiel: Referentiel; onFermer: () => void }) {
  const d = props.document;
  const [recherche, setRecherche] = useState("");
  const n = normaliserNom(recherche);
  const produits = new Map(props.referentiel.produits.map((p) => [p.id, p]));
  const toutes = lignesDe(d)
    .map((l) => ({ ...l, p: produits.get(l.produitId) }))
    .sort((a, b) => (a.p?.nom ?? a.produitId).localeCompare(b.p?.nom ?? b.produitId, "fr"));
  const lignes = n ? toutes.filter((l) => normaliserNom(l.p?.nom ?? l.produitId).includes(n)) : toutes;
  const q = (v: number, l: (typeof lignes)[number]) => (l.p ? formaterEnUnite(v, l.p.unite) : String(v));
  const valeurOuverture = toutes.filter((l) => l.ouverture).reduce((s, l) => s + (l.valeurEcart ?? 0), 0);
  return (
    <Modale large titre={`Inventaire du ${dateLongue(journee(d))}`} onFermer={props.onFermer}>
      <p className="explication">
        {d.contenu.zone ? `Zone ${String(d.contenu.zone)}` : "Produits choisis"} · {toutes.length} produit{toutes.length > 1 ? "s" : ""}
        {d.par ? ` · ${d.par}` : ""} · saisi le {new Date(d.creeLe).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
      </p>
      <p className="explication">
        Écart valorisé : <strong>{eurosMicro(Number(d.contenu.valeurEcart ?? 0))} HT</strong>
        {valeurOuverture !== 0 && ` · stock d'ouverture ${eurosMicro(valeurOuverture)} HT (premier inventaire, hors food cost)`}
      </p>
      <label className="operation-recherche">
        <Search className="icone" size={18} aria-hidden="true" />
        <input placeholder="Chercher un produit" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label="Chercher un produit dans l'inventaire" />
      </label>
      {n && !lignes.length && <p className="explication">Aucun produit de cet inventaire ne correspond à « {recherche} ».</p>}
      <table className="tableau inventaire-detail">
        <thead>
          <tr>
            <th>Produit</th>
            <th className="nombre">Compté</th>
            <th className="nombre">Théorique</th>
            <th className="nombre">Écart</th>
            <th className="nombre">Valeur HT</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.produitId} className={l.ecart < 0 && !l.ouverture ? "negatif" : ""}>
              <td>
                <strong>{l.p?.nom ?? l.produitId}</strong>
                {l.ouverture && <small>stock d'ouverture</small>}
              </td>
              <td className="nombre">{q(l.compte, l)}</td>
              <td className="nombre">{q(l.theorique, l)}</td>
              <td className="nombre">
                {l.ecart > 0 ? "+" : ""}
                {q(l.ecart, l)}
              </td>
              <td className="nombre">{l.valeurEcart == null ? "sans prix" : eurosMicro(l.valeurEcart)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modale>
  );
}
