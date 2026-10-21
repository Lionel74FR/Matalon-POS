import {
  normaliserTelephone,
  prochaineRecompense,
  recompensesTriees,
  telephoneLisible,
  unite,
  type MembreFidelite,
  type RecompenseFidelite,
  type ReglesFidelite,
} from "@matalon/serveur/fidelite";
import type { Ticket } from "@matalon/noyau-fiscal";
import { Gift, Search, Unlink, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { carteDe } from "../../donnees/configuration";
import type { Commande } from "../../metier/commande";
import { appliquerRecompense, retirerRecompense, valeurSurCommande } from "../../metier/fidelite";
import { ErreurApi } from "../../serveur/client";
import { Modale } from "../communs";
import { euros, useCaisse } from "../contexte";
import { AvecIcone } from "../icones";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const horsLigne = (e: unknown) => e instanceof ErreurApi && e.code === "HORS_LIGNE";

/** Saisie du téléphone, gros caractères, clavier numérique. */
function ChampTelephone(props: { valeur: string; onChange: (v: string) => void; onValider: () => void; enCours: boolean; bouton: string }) {
  return (
    <form
      className="fidelite-recherche"
      onSubmit={(e) => {
        e.preventDefault();
        props.onValider();
      }}
    >
      <input
        type="tel"
        inputMode="tel"
        autoComplete="off"
        aria-label="Téléphone du client"
        placeholder="06 12 34 56 78"
        value={props.valeur}
        onChange={(e) => props.onChange(e.target.value)}
        autoFocus
      />
      <button className="bouton principal" disabled={props.enCours || !normaliserTelephone(props.valeur)}>
        <AvecIcone icone={Search}>{props.bouton}</AvecIcone>
      </button>
    </form>
  );
}

/**
 * Carte de fidélité sur la commande : le client donne son téléphone (inscription s'il est
 * nouveau), la commande affiche son solde, une récompense atteinte s'applique d'un geste.
 * Hors ligne, la carte se rattache par le téléphone : les points viennent à la synchronisation,
 * les récompenses attendent le réseau.
 */
export function ModaleFidelite(props: { commande: Commande; onChange: (c: Commande) => void; onFermer: () => void }) {
  const { caisse, config, utilisateur, notifier } = useCaisse();
  const programme = config.fidelite!;
  const c = props.commande;
  const f = c.fidelite ?? null;
  const [regles, setRegles] = useState<ReglesFidelite>(programme.regles);
  const [tel, setTel] = useState("");
  const [etape, setEtape] = useState<"recherche" | "inscription" | "horsLigne">("recherche");
  const [fiche, setFiche] = useState({ prenom: "", nom: "", email: "", offres: false });
  const [choixArticle, setChoixArticle] = useState<RecompenseFidelite | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const carte = carteDe(config);
  const nomArticle = (id: string) => carte?.categories.flatMap((x) => x.articles).find((a) => a.id === id);

  const action = async (a: () => Promise<void>) => {
    setEnCours(true);
    setErreur("");
    try {
      await a();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  };

  const attacher = (m: MembreFidelite) => props.onChange({ ...c, fidelite: { membreId: m.id, telephone: m.telephone, prenom: m.prenom, solde: m.solde, utilisations: [] } });

  const chercher = () =>
    action(async () => {
      const t = normaliserTelephone(tel);
      if (!t) return setErreur("Numéro de téléphone invalide.");
      try {
        const r = await caisse.client.membreFidelite(t);
        setRegles(r.programme.regles);
        if (r.membre) attacher(r.membre);
        else setEtape("inscription");
      } catch (e) {
        if (horsLigne(e)) return setEtape("horsLigne");
        throw e;
      }
    });

  /** Carte rattachée hors ligne : on la vérifie dès que le réseau revient (membre, solde). */
  const verifier = () =>
    action(async () => {
      if (!f) return;
      const r = await caisse.client.membreFidelite(f.telephone);
      setRegles(r.programme.regles);
      if (r.membre) props.onChange({ ...c, fidelite: { ...f, membreId: r.membre.id, prenom: r.membre.prenom, solde: r.membre.solde } });
      else {
        setTel(telephoneLisible(f.telephone));
        setEtape("inscription");
      }
    });
  useEffect(() => {
    if (f && !f.membreId) void verifier().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inscrire = () =>
    action(async () => {
      const r = await caisse.client.inscrireFidelite({
        telephone: normaliserTelephone(tel) ?? tel,
        prenom: fiche.prenom.trim(),
        nom: fiche.nom.trim(),
        email: fiche.email.trim(),
        offres: fiche.offres,
        utilisateurId: utilisateur.id,
      });
      notifier(r.cree ? `Carte ${programme.nom} créée pour ${r.membre.prenom}.` : `${r.membre.prenom} a déjà une carte ${programme.nom}.`);
      attacher(r.membre);
      setEtape("recherche");
    });

  const utiliser = (r: RecompenseFidelite, articleId?: string) =>
    action(async () => {
      if (!f?.membreId) return;
      const articles = (r.articles ?? []).filter((id) => nomArticle(id)?.prixTTC != null);
      if (r.type === "ARTICLE" && !articleId) {
        if (articles.length > 1) return setChoixArticle(r);
        articleId = articles[0];
        if (!articleId) return setErreur("Aucun des articles offerts n'est à la carte de l'établissement.");
      }
      if (r.type !== "ARTICLE" && valeurSurCommande(c, r) <= 0) return setErreur("Rien à remiser : ajoutez d'abord des articles sans remise.");
      setChoixArticle(null);
      const res = await caisse.client.utiliserRecompense(f.membreId, r.id, utilisateur.id);
      try {
        const maj = appliquerRecompense(c, res.recompense, res.utilisation, utilisateur.id, carte ?? null, articleId);
        props.onChange({ ...maj, fidelite: { ...maj.fidelite!, solde: res.solde } });
        notifier(`${r.libelle} : appliqué sur la commande.`);
      } catch (e) {
        void caisse.client.rendreRecompense(res.utilisation.id).catch(() => undefined);
        throw e;
      }
    });

  const retirer = (id: string) =>
    action(async () => {
      let solde = f?.solde ?? null;
      try {
        solde = (await caisse.client.rendreRecompense(id)).solde;
      } catch (e) {
        // Hors ligne : la récompense reste réservée sur le serveur et lui revient d'office sous 48 h.
        if (!horsLigne(e)) throw e;
      }
      const maj = retirerRecompense(c, id);
      props.onChange({ ...maj, ...(maj.fidelite ? { fidelite: { ...maj.fidelite, solde } } : {}) });
    });

  const detacher = () =>
    action(async () => {
      let maj = c;
      for (const u of f?.utilisations ?? []) {
        await caisse.client.rendreRecompense(u.id).catch(() => undefined);
        maj = retirerRecompense(maj, u.id);
      }
      const { fidelite: _, ...sans } = maj;
      props.onChange(sans);
      setTel("");
      setEtape("recherche");
    });

  const suite = f?.solde != null ? prochaineRecompense(regles, f.solde) : null;
  const uneSeule = regles.uneRecompenseParTicket && (f?.utilisations.length ?? 0) > 0;

  return (
    <Modale titre={`Fidélité · ${programme.nom}`} onFermer={props.onFermer}>
      {!f ? (
        etape === "inscription" ? (
          <form
            className="fidelite-inscription"
            onSubmit={(e) => {
              e.preventDefault();
              void inscrire();
            }}
          >
            <p className="explication">
              Pas encore de carte au {telephoneLisible(normaliserTelephone(tel) ?? tel)}. Inscription en quelques secondes : le prénom suffit.
            </p>
            <label className="champ">
              <span>Prénom</span>
              <input value={fiche.prenom} maxLength={40} required autoFocus onChange={(e) => setFiche({ ...fiche, prenom: e.target.value })} />
            </label>
            <label className="champ">
              <span>Nom</span>
              <input value={fiche.nom} maxLength={60} onChange={(e) => setFiche({ ...fiche, nom: e.target.value })} />
            </label>
            <label className="champ">
              <span>
                E-mail <small>Bienvenue et récompenses atteintes</small>
              </span>
              <input type="email" value={fiche.email} maxLength={254} onChange={(e) => setFiche({ ...fiche, email: e.target.value })} />
            </label>
            <label className="case">
              <input type="checkbox" checked={fiche.offres} onChange={(e) => setFiche({ ...fiche, offres: e.target.checked })} />
              Le client accepte de recevoir des offres
            </label>
            <p className="explication petite">
              Ses coordonnées servent au seul programme de fidélité ; il peut les faire corriger ou effacer à tout moment. Informations
              complètes : {location.host}/donnees/{config.etablissementId}.
            </p>
            {erreur && <p className="erreur">{erreur}</p>}
            <div className="fidelite-actions">
              <button type="button" className="bouton" onClick={() => setEtape("recherche")}>
                Retour
              </button>
              <button className="bouton principal" disabled={enCours || !fiche.prenom.trim()}>
                <AvecIcone icone={UserPlus}>Inscrire</AvecIcone>
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="explication">Le client donne son numéro de téléphone.</p>
            <ChampTelephone valeur={tel} onChange={setTel} onValider={() => void chercher()} enCours={enCours} bouton="Chercher" />
            {etape === "horsLigne" && (
              <div className="fidelite-alerte">
                <p>Serveur injoignable : la carte ne peut pas être vérifiée. Rattachée par le téléphone, elle recevra ses points à la synchronisation ; les récompenses attendent le réseau.</p>
                <button
                  className="bouton"
                  onClick={() => props.onChange({ ...c, fidelite: { membreId: null, telephone: normaliserTelephone(tel)!, prenom: "", solde: null, utilisations: [] } })}
                >
                  Rattacher sans vérifier
                </button>
              </div>
            )}
            {erreur && <p className="erreur">{erreur}</p>}
          </>
        )
      ) : choixArticle ? (
        <>
          <p className="explication">{choixArticle.libelle} : quel article ?</p>
          <div className="fidelite-articles-choix">
            {(choixArticle.articles ?? [])
              .map((id) => nomArticle(id))
              .filter((a) => a && a.prixTTC != null)
              .map((a) => (
                <button key={a!.id} className="tuile" onClick={() => void utiliser(choixArticle, a!.id)}>
                  <span className="tuile-nom">{a!.nom}</span>
                  <span className="tuile-prix">Offert · {euros(a!.prixTTC!)}</span>
                </button>
              ))}
          </div>
          <button className="bouton" onClick={() => setChoixArticle(null)}>
            Retour
          </button>
        </>
      ) : (
        <>
          <div className="fidelite-membre">
            <strong>{f.prenom || telephoneLisible(f.telephone)}</strong>
            <span>{f.solde != null ? unite(regles, f.solde) : "solde à la synchronisation"}</span>
            {f.prenom && <small>{telephoneLisible(f.telephone)}</small>}
          </div>
          {!f.membreId ? (
            <p className="explication">Rattachée hors ligne : les points seront crédités quand le serveur recevra le ticket.</p>
          ) : suite ? (
            <p className="explication">
              Prochaine récompense : {suite.recompense.libelle}, encore {unite(regles, suite.manque)}.
            </p>
          ) : null}
          {f.utilisations.length > 0 && (
            <ul className="fidelite-utilisees" role="list" aria-label="Récompenses appliquées">
              {f.utilisations.map((u) => (
                <li key={u.id}>
                  <span>
                    <AvecIcone icone={Gift} taille={16}>
                      {u.libelle}
                    </AvecIcone>
                  </span>
                  <button className="bouton discret" disabled={enCours} onClick={() => void retirer(u.id)}>
                    <AvecIcone icone={X}>Retirer</AvecIcone>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {f.membreId && (
            <ul className="fidelite-recompenses-caisse" role="list" aria-label="Récompenses">
              {recompensesTriees(regles).map((r) => {
                const atteinte = (f.solde ?? 0) >= r.seuil;
                return (
                  <li key={r.id} className={atteinte ? "atteinte" : ""}>
                    <span>
                      <strong>{r.libelle}</strong>
                      <small>{unite(regles, r.seuil)}</small>
                    </span>
                    <button className={`bouton${atteinte ? " principal" : ""}`} disabled={enCours || !atteinte || uneSeule} onClick={() => void utiliser(r)}>
                      Utiliser
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {uneSeule && <p className="explication petite">Une récompense par ticket.</p>}
          {erreur && <p className="erreur">{erreur}</p>}
          <div className="fidelite-actions">
            <button className="bouton discret" disabled={enCours} onClick={() => void detacher()}>
              <AvecIcone icone={Unlink}>Détacher la carte</AvecIcone>
            </button>
            {!f.membreId && (
              <button className="bouton" disabled={enCours} onClick={() => void verifier()}>
                Vérifier maintenant
              </button>
            )}
            <button className="bouton principal" onClick={props.onFermer}>
              Terminé
            </button>
          </div>
        </>
      )}
    </Modale>
  );
}

/** Client qui avait oublié sa carte : un ticket du jour se rattache, une seule fois, depuis l'écran Tickets. */
export function RattachementFidelite(props: { ticket: Ticket }) {
  const { caisse, config, notifier } = useCaisse();
  const [ouvert, setOuvert] = useState(false);
  const [tel, setTel] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [fait, setFait] = useState<string | null>(null);
  const [erreur, setErreur] = useState("");
  const t = props.ticket;
  useEffect(() => {
    if (t.caisseId === config.caisseId) void caisse.db.get("fidelite", t.numero).then((l) => l && setFait("Ce ticket part déjà avec une carte de fidélité."));
  }, [caisse.db, config.caisseId, t.caisseId, t.numero]);
  if (fait) return <p className="explication">{fait}</p>;
  const rattacher = async () => {
    const n = normaliserTelephone(tel);
    if (!n) return setErreur("Numéro de téléphone invalide.");
    setEnCours(true);
    setErreur("");
    try {
      const r = await caisse.client.rattacherTicketFidelite(t.caisseId, t.numero, n);
      const texte = `Ticket rattaché à la carte de ${r.membre.prenom} : +${unite(config.fidelite!.regles, r.points)}, solde ${unite(config.fidelite!.regles, r.membre.solde)}.`;
      setFait(texte);
      notifier(texte);
    } catch (e) {
      setErreur(e instanceof ErreurApi && e.code === "TICKET_INCONNU" ? "Le serveur n'a pas encore reçu ce ticket : réessayez dans un instant." : message(e));
    } finally {
      setEnCours(false);
    }
  };
  return (
    <div className="fidelite-rattachement">
      {!ouvert ? (
        <button className="bouton" onClick={() => setOuvert(true)}>
          <AvecIcone icone={Gift}>Ajouter à une carte de fidélité</AvecIcone>
        </button>
      ) : (
        <>
          <p className="explication">Le client avait oublié sa carte : son numéro, et la vente compte pour lui (une seule fois).</p>
          <ChampTelephone valeur={tel} onChange={setTel} onValider={() => void rattacher()} enCours={enCours} bouton="Rattacher" />
        </>
      )}
      {erreur && <p className="erreur">{erreur}</p>}
    </div>
  );
}
