import { ficheFournisseur, formaterEnUnite, lireDecimal, nomsFournisseurs, normaliserNom, type PrixAchat, type Referentiel } from "@matalon/stock";
import type { CommandeFournisseur, EtatStock, ReponseCommandes } from "@matalon/serveur/partage";
import { ArrowLeft, Ban, Check, CircleCheck, Copy, Mail, PackagePlus, Phone, Plus, Save, Search, Send, Settings, ShoppingCart } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { euros } from "../admin/stock-commun";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { FormulaireReception } from "./OperationsStock";
import "./stock.css";

/**
 * Commandes fournisseurs, communes à la caisse (responsables) et à
 * l'administration : saisie d'un bon, envoi par e-mail à l'adresse de la fiche
 * du fournisseur (ou « marquée envoyée » quand elle passe par téléphone ou un
 * portail), suivi, réception de la livraison contre le bon, solde.
 */

export type ActionCommande = "creer" | "modifier" | "envoyer" | "solder" | "annuler";

export interface AccesCommandes {
  lister(): Promise<ReponseCommandes>;
  ecrire(id: string | null, action: ActionCommande, corps: Record<string, unknown>): Promise<{ commande: CommandeFournisseur }>;
  receptionner(corps: Record<string, unknown>): Promise<unknown>;
  /** Réglages d'envoi : administration seulement. */
  regler?(corps: Record<string, unknown>): Promise<ReponseCommandes>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nombre = (n: number) => (n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const jourLisible = (j: string) => new Date(`${j}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const totalHT = (c: Pick<CommandeFournisseur, "lignes">) => c.lignes.reduce((s, l) => s + (l.prixHT == null ? 0 : Math.round((l.prixHT * l.nombre) / 1000)), 0);

/** Milliers saisis à la française (« 2 », « 2,5 ») ; null si vide ou illisible. */
function milliemes(texte: string): number | null {
  if (!texte.trim()) return null;
  const n = lireDecimal(texte);
  return n == null || n < 0 ? null : Math.round(n * 1000);
}

export function commandeRecue(c: Pick<CommandeFournisseur, "lignes" | "recu">): boolean {
  return c.lignes.length > 0 && c.lignes.every((l) => (c.recu[l.articleId] ?? 0) >= l.nombre);
}

/** Statut affiché : celui enregistré, précisé par ce qui a été reçu. */
export function etatCommande(c: CommandeFournisseur): { libelle: string; classe: string; enCours: boolean } {
  const recue = commandeRecue(c);
  const partielle = Object.values(c.recu).some((x) => x > 0);
  if (c.statut === "brouillon") return { libelle: "Brouillon", classe: "brouillon", enCours: true };
  if (c.statut === "annulee") return { libelle: "Annulée", classe: "annulee", enCours: false };
  if (c.statut === "soldee") return { libelle: recue ? "Reçue" : "Soldée", classe: "close", enCours: false };
  if (recue) return { libelle: "Reçue", classe: "close", enCours: false };
  return partielle ? { libelle: "Reçue en partie", classe: "partielle", enCours: true } : { libelle: "Envoyée", classe: "envoyee", enCours: true };
}

type Vue =
  | { type: "liste" }
  | { type: "fournisseur" }
  | { type: "edition"; fournisseur: string; commande: CommandeFournisseur | null; depuis?: CommandeFournisseur; avis?: string }
  | { type: "detail"; id: string }
  | { type: "reception"; id: string };

export function Commandes(props: {
  referentiel: Referentiel;
  prix: PrixAchat[];
  etat: EtatStock | null;
  etablissementId: string;
  acces: AccesCommandes;
  /** Après une réception : le stock et les derniers prix ont changé. */
  onReception?: () => void;
}) {
  const [donnees, setDonnees] = useState<ReponseCommandes | null>(null);
  const [erreur, setErreur] = useState("");
  const [vue, setVue] = useState<Vue>({ type: "liste" });
  const [toutes, setToutes] = useState(false);
  const charger = useCallback(async () => {
    try {
      setDonnees(await props.acces.lister());
      setErreur("");
    } catch (e) {
      setErreur(message(e));
    }
  }, [props.acces]);
  useEffect(() => {
    void charger();
  }, [charger]);

  /** Remplace une commande dans la liste après une écriture. */
  const remplacer = (c: CommandeFournisseur) =>
    setDonnees((d) => (d ? { ...d, commandes: d.commandes.some((x) => x.id === c.id) ? d.commandes.map((x) => (x.id === c.id ? c : x)) : [c, ...d.commandes] } : d));

  if (!donnees) return <p className="explication">{erreur || "Chargement des commandes…"}</p>;
  const trouver = (id: string) => donnees.commandes.find((c) => c.id === id);

  if (vue.type === "fournisseur") {
    return <ChoixFournisseur referentiel={props.referentiel} onChoisir={(f) => setVue({ type: "edition", fournisseur: f, commande: null })} onRetour={() => setVue({ type: "liste" })} />;
  }
  if (vue.type === "edition") {
    return (
      <EditeurCommande
        key={vue.commande ? `${vue.commande.id}-${vue.commande.version}` : `nouvelle-${vue.fournisseur}`}
        {...props}
        fournisseur={vue.fournisseur}
        commande={vue.commande}
        {...(vue.depuis ? { depuis: vue.depuis } : {})}
        {...(vue.avis ? { avis: vue.avis } : {})}
        envoi={donnees.envoi}
        onCommande={(c) => {
          remplacer(c);
          setVue(c.statut === "brouillon" ? { type: "edition", fournisseur: c.fournisseur, commande: c, avis: `Brouillon n° ${c.numero} enregistré.` } : { type: "detail", id: c.id });
        }}
        onRetour={() => setVue({ type: "liste" })}
      />
    );
  }
  if (vue.type === "detail" && trouver(vue.id)) {
    const c = trouver(vue.id)!;
    return (
      <DetailCommande
        commande={c}
        referentiel={props.referentiel}
        acces={props.acces}
        onCommande={remplacer}
        onReceptionner={() => setVue({ type: "reception", id: c.id })}
        onDupliquer={() => setVue({ type: "edition", fournisseur: c.fournisseur, commande: null, depuis: c })}
        onRetour={() => setVue({ type: "liste" })}
      />
    );
  }
  if (vue.type === "reception" && trouver(vue.id)) {
    const c = trouver(vue.id)!;
    return (
      <FormulaireReception
        key={c.id}
        referentiel={props.referentiel}
        prix={props.prix}
        etablissementId={props.etablissementId}
        commande={c}
        onFermer={() => setVue({ type: "detail", id: c.id })}
        onEnregistrer={async (corps) => {
          await props.acces.receptionner(corps);
          await charger();
          props.onReception?.();
          setVue({ type: "detail", id: c.id });
        }}
      />
    );
  }

  const enCours = donnees.commandes.filter((c) => etatCommande(c).enCours);
  // Rien en cours : les dernières commandes (reçues, soldées) restent visibles plutôt qu'une liste vide.
  const repli = !toutes && !enCours.length && donnees.commandes.length > 0;
  const liste = toutes || repli ? donnees.commandes : enCours;
  return (
    <section className="operation-stock commandes">
      <div className="commandes-tete">
        <h2 className="titre-icone">
          <AvecIcone icone={ShoppingCart} taille={22}>Commandes fournisseurs</AvecIcone>
        </h2>
        <button className="bouton principal" onClick={() => setVue({ type: "fournisseur" })}>
          <AvecIcone icone={Plus}>Nouvelle commande</AvecIcone>
        </button>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      <div className="options" role="tablist">
        <button role="tab" aria-selected={!toutes} className={`option${!toutes ? " active" : ""}`} onClick={() => setToutes(false)}>
          En cours ({enCours.length})
        </button>
        <button role="tab" aria-selected={toutes} className={`option${toutes ? " active" : ""}`} onClick={() => setToutes(true)}>
          Toutes
        </button>
      </div>
      {repli && <p className="explication">Aucune commande en cours. Dernières commandes :</p>}
      {!liste.length ? (
        <p className="explication">{toutes ? "Aucune commande pour l'instant." : "Aucune commande en cours : brouillons et commandes envoyées pas encore reçues s'affichent ici."}</p>
      ) : (
        <ul className="commandes-liste">
          {liste.map((c) => {
            const e = etatCommande(c);
            return (
              <li key={c.id}>
                <button
                  className="commande-carte"
                  onClick={() => setVue(c.statut === "brouillon" ? { type: "edition", fournisseur: c.fournisseur, commande: c } : { type: "detail", id: c.id })}
                >
                  <span>
                    <strong>
                      N° {c.numero} · {c.fournisseur}
                    </strong>
                    <small>
                      {c.lignes.length} article{c.lignes.length > 1 ? "s" : ""} · {euros(totalHT(c))} HT
                      {c.envoi ? ` · envoyée le ${date(c.envoi.le)}` : ` · créée le ${date(c.creeLe)}`}
                      {c.livraison ? ` · livraison souhaitée ${jourLisible(c.livraison)}` : ""}
                    </small>
                  </span>
                  <span className={`statut-commande ${e.classe}`}>{e.libelle}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {props.acces.regler && <ReglagesEnvoi donnees={donnees} regler={props.acces.regler} onDonnees={setDonnees} />}
      {!props.acces.regler && !donnees.envoi.possible && (
        <p className="explication">L'envoi par e-mail n'est pas réglé pour cet établissement : les commandes se marquent envoyées (téléphone, portail).</p>
      )}
    </section>
  );
}

// ───────── Choix du fournisseur ─────────

function ChoixFournisseur(props: { referentiel: Referentiel; onChoisir: (f: string) => void; onRetour: () => void }) {
  const noms = nomsFournisseurs(props.referentiel).filter((f) => props.referentiel.articles.some((a) => a.actif && normaliserNom(a.fournisseur) === normaliserNom(f)));
  return (
    <section className="operation-stock">
      <div className="commandes-tete">
        <BoutonIcone icone={ArrowLeft} libelle="Retour aux commandes" variante="discret" onClick={props.onRetour} />
        <h2>Nouvelle commande : fournisseur</h2>
      </div>
      {!noms.length ? (
        <p className="explication">Aucun fournisseur avec des articles : ajoutez des articles fournisseurs aux produits (administration › Stock et recettes).</p>
      ) : (
        <ul className="commandes-liste">
          {noms.map((f) => {
            const fiche = ficheFournisseur(props.referentiel, f);
            const n = props.referentiel.articles.filter((a) => a.actif && normaliserNom(a.fournisseur) === normaliserNom(f)).length;
            return (
              <li key={f}>
                <button className="commande-carte" onClick={() => props.onChoisir(f)}>
                  <span>
                    <strong>{f}</strong>
                    <small>
                      {n} article{n > 1 ? "s" : ""}
                      {fiche?.courriel ? ` · ${fiche.courriel}` : " · pas d'e-mail de commande"}
                      {fiche?.livraison ? ` · ${fiche.livraison}` : ""}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ───────── Saisie d'un bon ─────────

function EditeurCommande(props: {
  referentiel: Referentiel;
  prix: PrixAchat[];
  etat: EtatStock | null;
  etablissementId: string;
  acces: AccesCommandes;
  fournisseur: string;
  commande: CommandeFournisseur | null;
  /** Commande reprise (« Dupliquer ») : ses quantités, sans son envoi. */
  depuis?: CommandeFournisseur;
  envoi: ReponseCommandes["envoi"];
  /** Message à afficher en arrivant (brouillon enregistré). */
  avis?: string;
  onCommande: (c: CommandeFournisseur) => void;
  onRetour: () => void;
}) {
  const ref = props.referentiel;
  const base = props.commande ?? props.depuis ?? null;
  const [quantites, setQuantites] = useState<Record<string, string>>(() => Object.fromEntries((base?.lignes ?? []).map((l) => [l.articleId, String(l.nombre / 1000).replace(".", ",")])));
  const [livraison, setLivraison] = useState(props.commande?.livraison ?? "");
  const [texte, setTexte] = useState(props.commande?.message ?? props.depuis?.message ?? "");
  const [recherche, setRecherche] = useState("");
  const [seulementCommandes, setSeulementCommandes] = useState(false);
  const [confirmer, setConfirmer] = useState<null | "courriel" | "manuel" | "annuler">(null);
  const [etat, setEtat] = useState<{ enCours: boolean; erreur: string; ok: string }>({ enCours: false, erreur: "", ok: props.avis ?? "" });
  const fiche = ficheFournisseur(ref, props.fournisseur);
  const compte = fiche?.comptes?.find((c) => c.etablissementId === props.etablissementId)?.numeroClient;
  const produit = (id: string) => ref.produits.find((p) => p.id === id);
  const dernier = (articleId: string) => props.prix.filter((p) => p.articleId === articleId && p.etablissementId === props.etablissementId).sort((a, b) => b.le.localeCompare(a.le))[0];
  const enStock = (produitId: string) => props.etat?.produits.find((p) => p.produitId === produitId)?.quantite ?? null;
  const n = normaliserNom(recherche);
  const articles = useMemo(
    () =>
      ref.articles
        .filter((a) => a.actif && normaliserNom(a.fournisseur) === normaliserNom(props.fournisseur))
        .sort((a, b) => (produit(a.produitId)?.famille ?? "").localeCompare(produit(b.produitId)?.famille ?? "", "fr") || (produit(a.produitId)?.nom ?? "").localeCompare(produit(b.produitId)?.nom ?? "", "fr")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ref, props.fournisseur],
  );
  const lignes = articles
    .map((a) => ({ a, nb: milliemes(quantites[a.id] ?? "") }))
    .filter((l): l is { a: (typeof articles)[number]; nb: number } => l.nb != null && l.nb > 0);
  const illisibles = articles.filter((a) => (quantites[a.id] ?? "").trim() && milliemes(quantites[a.id]!) == null);
  const total = lignes.reduce((s, l) => s + Math.round(((dernier(l.a.id)?.prixHT ?? 0) * l.nb) / 1000), 0);
  const sansPrix = lignes.filter((l) => !dernier(l.a.id));
  const visibles = articles.filter((a) => (!n || normaliserNom(`${produit(a.produitId)?.nom ?? ""} ${a.reference ?? ""} ${a.conditionnement}`).includes(n)) && (!seulementCommandes || milliemes(quantites[a.id] ?? "")));
  const corps = () => ({ fournisseur: props.fournisseur, lignes: lignes.map((l) => ({ articleId: l.a.id, nombre: l.nb })), livraison: livraison || null, message: texte });

  /** Enregistre le brouillon (création ou modification), puis l'action demandée. */
  const executer = async (suite: null | "courriel" | "manuel" | "annuler") => {
    setEtat({ enCours: true, erreur: "", ok: "" });
    try {
      let c = props.commande;
      if (suite !== "annuler") {
        c = c
          ? (await props.acces.ecrire(c.id, "modifier", { ...corps(), version: c.version })).commande
          : (await props.acces.ecrire(null, "creer", corps())).commande;
      }
      if (suite === "courriel" || suite === "manuel") c = (await props.acces.ecrire(c!.id, "envoyer", { version: c!.version, mode: suite })).commande;
      if (suite === "annuler") c = (await props.acces.ecrire(c!.id, "annuler", { version: c!.version })).commande;
      setEtat({ enCours: false, erreur: "", ok: "" });
      setConfirmer(null);
      props.onCommande(c!);
    } catch (e) {
      setEtat({ enCours: false, erreur: message(e), ok: "" });
      setConfirmer(null);
    }
  };
  const peutEmail = !!fiche?.courriel && props.envoi.possible;

  return (
    <section className="operation-stock commande-edition">
      <div className="commandes-tete">
        <BoutonIcone icone={ArrowLeft} libelle="Retour aux commandes" variante="discret" onClick={props.onRetour} />
        <h2>{props.commande ? `Commande n° ${props.commande.numero} · ${props.fournisseur}` : `Nouvelle commande · ${props.fournisseur}`}</h2>
      </div>
      <FicheResume fiche={fiche} compte={compte} />
      <div className="operation-filtres">
        <label className="operation-recherche">
          <Search className="icone" size={18} aria-hidden="true" />
          <input placeholder="Chercher un article" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label="Chercher un article" />
        </label>
        <label className="case">
          <input type="checkbox" checked={seulementCommandes} onChange={(e) => setSeulementCommandes(e.target.checked)} /> Seulement les articles commandés
        </label>
      </div>
      <ul className="inventaire-liste commande-lignes">
        {visibles.map((a) => {
          const p = produit(a.produitId);
          const d = dernier(a.id);
          const q = p ? enStock(p.id) : null;
          const saisie = quantites[a.id] ?? "";
          return (
            <li key={a.id} className={milliemes(saisie) ? "compte" : ""}>
              <span className="inventaire-nom">
                <strong>{p?.nom ?? a.produitId}</strong>
                <small>
                  {a.conditionnement || "Conditionnement"}
                  {p ? ` · ${formaterEnUnite(a.quantite, p.unite)}` : ""}
                  {a.reference ? ` · réf. ${a.reference}` : ""}
                </small>
                {p && q != null && (
                  <small className={q <= 0 ? "stock-bas" : ""}>
                    en stock : {formaterEnUnite(q, p.unite)}
                    {a.quantite > 0 && q > 0 ? ` (≈ ${nombre(Math.round((q * 1000) / a.quantite))} cond.)` : ""}
                  </small>
                )}
              </span>
              <span className="inventaire-saisie commande-prix">
                <strong>{d ? euros(d.prixHT) : "—"}</strong>
                <small>{d ? "dernier prix HT" : "sans prix"}</small>
              </span>
              <label className="inventaire-saisie">
                <input value={saisie} inputMode="decimal" placeholder="0" aria-label={`${p?.nom ?? a.id} : quantité à commander`} onChange={(e) => setQuantites((x) => ({ ...x, [a.id]: e.target.value }))} />
                <small>à commander</small>
              </label>
            </li>
          );
        })}
      </ul>
      {!visibles.length && <p className="explication">Aucun article ne correspond.</p>}
      <div className="operation-entete">
        <label className="champ">
          <span>Livraison souhaitée</span>
          <input type="date" value={livraison} onChange={(e) => setLivraison(e.target.value)} />
        </label>
        <label className="champ commande-message">
          <span>Message au fournisseur</span>
          <textarea value={texte} maxLength={1000} rows={2} placeholder="Facultatif (créneau, consigne, remise convenue…)" onChange={(e) => setTexte(e.target.value)} />
        </label>
      </div>
      <p className="commande-total">
        {lignes.length} article{lignes.length > 1 ? "s" : ""} · <strong>{euros(total)} HT</strong>
        {sansPrix.length > 0 && <small> (sans prix : {sansPrix.map((l) => produit(l.a.produitId)?.nom).join(", ")})</small>}
      </p>
      {fiche?.francoHT != null && lignes.length > 0 && total < fiche.francoHT && (
        <p className="avertissement">Sous le franco de {props.fournisseur} ({euros(fiche.francoHT)} HT) : il manque {euros(fiche.francoHT - total)}.</p>
      )}
      {illisibles.length > 0 && <p className="erreur">Quantité illisible pour {illisibles.map((a) => produit(a.produitId)?.nom).join(", ")}.</p>}
      {etat.erreur && <p className="erreur">{etat.erreur}</p>}
      {etat.ok && <p className="succes">{etat.ok}</p>}
      {confirmer ? (
        <div className="commande-confirmation">
          <p>
            {confirmer === "courriel" && (
              <>
                Envoyer la commande ({lignes.length} article{lignes.length > 1 ? "s" : ""}, {euros(total)} HT) à <strong>{fiche!.courriel}</strong>
                {fiche!.copies?.length ? `, copie ${fiche!.copies.join(", ")}` : ""}
                {props.envoi.email ? ` et ${props.envoi.email}` : ""} ? Elle ne se modifie plus ensuite.
              </>
            )}
            {confirmer === "manuel" && <>Commande passée à {props.fournisseur} par téléphone ou sur son portail ? Elle sera marquée envoyée, sans e-mail, et ne se modifiera plus.</>}
            {confirmer === "annuler" && <>Annuler ce brouillon ? Il reste dans la liste « Toutes », marqué annulé.</>}
          </p>
          <div className="operation-actions">
            <button className="bouton" onClick={() => setConfirmer(null)} disabled={etat.enCours}>
              Non
            </button>
            <button className={`bouton ${confirmer === "annuler" ? "danger" : "principal"}`} onClick={() => void executer(confirmer)} disabled={etat.enCours}>
              <AvecIcone icone={confirmer === "annuler" ? Ban : confirmer === "courriel" ? Send : Check}>
                {confirmer === "courriel" ? "Envoyer" : confirmer === "manuel" ? "Marquer envoyée" : "Annuler le brouillon"}
              </AvecIcone>
            </button>
          </div>
        </div>
      ) : (
        <div className="operation-actions">
          {props.commande && (
            <button className="bouton discret" onClick={() => setConfirmer("annuler")} disabled={etat.enCours}>
              <AvecIcone icone={Ban}>Annuler le brouillon</AvecIcone>
            </button>
          )}
          <button className="bouton" onClick={() => void executer(null)} disabled={etat.enCours || illisibles.length > 0 || (!lignes.length && !props.commande)}>
            <AvecIcone icone={Save}>Enregistrer le brouillon</AvecIcone>
          </button>
          <button className="bouton" onClick={() => setConfirmer("manuel")} disabled={etat.enCours || !lignes.length || illisibles.length > 0}>
            <AvecIcone icone={Phone}>Marquer envoyée</AvecIcone>
          </button>
          <button
            className="bouton principal"
            onClick={() => setConfirmer("courriel")}
            disabled={etat.enCours || !lignes.length || illisibles.length > 0 || !peutEmail}
            title={!fiche?.courriel ? "Aucun e-mail de commande dans la fiche du fournisseur" : !props.envoi.possible ? "Envoi d'e-mails non réglé pour l'établissement" : undefined}
          >
            <AvecIcone icone={Send}>Envoyer par e-mail</AvecIcone>
          </button>
        </div>
      )}
      {!peutEmail && (
        <p className="explication">
          {!fiche?.courriel
            ? `Pas d'e-mail de commande dans la fiche de ${props.fournisseur} : complétez-la dans l'administration (Stock et recettes › Fournisseurs), ou passez la commande par téléphone puis « Marquer envoyée ».`
            : "L'envoi d'e-mails n'est pas réglé pour l'établissement (clé Resend) : passez la commande par téléphone puis « Marquer envoyée »."}
        </p>
      )}
    </section>
  );
}

function FicheResume(props: { fiche: ReturnType<typeof ficheFournisseur>; compte: string | undefined }) {
  const f = props.fiche;
  if (!f) return <p className="explication">Pas de fiche pour ce fournisseur : coordonnées à saisir dans l'administration (Stock et recettes › Fournisseurs).</p>;
  return (
    <p className="fiche-fournisseur-resume">
      {f.courriel && (
        <span>
          <Mail size={16} aria-hidden="true" /> {f.courriel}
        </span>
      )}
      {f.telephone && (
        <a href={`tel:${f.telephone.replace(/\s/g, "")}`}>
          <Phone size={16} aria-hidden="true" /> {f.telephone}
          {f.contact ? ` (${f.contact})` : ""}
        </a>
      )}
      {props.compte && <span>Client n° {props.compte}</span>}
      {f.livraison && <span>{f.livraison}</span>}
      {f.francoHT != null && <span>Franco {euros(f.francoHT)} HT</span>}
    </p>
  );
}

// ───────── Détail d'une commande envoyée ─────────

function DetailCommande(props: {
  commande: CommandeFournisseur;
  referentiel: Referentiel;
  acces: AccesCommandes;
  onCommande: (c: CommandeFournisseur) => void;
  onReceptionner: () => void;
  onDupliquer: () => void;
  onRetour: () => void;
}) {
  const c = props.commande;
  const ref = props.referentiel;
  const e = etatCommande(c);
  const [confirmer, setConfirmer] = useState<null | "solder" | "annuler">(null);
  const [prevenir, setPrevenir] = useState(true);
  const [etat, setEtat] = useState({ enCours: false, erreur: "" });
  const fiche = ficheFournisseur(ref, c.fournisseur);
  const recueEnPartie = c.receptions.some((r) => !r.annulee);
  const agir = async (action: "solder" | "annuler") => {
    setEtat({ enCours: true, erreur: "" });
    try {
      props.onCommande((await props.acces.ecrire(c.id, action, { version: c.version, ...(action === "annuler" ? { prevenir } : {}) })).commande);
      setEtat({ enCours: false, erreur: "" });
      setConfirmer(null);
    } catch (err) {
      setEtat({ enCours: false, erreur: message(err) });
    }
  };
  return (
    <section className="operation-stock commande-detail">
      <div className="commandes-tete">
        <BoutonIcone icone={ArrowLeft} libelle="Retour aux commandes" variante="discret" onClick={props.onRetour} />
        <h2>
          Commande n° {c.numero} · {c.fournisseur}
        </h2>
        <span className={`statut-commande ${e.classe}`}>{e.libelle}</span>
      </div>
      <p className="explication">
        {c.envoi
          ? c.envoi.mode === "courriel"
            ? `Envoyée par e-mail le ${date(c.envoi.le)} à ${c.envoi.a}${c.envoi.copies?.length ? ` (copie ${c.envoi.copies.join(", ")})` : ""}, par ${c.envoi.par}.`
            : `Passée le ${date(c.envoi.le)} (téléphone, portail), par ${c.envoi.par}.`
          : `Créée le ${date(c.creeLe)} par ${c.creePar}.`}
        {c.livraison ? ` Livraison souhaitée ${jourLisible(c.livraison)}.` : ""}
      </p>
      {c.message && <p className="commande-message-lu">« {c.message} »</p>}
      <FicheResume fiche={fiche} compte={fiche?.comptes?.find((x) => x.etablissementId === c.etablissementId)?.numeroClient} />
      <table className="tableau tableau-commande">
        <thead>
          <tr>
            <th>Article</th>
            <th className="nombre">Commandé</th>
            <th className="nombre">Reçu</th>
            <th className="nombre">Prix HT</th>
          </tr>
        </thead>
        <tbody>
          {c.lignes.map((l) => {
            const a = ref.articles.find((x) => x.id === l.articleId);
            const p = ref.produits.find((x) => x.id === l.produitId);
            const recu = c.recu[l.articleId] ?? 0;
            return (
              <tr key={l.articleId} className={recu >= l.nombre ? "recue" : recu > 0 ? "partielle" : ""}>
                <td>
                  <strong>{p?.nom ?? l.produitId}</strong>
                  <small>
                    {a?.conditionnement}
                    {a?.reference ? ` · réf. ${a.reference}` : ""}
                  </small>
                </td>
                <td className="nombre">{nombre(l.nombre)}</td>
                <td className="nombre">
                  {nombre(recu)}
                  {recu >= l.nombre && <CircleCheck size={16} aria-label="reçu" className="icone-recu" />}
                </td>
                <td className="nombre">{euros(l.prixHT)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Total HT indicatif</td>
            <td className="nombre">{euros(totalHT(c))}</td>
          </tr>
        </tfoot>
      </table>
      {c.receptions.length > 0 && (
        <>
          <h3>Livraisons</h3>
          <ul className="pieces-liste">
            {c.receptions.map((r) => (
              <li key={r.id} className={r.annulee ? "annulee" : ""}>
                <span>
                  <strong>Réception du {date(r.le)}</strong>
                  <small>
                    {r.numero ? `BL ${r.numero} · ` : ""}
                    {euros(r.totalHT)} HT{r.annulee ? " · annulée" : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <details className="commande-historique">
        <summary>Historique</summary>
        <ul>
          {c.historique.map((h, i) => (
            <li key={i}>
              {date(h.le)} · {h.action} · {h.par}
            </li>
          ))}
        </ul>
      </details>
      {etat.erreur && <p className="erreur">{etat.erreur}</p>}
      {confirmer ? (
        <div className="commande-confirmation">
          {confirmer === "solder" ? (
            <p>
              {commandeRecue(c) ? "Clore la commande : tout est reçu." : "Solder la commande : le reste ne sera pas livré et ne s'attend plus."} Elle ne se réceptionne plus ensuite.
            </p>
          ) : (
            <>
              <p>Annuler la commande n° {c.numero} ?</p>
              {c.envoi?.mode === "courriel" && (
                <label className="case">
                  <input type="checkbox" checked={prevenir} onChange={(x) => setPrevenir(x.target.checked)} /> Prévenir {c.fournisseur} par e-mail ({c.envoi.a})
                </label>
              )}
            </>
          )}
          <div className="operation-actions">
            <button className="bouton" onClick={() => setConfirmer(null)} disabled={etat.enCours}>
              Non
            </button>
            <button className={`bouton ${confirmer === "annuler" ? "danger" : "principal"}`} onClick={() => void agir(confirmer)} disabled={etat.enCours}>
              {confirmer === "solder" ? (commandeRecue(c) ? "Clore" : "Solder") : "Annuler la commande"}
            </button>
          </div>
        </div>
      ) : (
        <div className="operation-actions">
          <button className="bouton discret" onClick={props.onDupliquer}>
            <AvecIcone icone={Copy}>Dupliquer</AvecIcone>
          </button>
          {c.statut === "envoyee" && !recueEnPartie && (
            <button className="bouton discret" onClick={() => setConfirmer("annuler")}>
              <AvecIcone icone={Ban}>Annuler</AvecIcone>
            </button>
          )}
          {c.statut === "envoyee" && recueEnPartie && (
            <button className="bouton" onClick={() => setConfirmer("solder")}>
              <AvecIcone icone={Check}>{commandeRecue(c) ? "Clore" : "Solder"}</AvecIcone>
            </button>
          )}
          {c.statut === "envoyee" && (
            <button className="bouton principal" onClick={props.onReceptionner}>
              <AvecIcone icone={PackagePlus}>Réceptionner la livraison</AvecIcone>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ───────── Réglages d'envoi (administration) ─────────

function ReglagesEnvoi(props: { donnees: ReponseCommandes; regler: (corps: Record<string, unknown>) => Promise<ReponseCommandes>; onDonnees: (d: ReponseCommandes) => void }) {
  const r = props.donnees.reglages;
  const [expediteur, setExpediteur] = useState(r.expediteur ?? "");
  const [email, setEmail] = useState(r.email ?? "");
  const [livraison, setLivraison] = useState(r.livraison ?? "");
  const [etat, setEtat] = useState({ enCours: false, erreur: "", ok: "" });
  const e = props.donnees.envoi;
  return (
    <details className="commandes-reglages">
      <summary>
        <AvecIcone icone={Settings}>Réglages d'envoi des commandes</AvecIcone>
      </summary>
      <p className="explication">
        {e.possible
          ? `Les bons partent de ${e.expediteur ?? "l'adresse par défaut de l'hébergement"}${e.email ? `, avec ${e.email} en copie et pour les réponses` : ""}.`
          : "Aucune clé d'envoi d'e-mails pour cet établissement : enregistrez sa clé Resend (Réservations › Services et réglages)."}{" "}
        Champs vides : ceux des réservations.
      </p>
      <div className="operation-entete">
        <label className="champ">
          <span>Adresse d'expédition</span>
          <input type="email" value={expediteur} placeholder="commandes@votre-domaine.fr" onChange={(x) => setExpediteur(x.target.value)} />
        </label>
        <label className="champ">
          <span>E-mail de l'établissement (copie et réponses)</span>
          <input type="email" value={email} onChange={(x) => setEmail(x.target.value)} />
        </label>
        <label className="champ commande-message">
          <span>Consignes de livraison (imprimées sur le bon)</span>
          <input value={livraison} maxLength={300} placeholder="Ex. livraison par la cour, du mardi au samedi avant 11 h" onChange={(x) => setLivraison(x.target.value)} />
        </label>
      </div>
      {etat.erreur && <p className="erreur">{etat.erreur}</p>}
      {etat.ok && <p className="succes">{etat.ok}</p>}
      <div className="operation-actions">
        <button
          className="bouton"
          disabled={etat.enCours}
          onClick={async () => {
            setEtat({ enCours: true, erreur: "", ok: "" });
            try {
              props.onDonnees(await props.regler({ expediteur, email, livraison }));
              setEtat({ enCours: false, erreur: "", ok: "Réglages enregistrés." });
            } catch (x) {
              setEtat({ enCours: false, erreur: message(x), ok: "" });
            }
          }}
        >
          <AvecIcone icone={Save}>Enregistrer</AvecIcone>
        </button>
      </div>
    </details>
  );
}
