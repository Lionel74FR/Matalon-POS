import { ficheFournisseur, formaterEnUnite, identifiantStock, nomsFournisseurs, normaliserNom, type Fournisseur } from "@matalon/stock";
import type { ReponseStock } from "@matalon/serveur/partage";
import { Check, Plus, Truck } from "lucide-react";
import { useState } from "react";
import { centimesDepuisSaisie, Modale, saisieDepuisCentimes } from "../ui/communs";
import { AvecIcone } from "../ui/icones";
import { api } from "./api";
import { euros } from "./stock-commun";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Fiches fournisseurs (communes au groupe) : e-mail où partent les bons de
 * commande, copies, interlocuteur, téléphone, franco, jours de livraison,
 * numéro de client de chaque établissement. Le nom de la fiche est celui des
 * articles fournisseurs : le changer renomme ses articles.
 */
export function OngletFournisseurs(props: { stock: ReponseStock; etab: string; nomEtab: string; onStock: (s: ReponseStock) => void }) {
  const ref = props.stock.referentiel;
  const [ouvert, setOuvert] = useState<Fournisseur | null>(null);
  const [archives, setArchives] = useState(false);
  const noms = nomsFournisseurs(ref, !archives);
  const ficheDe = (nom: string): Fournisseur => ficheFournisseur(ref, nom) ?? { id: "", nom, actif: true };
  return (
    <section className="admin-section">
      <div className="admin-ligne stock-filtres">
        <p className="explication">
          Les bons de commande partent à l'e-mail de la fiche. Un fournisseur sans fiche se commande par téléphone (« Marquer envoyée »).
        </p>
        <label className="case">
          <input type="checkbox" checked={archives} onChange={(e) => setArchives(e.target.checked)} />
          Archivés
        </label>
        <button className="bouton principal" onClick={() => setOuvert({ id: "", nom: "", actif: true })}>
          <AvecIcone icone={Plus}>Nouveau fournisseur</AvecIcone>
        </button>
      </div>
      {!noms.length ? (
        <p className="explication">Aucun fournisseur : ils viennent des articles fournisseurs des produits (ou d'un import), ou d'une fiche créée ici.</p>
      ) : (
        <table className="tableau admin-tableau stock-table">
          <thead>
            <tr>
              <th>Fournisseur</th>
              <th>E-mail de commande</th>
              <th>Contact</th>
              <th>N° client ({props.nomEtab})</th>
              <th className="nombre">Articles</th>
            </tr>
          </thead>
          <tbody>
            {noms.map((nom) => {
              const f = ficheFournisseur(ref, nom);
              const n = ref.articles.filter((a) => a.actif && normaliserNom(a.fournisseur) === normaliserNom(nom)).length;
              return (
                <tr key={nom} className={f && !f.actif ? "annule" : ""}>
                  <td>
                    <button className="lien-article" onClick={() => setOuvert(ficheDe(nom))}>
                      {nom}
                    </button>
                    {!f && <small>pas de fiche</small>}
                    {f?.livraison && <small>{f.livraison}</small>}
                  </td>
                  <td>{f?.courriel ?? <span className="cout-manquant">à saisir</span>}</td>
                  <td>{[f?.contact, f?.telephone].filter(Boolean).join(" · ") || "—"}</td>
                  <td>{f?.comptes?.find((c) => c.etablissementId === props.etab)?.numeroClient ?? "—"}</td>
                  <td className="nombre">{n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {ouvert && (
        <ModaleFournisseur
          key={ouvert.id || ouvert.nom || "nouveau"}
          fournisseur={ouvert}
          stock={props.stock}
          onEnregistre={(s) => {
            props.onStock(s);
            setOuvert(null);
          }}
          onFermer={() => setOuvert(null)}
        />
      )}
    </section>
  );
}

function ModaleFournisseur(props: { fournisseur: Fournisseur; stock: ReponseStock; onEnregistre: (s: ReponseStock) => void; onFermer: () => void }) {
  const ref = props.stock.referentiel;
  const f0 = props.fournisseur;
  const [f, setF] = useState<Fournisseur>(f0);
  const [copies, setCopies] = useState((f0.copies ?? []).join(", "));
  const [franco, setFranco] = useState(saisieDepuisCentimes(f0.francoHT ?? null));
  const [comptes, setComptes] = useState<Record<string, string>>(Object.fromEntries((f0.comptes ?? []).map((c) => [c.etablissementId, c.numeroClient])));
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const articles = ref.articles.filter((a) => normaliserNom(a.fournisseur) === normaliserNom(f0.nom || "\u0000"));
  const champ = (cle: "nom" | "courriel" | "contact" | "telephone" | "livraison" | "note") => ({
    value: f[cle] ?? "",
    onChange: (e: { target: { value: string } }) => setF((x) => ({ ...x, [cle]: e.target.value })),
  });

  const enregistrer = async () => {
    if (!f.nom.trim()) return setErreur("Le nom est obligatoire.");
    const francoHT = franco.trim() ? centimesDepuisSaisie(franco) : null;
    if (franco.trim() && francoHT == null) return setErreur("Franco illisible (ex. 250 ou 250,00).");
    const id = f.id || identifiantStock(f.nom, (ref.fournisseurs ?? []).map((x) => x.id));
    const fiche: Fournisseur = {
      id,
      nom: f.nom.trim(),
      actif: f.actif,
      ...(f.courriel?.trim() ? { courriel: f.courriel.trim() } : {}),
      ...(copies.trim() ? { copies: copies.split(/[,;\s]+/).filter(Boolean) } : {}),
      ...(f.contact?.trim() ? { contact: f.contact.trim() } : {}),
      ...(f.telephone?.trim() ? { telephone: f.telephone.trim() } : {}),
      ...(francoHT ? { francoHT } : {}),
      ...(f.livraison?.trim() ? { livraison: f.livraison.trim() } : {}),
      ...(f.note?.trim() ? { note: f.note.trim() } : {}),
      comptes: Object.entries(comptes)
        .filter(([, n]) => n.trim())
        .map(([etablissementId, n]) => ({ etablissementId, numeroClient: n.trim() })),
    };
    setEnCours(true);
    try {
      props.onEnregistre(await api.enregistrerFournisseur(fiche));
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Modale lateral
      large
      titre={f0.id ? f0.nom : f0.nom ? `Fiche de ${f0.nom}` : "Nouveau fournisseur"}
      onFermer={props.onFermer}
      pied={
        <>
          {f0.id && (
            <label className="case">
              <input type="checkbox" checked={!f.actif} onChange={(e) => setF((x) => ({ ...x, actif: !e.target.checked }))} />
              Archivé
            </label>
          )}
          <button className="bouton principal" disabled={enCours} onClick={() => void enregistrer()}>
            <AvecIcone icone={Check}>Enregistrer</AvecIcone>
          </button>
        </>
      }
    >
      <div className="formulaire-fournisseur">
        <label className="champ">
          <span>Nom</span>
          {/* Fiche d'un fournisseur venu des articles : son nom est celui des articles (renommable une fois la fiche créée). */}
          <input {...champ("nom")} maxLength={80} autoFocus={!f0.nom} readOnly={!f0.id && !!f0.nom} />
        </label>
        {f0.id && f.nom.trim() && normaliserNom(f.nom) !== normaliserNom(f0.nom) && <p className="explication">Ses {articles.length} article(s) prendront ce nouveau nom.</p>}
        <label className="champ">
          <span>E-mail de commande</span>
          <input {...champ("courriel")} type="email" maxLength={120} placeholder="commandes@fournisseur.fr" />
        </label>
        <label className="champ">
          <span>En copie (3 au plus, séparés par des virgules)</span>
          <input value={copies} onChange={(e) => setCopies(e.target.value)} placeholder="representant@fournisseur.fr" />
        </label>
        <label className="champ">
          <span>Contact (représentant)</span>
          <input {...champ("contact")} maxLength={80} />
        </label>
        <label className="champ">
          <span>Téléphone</span>
          <input {...champ("telephone")} type="tel" maxLength={30} />
        </label>
        <label className="champ">
          <span>Franco de port (€ HT)</span>
          <input value={franco} inputMode="decimal" onChange={(e) => setFranco(e.target.value)} placeholder="Facultatif" />
        </label>
        <label className="champ">
          <span>Livraison (jours, délai, heure limite)</span>
          <input {...champ("livraison")} maxLength={200} placeholder="Ex. mardi et vendredi, commande la veille avant 12 h" />
        </label>
        {props.stock.etablissements.map((e) => (
          <label key={e.id} className="champ">
            <span>N° de client · {e.enseigne}</span>
            <input value={comptes[e.id] ?? ""} maxLength={40} onChange={(x) => setComptes((c) => ({ ...c, [e.id]: x.target.value }))} />
          </label>
        ))}
        <label className="champ">
          <span>Note</span>
          <input {...champ("note")} maxLength={1000} />
        </label>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      {articles.length > 0 && (
        <>
          <h3 className="titre-icone">
            <AvecIcone icone={Truck} taille={18}>{`Articles (${articles.length})`}</AvecIcone>
          </h3>
          <ul className="liste-articles-fournisseur">
            {articles.map((a) => {
              const p = ref.produits.find((x) => x.id === a.produitId);
              const prix = props.stock.prix.filter((x) => x.articleId === a.id).sort((x, y) => y.le.localeCompare(x.le))[0];
              return (
                <li key={a.id} className={a.actif ? "" : "annule"}>
                  <strong>{p?.nom ?? a.produitId}</strong>
                  <small>
                    {a.conditionnement}
                    {p ? ` · ${formaterEnUnite(a.quantite, p.unite)}` : ""}
                    {a.reference ? ` · réf. ${a.reference}` : ""}
                    {prix ? ` · ${euros(prix.prixHT)} HT` : ""}
                  </small>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modale>
  );
}
