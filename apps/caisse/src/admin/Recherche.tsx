import type { Catalogue } from "@matalon/catalogue";
import { dateComptable, type Ticket } from "@matalon/noyau-fiscal";
import type { ReponseComptes, ReponseStock } from "@matalon/serveur/partage";
import { normaliserNom } from "@matalon/stock";
import { ArrowRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { HEURE_BASCULE } from "../fiscal/caisse";
import { api, type EtablissementAdmin } from "./api";
import { FAMILLES, TOUTES_RUBRIQUES, type Rubrique } from "./Coque";

/**
 * Recherche universelle de l'administration (⌘K ou Ctrl+K, refonte du 25 octobre 2026) : articles
 * de la carte, produits et fiches techniques, personnes, clients, tickets du jour, et saut direct
 * vers une rubrique ou une sous-page. Tout se cherche dans le navigateur, sur des données lues une
 * fois par minute au plus.
 */

export interface Destination {
  rubrique: Rubrique;
  sous?: string | null;
  carte?: string;
  /** Élément à ouvrir à l'arrivée : un produit, une recette, une personne, un client, un article. */
  cible?: string;
  /** Ticket à ouvrir (rubrique Tickets). */
  ticket?: { caisseId: string; numero: number; jour: string };
}

interface Resultat {
  cle: string;
  groupe: string;
  titre: string;
  detail?: string;
  valeur?: string;
  destination: Destination;
}

interface Donnees {
  lu: number;
  carte: Catalogue | null;
  stock: ReponseStock | null;
  comptes: ReponseComptes | null;
  tickets: Ticket[];
  jour: string;
}

/** Données lues pour la recherche, par établissement : relues au plus une fois par minute. */
const cache = new Map<string, Donnees>();

const SOUS_PAGES: Array<{ rubrique: Rubrique; sous: string; libelle: string; mots?: string }> = [
  { rubrique: "stock", sous: "etat", libelle: "Stock › État du stock", mots: "pièces quantités" },
  { rubrique: "stock", sous: "commandes", libelle: "Stock › Commandes", mots: "bon fournisseur" },
  { rubrique: "stock", sous: "reception", libelle: "Stock › Réception", mots: "livraison" },
  { rubrique: "stock", sous: "inventaire", libelle: "Stock › Inventaire", mots: "comptage nouvel inventaire" },
  { rubrique: "stock", sous: "perte", libelle: "Stock › Pertes", mots: "casse" },
  { rubrique: "stock", sous: "transfert", libelle: "Stock › Transferts" },
  { rubrique: "stock", sous: "recettes", libelle: "Stock › Recettes", mots: "fiches techniques" },
  { rubrique: "stock", sous: "fournisseurs", libelle: "Stock › Fournisseurs" },
  { rubrique: "stock", sous: "import", libelle: "Stock › Importer des produits", mots: "excel csv" },
  { rubrique: "stock", sous: "foodcost", libelle: "Stock › Food cost", mots: "marge coût matière" },
  { rubrique: "stock", sous: "factures", libelle: "Stock › Factures", mots: "agent" },
  { rubrique: "reservations", sous: "reglages", libelle: "Réservations › Services et réglages", mots: "capacité horaires e-mail resend" },
  { rubrique: "reservations", sous: "site", libelle: "Réservations › Sur votre site", mots: "module code bouton" },
];

const euros = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", " h ");

/** Chaque mot de la recherche doit se trouver dans le texte (accents et majuscules ignorés). */
function correspond(texte: string, mots: string[]): boolean {
  const t = normaliserNom(texte);
  return mots.every((m) => t.includes(m));
}

export function Recherche(props: { e: EtablissementAdmin; onAller: (d: Destination) => void; onFermer: () => void }) {
  const { e } = props;
  const [q, setQ] = useState("");
  const [donnees, setDonnees] = useState<Donnees | null>(() => cache.get(e.id) ?? null);
  const [actif, setActif] = useState(0);
  const liste = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    champ.current?.focus();
    const deja = cache.get(e.id);
    if (deja && Date.now() - deja.lu < 60_000) return;
    const jour = dateComptable(new Date(), HEURE_BASCULE);
    // Chaque source est facultative : une erreur n'empêche pas de chercher dans les autres.
    void Promise.all([
      api.carte(e.carteId).then((r) => r.carte, () => null),
      api.stock().catch(() => null),
      api.comptes(e.id).catch(() => null),
      api.ticketsPeriode(e.id, jour, jour).then((r) => r.tickets, () => [] as Ticket[]),
    ]).then(([carte, stock, comptes, tickets]) => {
      const d = { lu: Date.now(), carte, stock, comptes, tickets, jour };
      cache.set(e.id, d);
      setDonnees(d);
    });
  }, [e.id, e.carteId]);

  const resultats = useMemo<Resultat[]>(() => {
    const mots = normaliserNom(q).split(/\s+/).filter(Boolean);
    const r: Resultat[] = [];
    const ajouter = (groupe: string, liste: Resultat[], max = 5) => r.push(...liste.slice(0, max).map((x) => ({ ...x, groupe })));
    // Aller à : rubriques et sous-pages ; sans recherche, les rubriques d'usage courant.
    const rubriques = TOUTES_RUBRIQUES.filter((x) => !mots.length || correspond(`${x.libelle} ${x.aide} ${FAMILLES.find((f) => f.liste.includes(x))?.nom ?? ""}`, mots)).map(
      (x): Resultat => ({ cle: `r:${x.id}`, groupe: "", titre: x.libelle, detail: x.aide, destination: { rubrique: x.id } }),
    );
    const sous = mots.length
      ? SOUS_PAGES.filter((x) => correspond(`${x.libelle} ${x.mots ?? ""}`, mots)).map((x): Resultat => ({ cle: `s:${x.rubrique}/${x.sous}`, groupe: "", titre: x.libelle, destination: { rubrique: x.rubrique, sous: x.sous } }))
      : [];
    if (!mots.length) {
      ajouter("Aller à", rubriques, 8);
      return r;
    }
    const d = donnees;
    if (d?.carte) {
      const articles = new Map<string, Resultat>();
      for (const cat of d.carte.categories)
        for (const a of cat.articles)
          if (correspond(`${a.nom} ${cat.nom}`, mots))
            articles.set(a.id, { cle: `a:${a.id}`, groupe: "", titre: a.nom, detail: cat.nom, ...(a.prixTTC != null ? { valeur: euros(a.prixTTC) } : {}), destination: { rubrique: "cartes", carte: e.carteId, cible: a.id } });
      ajouter("Carte", [...articles.values()]);
    }
    if (d?.stock) {
      const ref = d.stock.referentiel;
      ajouter("Stock et fiches", [
        ...ref.recettes
          .filter((x) => x.actif && correspond(`${x.nom} ${x.famille ?? ""} fiche technique recette`, mots))
          .map((x): Resultat => ({ cle: `rc:${x.id}`, groupe: "", titre: x.nom, detail: `Fiche technique${x.famille ? ` · ${x.famille}` : ""}`, destination: { rubrique: "stock", sous: "recettes", cible: x.id } })),
        ...ref.produits
          .filter((x) => x.actif && correspond(`${x.nom} ${x.famille ?? ""} ${x.zone ?? ""} produit`, mots))
          .map((x): Resultat => ({ cle: `p:${x.id}`, groupe: "", titre: x.nom, detail: `Produit${x.famille ? ` · ${x.famille}` : ""}`, destination: { rubrique: "stock", cible: x.id } })),
      ]);
    }
    ajouter(
      "Personnes",
      e.utilisateurs
        .filter((u) => correspond(`${u.nom} ${u.role} équipe`, mots))
        .map((u): Resultat => ({ cle: `u:${u.id}`, groupe: "", titre: u.nom, detail: `${u.role === "responsable" ? "Responsable" : "Serveur"}${u.actif ? "" : " · désactivé"}`, destination: { rubrique: "equipe", cible: u.id } })),
    );
    if (d?.comptes)
      ajouter(
        "Clients",
        d.comptes.comptes
          .filter((c) => correspond(`${c.client.nom} ${c.client.telephone} ${c.client.email ?? ""}`, mots))
          .map((c): Resultat => ({ cle: `c:${c.client.id}`, groupe: "", titre: c.client.nom, detail: c.soldeTTC ? `doit ${euros(c.soldeTTC)}` : "compte soldé", destination: { rubrique: "comptes", cible: c.client.id } })),
      );
    if (d?.tickets.length) {
      const nomTable = (id: string | null) => (!id || id === "comptoir" ? "Comptoir" : `T${e.tables.find((t) => t.id === id)?.nom ?? id}`);
      ajouter(
        "Tickets du jour",
        [...d.tickets]
          .reverse()
          .filter((t) => correspond(`n ${t.numero} ${t.numero} ${nomTable(t.tableId)} ${(t.totalTTC / 100).toFixed(2).replace(".", ",")} ${t.lignes.map((l) => l.libelle).join(" ")}`, mots))
          .map((t): Resultat => {
            const lignes = t.lignes.slice(0, 2).map((l) => `${l.libelle}${l.quantite > 1 ? ` × ${l.quantite}` : ""}`).join(", ");
            return {
              cle: `t:${t.caisseId}#${t.numero}`,
              groupe: "",
              titre: `Ticket n° ${t.numero} · ${heure(t.horodatage)} · ${nomTable(t.tableId)}`,
              detail: lignes,
              valeur: euros(t.totalTTC),
              destination: { rubrique: "tickets", ticket: { caisseId: t.caisseId, numero: t.numero, jour: d.jour } },
            };
          }),
      );
    }
    ajouter("Aller à", [...rubriques, ...sous], 6);
    return r;
  }, [q, donnees, e]);

  useEffect(() => setActif(0), [q]);
  useEffect(() => {
    liste.current?.querySelector(`[data-index="${actif}"]`)?.scrollIntoView({ block: "nearest" });
  }, [actif]);

  const aller = (x: Resultat | undefined) => {
    if (!x) return;
    props.onFermer();
    props.onAller(x.destination);
  };
  const touche = (ev: KeyboardEvent) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActif((a) => Math.min(resultats.length - 1, a + 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActif((a) => Math.max(0, a - 1));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      aller(resultats[actif]);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      props.onFermer();
    }
  };

  const chargement = !donnees && q.trim() !== "";
  let groupePrecedent = "";
  return (
    <div className="a-recherche-voile" onPointerDown={(ev) => ev.target === ev.currentTarget && props.onFermer()}>
      <div className="a-recherche" role="dialog" aria-modal="true" aria-label="Recherche">
        <label className="a-recherche-champ">
          <Search className="icone" size={20} aria-hidden="true" />
          <span className="lecteur-ecran">Rechercher</span>
          <input
            ref={champ}
            type="text"
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            onKeyDown={touche}
            placeholder="Un article, une fiche, un produit, un ticket, une personne…"
            role="combobox"
            aria-expanded="true"
            aria-controls="a-recherche-resultats"
            aria-activedescendant={resultats[actif] ? `a-recherche-${actif}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="a-recherche-fermer" onClick={props.onFermer} aria-label="Fermer la recherche">
            <kbd>Échap</kbd>
            <span>Fermer</span>
          </button>
        </label>
        <div ref={liste} id="a-recherche-resultats" className="a-recherche-resultats" role="listbox" aria-label="Résultats">
          {resultats.length === 0 ? (
            <p className="a-recherche-vide">{chargement ? "Chargement…" : `Rien ne correspond à « ${q} ».`}</p>
          ) : (
            resultats.map((x, i) => {
              const titreGroupe = x.groupe !== groupePrecedent ? x.groupe : null;
              groupePrecedent = x.groupe;
              return (
                <div key={x.cle} role="presentation">
                  {titreGroupe && (
                    <p className="a-recherche-groupe" role="presentation">
                      {titreGroupe}
                    </p>
                  )}
                  <div
                    id={`a-recherche-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === actif}
                    className="a-recherche-resultat"
                    onPointerMove={() => i !== actif && setActif(i)}
                    onClick={() => aller(x)}
                  >
                    <span className="a-recherche-titre">{x.titre}</span>
                    {x.detail && <small>{x.detail}</small>}
                    {x.valeur && <span className="chiffres a-recherche-valeur">{x.valeur}</span>}
                    {x.groupe === "Aller à" && <ArrowRight size={16} aria-hidden="true" className="a-recherche-fleche" />}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <p className="a-recherche-pied" aria-hidden="true">
          <span>↑ ↓ choisir</span>
          <span>↵ ouvrir</span>
          <span>{/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl+K"} depuis n'importe quel écran</span>
        </p>
      </div>
    </div>
  );
}
