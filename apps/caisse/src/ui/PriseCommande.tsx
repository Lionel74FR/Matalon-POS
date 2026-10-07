import { ArrowLeft, ArrowRightLeft, BookOpen, CreditCard, DoorOpen, Link2, Printer, Send, StickyNote, Users } from "lucide-react";
import { AvecIcone, BoutonIcone } from "./icones";
import { NOM_APPAREIL } from "../donnees/appareil";
import { articleVendable, type Article, type Catalogue, type Categorie } from "@matalon/catalogue";
import { useMemo, useState } from "react";
import { carteDe, ID_COMPTOIR } from "../donnees/configuration";
import { gabaritAddition } from "../impression/gabarits";
import { ajouterLigne, commandeAGarder, lignesActives, modifierLigne, montantLigne, totauxCommande, type Commande, type LigneCommande } from "../metier/commande";
import { nbLignesAEnvoyer } from "../metier/production";
import { Vide } from "./communs";
import { euros, useCaisse } from "./contexte";
import { ModaleArticle } from "./modales/ModaleArticle";
import { ModaleCouverts } from "./modales/ModaleCouverts";
import { ModaleEncaissement } from "./modales/ModaleEncaissement";
import { ModaleLigne } from "./modales/ModaleLigne";
import { ModaleAssembler, ModaleNoteCommande, ModaleTransfert } from "./modales/ModaleTransfert";
import { productionActive, useEnvoiProduction } from "./production";

const TEINTES: Record<string, string> = {
  Boissons: "cafe",
  Bar: "prune",
  Cuisine: "olive",
  Goûter: "caramel",
  "À partager": "lac",
  Formules: "terre",
  Ateliers: "ardoise",
};

interface ProprietesCommande {
  titre: string;
  commande: Commande;
  /** Tables déjà ouvertes (assemblées comprises), pour le transfert. */
  tablesOuvertes: Set<string>;
  /** Tables occupées par d'autres commandes, pour l'assemblage. */
  occupeesAilleurs: Set<string>;
  onTransferer: (versTableId: string) => void;
  onChange: (c: Commande) => void;
  /** Mise à jour appliquée à la dernière version de la commande (après une impression). */
  onMaj: (f: (c: Commande) => Commande) => void;
  onTerminee: () => void;
  onRetour: () => void;
}

/** La carte vient de l'établissement (référentiel serveur). */
export function PriseCommande(props: ProprietesCommande) {
  const { config } = useCaisse();
  const carte = carteDe(config);
  if (!carte) {
    return (
      <div className="page">
        <Vide>
          La carte de l'établissement n'a pas encore été reçue. Connectez l'{NOM_APPAREIL} à Internet, puis touchez la pastille de
          synchronisation en haut à droite.
        </Vide>
        <button className="bouton" onClick={props.onRetour}>
          <AvecIcone icone={ArrowLeft}>Retour à la salle</AvecIcone>
        </button>
      </div>
    );
  }
  return <PriseCommandeCarte {...props} carte={carte} />;
}

