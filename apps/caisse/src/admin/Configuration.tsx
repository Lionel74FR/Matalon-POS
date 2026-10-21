import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { Modale } from "../ui/communs";
import { AvecIcone } from "../ui/icones";
import { api } from "./api";

/**
 * Configuration de l'installation, pour une mise en service : « Exporter »
 * enregistre un fichier (établissements, équipe, plan, carte, stock,
 * commandes, réservations à venir — aucune vente) ; « Importer » le reprend
 * dans une installation neuve. Le serveur refuse l'import dès que la base a
 * servi (une vente, un appareil, une équipe, du stock).
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const LIBELLES: Record<string, string> = {
  etablissements: "établissements",
  utilisateurs: "personnes de l'équipe",
  cartes: "cartes",
  stock_referentiel: "référentiel du stock",
  prix_achats: "prix d'achat",
  stock_documents: "pièces de stock",
  stock_mouvements: "mouvements de stock",
  commandes_fournisseurs: "commandes fournisseurs",
  stock_reglages: "réglages des commandes",
  reservations_reglages: "réglages des réservations",
  reservations: "réservations à venir",
  fidelite_programmes: "programmes de fidélité",
  etablissements_logos: "logos",
};
const resume = (r: Record<string, number>) =>
  Object.entries(r)
    .map(([k, n]) => `${n} ${LIBELLES[k] ?? k}`)
    .join(" · ");

export function FenetreConfiguration(props: { onFermer: () => void; onImporte: () => void }) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [ok, setOk] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);

  const exporter = async () => {
    setEnCours(true);
    setErreur("");
    setOk("");
    try {
      const conf = await api.exporterConfiguration();
      const lien = document.createElement("a");
      lien.href = URL.createObjectURL(new Blob([JSON.stringify(conf)], { type: "application/json" }));
      lien.download = `matalon-configuration-${conf.exporteLe.slice(0, 10)}.json`;
      lien.click();
      setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
      setOk(`Configuration enregistrée : ${resume(Object.fromEntries(Object.entries(conf.tables).map(([k, v]) => [k, v.length])))}.`);
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  };

  const importer = async () => {
    if (!fichier) return;
    setEnCours(true);
    setErreur("");
    setOk("");
    try {
      const conf = JSON.parse(await fichier.text()) as unknown;
      const r = await api.importerConfiguration(conf);
      setOk(`Configuration importée : ${resume(r.importe)}.`);
      props.onImporte();
    } catch (e) {
      setErreur(e instanceof SyntaxError ? "Fichier illisible : choisissez le fichier .json exporté." : message(e));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Modale titre="Configuration de l'installation" onFermer={props.onFermer}>
      <section className="configuration-bloc">
        <h3>Exporter</h3>
        <p className="explication">
          Enregistre les établissements, l'équipe, le plan, l'imprimante des tickets, les cartes, le stock (produits, prix, inventaires, réceptions, commandes)
          et les réservations à venir. Aucune vente, aucun appareil ; la clé d'envoi des e-mails (Resend) se ressaisit dans la nouvelle installation.
        </p>
        <button className="bouton" disabled={enCours} onClick={() => void exporter()}>
          <AvecIcone icone={Download}>Exporter la configuration</AvecIcone>
        </button>
      </section>
      <section className="configuration-bloc">
        <h3>Importer (installation neuve)</h3>
        <p className="explication">
          Reprend un fichier exporté, seulement dans une installation qui n'a encore rien enregistré : ni vente, ni appareil, ni équipe, ni stock. Les appareils se
          rattachent ensuite avec des codes neufs.
        </p>
        <input type="file" accept="application/json,.json" aria-label="Fichier de configuration" onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
        <button className="bouton principal" disabled={enCours || !fichier} onClick={() => void importer()}>
          <AvecIcone icone={Upload}>Importer</AvecIcone>
        </button>
      </section>
      {erreur && <p className="erreur">{erreur}</p>}
      {ok && <p className="admin-ok succes">{ok}</p>}
    </Modale>
  );
}