function PriseCommandeCarte(props: ProprietesCommande & { carte: Catalogue }) {
  const { caisse, config, utilisateur, notifier, imprimer, imprimanteConfiguree } = useCaisse();
  const c = props.commande;
  const CARTE = props.carte;
  const RAYONS = useMemo(() => [...new Set(CARTE.categories.map((x) => x.rayon))], [CARTE]);
  const [rayon, setRayon] = useState(RAYONS[0]!);
  const categories = useMemo(() => CARTE.categories.filter((x) => x.rayon === rayon), [CARTE, rayon]);
  const [categorieId, setCategorieId] = useState<string | null>(null);
  const categorie: Categorie = categories.find((x) => x.id === categorieId) ?? categories[0]!;
  const [articleOuvert, setArticleOuvert] = useState<Article | null>(null);
  const [ligneOuverte, setLigneOuverte] = useState<LigneCommande | null>(null);
  const [couvertsOuvert, setCouvertsOuvert] = useState(false);
  const [encaissement, setEncaissement] = useState(false);
  const [transfertOuvert, setTransfertOuvert] = useState(false);
  const [noteOuverte, setNoteOuverte] = useState(false);
  const [assemblageOuvert, setAssemblageOuvert] = useState(false);
  /** Sur téléphone, la commande s'ouvre par-dessus la carte. */
  const [ticketOuvert, setTicketOuvert] = useState(false);
  const totaux = totauxCommande(c);
  const estComptoir = c.tableId === ID_COMPTOIR;
  /** Articles qui comptent (les lignes retirées restent affichées barrées). */
  const nbActives = lignesActives(c).length;
  const production = productionActive(config);
  const envoyerProduction = useEnvoiProduction();
  const nbAEnvoyer = nbLignesAEnvoyer(c, production);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const envoyer = async (commande: Commande, o: { annulationsSeules?: boolean } = {}) => {
    setEnvoiEnCours(true);
    try {
      const maj = await envoyerProduction(commande, CARTE, o);
      if (maj) props.onMaj(maj);
    } finally {
      setEnvoiEnCours(false);
    }
  };

  const ajouter = (l: Omit<LigneCommande, "uid" | "ajouteeLe" | "ajouteePar">) =>
    props.onChange(ajouterLigne(c, { ...l, ajouteePar: utilisateur.id }));

  const toucherArticle = (a: Article) => {
    if (!articleVendable(CARTE, a)) return notifier(`${a.nom} est indisponible pour le moment.`, "erreur");
    if (a.prixTTC == null && !a.variantes?.some((v) => v.prixTTC != null)) {
      return notifier(`${a.nom} n'a pas encore de prix : à compléter dans la carte.`, "erreur");
    }
    if (a.variantes?.length || a.supplements?.length || a.formule?.length) return setArticleOuvert(a);
    ajouter({ articleId: a.id, libelle: a.nom, details: [], quantite: 1, prixUnitaireTTC: a.prixTTC!, tauxTVA: a.tauxTVA });
  };

  const imprimerAddition = async () => {
    await imprimer(gabaritAddition(c, config, utilisateur.id), "Addition");
    await caisse.registre.journaliser(
      "IMPRESSION_ADDITION",
      { table: c.tableId, totalTTC: totaux.totalTTC, nbArticles: totaux.nbArticles, canal: imprimanteConfiguree ? "papier" : "ecran" },
      utilisateur.id,
    );
    props.onChange({ ...c, additionsImprimees: c.additionsImprimees + 1 });
  };

  return (
    <div className="prise-commande">
      <aside className={`ticket-papier${ticketOuvert ? " ouvert" : ""}`} aria-label="Commande en cours">
        <header className="ticket-tete">
          <BoutonIcone icone={ArrowLeft} variante="discret" libelle="Retour à la salle" onClick={props.onRetour} />
          <div className="ticket-titre">
            <h1>{props.titre}</h1>
            {!estComptoir && (
              <button className="lien" onClick={() => setCouvertsOuvert(true)}>
                <AvecIcone icone={Users} taille={18}>
                  {c.couverts ? `${c.couverts} couvert${c.couverts > 1 ? "s" : ""}` : "Indiquer les couverts"}
                </AvecIcone>
              </button>
            )}
          </div>
          <div className="ticket-outils">
            <BoutonIcone icone={StickyNote} variante="discret" libelle="Note sur la commande" onClick={() => setNoteOuverte(true)} />
            {!estComptoir && (
              <BoutonIcone icone={Link2} variante="discret" libelle="Assembler des tables" onClick={() => setAssemblageOuvert(true)} />
            )}
            <BoutonIcone icone={ArrowRightLeft} variante="discret" libelle="Transférer vers une autre table" disabled={!commandeAGarder(c)} onClick={() => setTransfertOuvert(true)} />
          </div>
          <button className="bouton fermer-mobile" onClick={() => setTicketOuvert(false)}>
            <AvecIcone icone={BookOpen}>Carte</AvecIcone>
          </button>
        </header>
        {c.note && (
          <button className="ticket-note" onClick={() => setNoteOuverte(true)}>
            {c.note}
          </button>
        )}
        <ol className="ticket-lignes">
          {c.lignes.length === 0 && <Vide>Touchez un article pour l'ajouter.</Vide>}
          {c.lignes.map((l) => (
            <li key={l.uid}>
              <button
                className={`ticket-ligne${l.retiree ? " retiree" : ""}`}
                disabled={!!l.retiree}
                aria-label={l.retiree ? `${l.quantite} ${l.libelle}, retiré de la commande` : undefined}
                onClick={() => setLigneOuverte(l)}
              >
                <span className="qte">{l.quantite}</span>
                <span className="libelle">
                  <span className="libelle-texte">{l.libelle}</span>
                  {l.details.length > 0 && <small>{l.details.join(" · ")}</small>}
                  {l.note && <small className="note-ligne">{l.note}</small>}
                  {l.retiree && <small className="mention-retiree">Retiré de la commande</small>}
                  {l.envoyee && !l.retiree && <small className="mention-envoyee">Envoyé</small>}
                  {production && l.envoyee && l.retiree && !l.annulationEnvoyee && <small className="mention-envoyee">Annulation à envoyer</small>}
                  {l.remise && (
                    <small className="remise">
                      {l.remise.montantTTC === l.quantite * l.prixUnitaireTTC ? "Offert" : `Remise ${euros(l.remise.montantTTC)}`} ·{" "}
                      {l.remise.motif}
                    </small>
                  )}
                </span>
                <span className="montant">{euros(montantLigne(l))}</span>
              </button>
            </li>
          ))}
        </ol>
        <footer className="ticket-pied">
          <div className="ticket-total">
            <span>Total</span>
            <strong>{euros(totaux.totalTTC)}</strong>
          </div>
          <div className="ticket-actions">
            <button className="bouton" disabled={nbAEnvoyer === 0 || envoiEnCours} onClick={() => void envoyer(c)}>
              <AvecIcone icone={Send}>{nbAEnvoyer ? `Envoyer (${nbAEnvoyer})` : c.lignes.some((l) => l.envoyee) ? "Envoyé" : "Envoyer"}</AvecIcone>
            </button>
            {!estComptoir && (
              <button className="bouton" disabled={nbActives === 0} onClick={() => void imprimerAddition()}>
                <AvecIcone icone={Printer}>Addition</AvecIcone>
              </button>
            )}
            {nbActives === 0 && commandeAGarder(c) ? (
              <button className="bouton" onClick={props.onTerminee}>
                <AvecIcone icone={DoorOpen}>{estComptoir ? "Vider" : "Libérer la table"}</AvecIcone>
              </button>
            ) : (
              <button className="bouton principal" disabled={nbActives === 0} onClick={() => setEncaissement(true)}>
                <AvecIcone icone={CreditCard}>Encaisser</AvecIcone>
              </button>
            )}
          </div>
        </footer>
      </aside>

      <section className="carte" aria-label="Carte">
        <div className="rayons" role="tablist">
          {RAYONS.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === rayon}
              className={`rayon teinte-${TEINTES[r] ?? "cafe"}`}
              onClick={() => {
                setRayon(r);
                setCategorieId(null);
              }}
            >
              {r}
            </button>
          ))}
        </div>
        {categories.length > 1 && (
          <div className="categories">
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`pastille${cat.id === categorie.id ? " active" : ""}`}
                onClick={() => setCategorieId(cat.id)}
              >
                {cat.nom}
              </button>
            ))}
          </div>
        )}
        <div className={`grille-articles teinte-${TEINTES[rayon] ?? "cafe"}`}>
          {categorie.articles.map((a) => (
            <button
              key={a.id}
              className={`tuile${a.prixTTC == null && !a.variantes?.some((v) => v.prixTTC != null) ? " incomplete" : ""}${!articleVendable(CARTE, a) ? " indisponible" : ""}`}
              onClick={() => toucherArticle(a)}
            >
              <span className="tuile-nom">{a.nom}</span>
              <span className="tuile-prix">
                {!articleVendable(CARTE, a) ? "Indisponible" : a.prixTTC != null ? euros(a.prixTTC) : "Prix à venir"}
                {(a.variantes?.length || a.formule?.length) && <span className="tuile-plus"> · choix</span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      <button className="resume-mobile" onClick={() => setTicketOuvert(true)}>
        <span>
          {props.titre} · {totaux.nbArticles} article{totaux.nbArticles > 1 ? "s" : ""}
        </span>
        <strong>{euros(totaux.totalTTC)}</strong>
      </button>

      {articleOuvert && (
        <ModaleArticle
          article={articleOuvert}
          carte={CARTE}
          onAjouter={(lignes) => {
            let suite = c;
            for (const l of lignes) suite = ajouterLigne(suite, { ...l, ajouteePar: utilisateur.id });
            props.onChange(suite);
            setArticleOuvert(null);
          }}
          onFermer={() => setArticleOuvert(null)}
        />
      )}
      {ligneOuverte && (
        <ModaleLigne
          ligne={ligneOuverte}
          tableId={c.tableId}
          onChange={(nouvelle, unitesRetirees) => {
            const suite = modifierLigne(c, ligneOuverte.uid, nouvelle, unitesRetirees, utilisateur.id);
            props.onChange(suite);
            // Retrait d'un article déjà parti : le poste reçoit aussitôt un bon d'annulation.
            if (production && ligneOuverte.envoyee && unitesRetirees > 0) void envoyer(suite, { annulationsSeules: true });
            setLigneOuverte(null);
          }}
          onFermer={() => setLigneOuverte(null)}
        />
      )}
      {transfertOuvert && (
        <ModaleTransfert
          depuis={c.tableId}
          tablesOuvertes={props.tablesOuvertes}
          {...(c.jointes ? { jointes: c.jointes } : {})}
          onChoisir={(t) => {
            setTransfertOuvert(false);
            props.onTransferer(t);
          }}
          onFermer={() => setTransfertOuvert(false)}
        />
      )}
      {assemblageOuvert && (
        <ModaleAssembler
          tableId={c.tableId}
          jointes={c.jointes ?? []}
          occupees={props.occupeesAilleurs}
          onValider={(jointes) => {
            const { jointes: _, ...reste } = c;
            props.onChange(jointes.length ? { ...reste, jointes } : reste);
            setAssemblageOuvert(false);
          }}
          onFermer={() => setAssemblageOuvert(false)}
        />
      )}
      {noteOuverte && (
        <ModaleNoteCommande
          note={c.note ?? ""}
          onValider={(note) => {
            props.onChange({ ...c, note: note.trim() || undefined });
            setNoteOuverte(false);
          }}
          onFermer={() => setNoteOuverte(false)}
        />
      )}
      {couvertsOuvert && (
        <ModaleCouverts
          valeur={c.couverts}
          onValider={(n) => {
            props.onChange({ ...c, couverts: n });
            setCouvertsOuvert(false);
          }}
          onFermer={() => setCouvertsOuvert(false)}
        />
      )}
      {encaissement && (
        <ModaleEncaissement commande={c} onTermine={props.onTerminee} onFermer={() => setEncaissement(false)} />
      )}
    </div>
  );
}
