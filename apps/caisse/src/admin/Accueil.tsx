import { emplacementsFiches } from "@matalon/catalogue";
import { dateComptable } from "@matalon/noyau-fiscal";
import type { Reservation } from "@matalon/reservations";
import type { AlerteApi, ReponseStatistiques } from "@matalon/serveur/partage";
import { ArrowRight, Check, Gift, ImagePlus, Lock, Package, ScrollText, Smartphone, Tablet, Tag, TriangleAlert, UserPlus, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { typeDepuisDescription } from "../donnees/appareil";
import { api, type EtablissementAdmin } from "./api";
import type { Rubrique } from "./Coque";

/**
 * Accueil « Aujourd'hui » de l'administration (refonte du 25 octobre 2026) : les indicateurs du
 * jour en direct (mêmes calculs et même comparaison que les statistiques), le CA par heure face au
 * même jour de la semaine précédente, les alertes à lire, les réglages en attente, les réservations
 * du jour et l'état des appareils. Chaque ligne mène à la rubrique qui la traite.
 */

const euros = (c: number, decimales = true) =>
  (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: decimales ? 2 : 0, maximumFractionDigits: decimales ? 2 : 0 });
const pluriel = (n: number, mot: string) => `${n.toLocaleString("fr-FR")} ${mot}${Math.abs(n) > 1 ? "s" : ""}`;
const heureMinute = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", " h ");
const jourLong = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const jourCourt = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const depuis = (iso: string | null, maintenant: number) => {
  if (!iso) return "jamais synchronisé";
  const s = Math.max(0, Math.round((maintenant - Date.parse(iso)) / 1000));
  if (s < 60) return `synchro il y a ${s} s`;
  if (s < 3600) return `synchro il y a ${Math.round(s / 60)} min`;
  if (s < 86_400) return `synchro il y a ${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`;
  return `synchro le ${new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
};
/** Une caisse synchronise chaque minute en ligne : au-delà de trois, on la dit hors ligne. */
const EN_LIGNE_MS = 3 * 60_000;
/** Journée de service affichée : 8 h à 3 h du matin, comme les statistiques. */
const HEURES = [...Array.from({ length: 16 }, (_, i) => i + 8), 0, 1, 2];

function Variation(props: { actuel: number; precedent: number; format: (n: number) => string; comparaison: string; hausseFavorable?: boolean }) {
  if (props.precedent === 0 && props.actuel === 0) return <p className="accueil-variation neutre">{props.comparaison}</p>;
  if (props.precedent === 0) return <p className="accueil-variation neutre">Nouveau · {props.comparaison}</p>;
  const ecart = props.actuel - props.precedent;
  if (ecart === 0) return <p className="accueil-variation neutre">Stable · {props.comparaison}</p>;
  const bon = ecart > 0 === (props.hausseFavorable ?? true);
  return (
    <p className={`accueil-variation ${bon ? "bon" : "mauvais"}`}>
      <strong>
        <span aria-hidden="true">{ecart > 0 ? "▲" : "▼"}</span>
        <span className="lecteur-ecran">{ecart > 0 ? "En hausse de" : "En baisse de"}</span> {props.format(Math.abs(ecart))}
      </strong>{" "}
      {props.comparaison}
    </p>
  );
}

function Indicateur(props: { libelle: string; valeur: string; children?: ReactNode; accent?: boolean }) {
  return (
    <div className={`accueil-indicateur${props.accent ? " accent" : ""}`}>
      <p className="accueil-indicateur-libelle">{props.libelle}</p>
      <p className="accueil-indicateur-valeur">{props.valeur}</p>
      {props.children}
    </div>
  );
}

/** Carte de l'accueil : titre, compteur, lien vers la rubrique, lignes. */
function Carte(props: { titre: string; compteur?: ReactNode; lien?: { libelle: string; onClick: () => void }; children: ReactNode }) {
  return (
    <section className="accueil-carte" aria-label={props.titre}>
      <div className="accueil-carte-tete">
        <h2>
          {props.titre} {props.compteur}
        </h2>
        {props.lien && (
          <button type="button" className="lien-action" onClick={props.lien.onClick}>
            {props.lien.libelle}
          </button>
        )}
      </div>
      {props.children}
    </section>
  );
}

function Ligne(props: { icone: LucideIcon; ton: "danger" | "attention" | "neutre"; titre: string; detail: string; action?: ReactNode }) {
  const Icone = props.icone;
  return (
    <div className="accueil-ligne">
      <span className={`accueil-pastille ${props.ton}`} aria-hidden="true">
        <Icone size={18} />
      </span>
      <div className="accueil-ligne-texte">
        <strong>{props.titre}</strong>
        <small>{props.detail}</small>
      </div>
      {props.action}
    </div>
  );
}

const ICONES_ALERTE: Record<AlerteApi["type"], LucideIcon> = { PIN_BLOQUE: Lock, PRIX_DIFFERENT: Tag, ARTICLE_HORS_CARTE: Tag };
const LIBELLES_ALERTE: Record<AlerteApi["type"], string> = {
  PRIX_DIFFERENT: "Prix différent de la carte",
  ARTICLE_HORS_CARTE: "Article hors carte",
  PIN_BLOQUE: "Code PIN bloqué",
};

/** Rafraîchit tant que la page est visible ; une erreur passagère garde la dernière valeur. */
function useDonnee<T>(charger: () => Promise<T>, periodeMs: number): [T | null, string, () => Promise<void>] {
  const [valeur, setValeur] = useState<T | null>(null);
  const [erreur, setErreur] = useState("");
  const fonction = useRef(charger);
  fonction.current = charger;
  const recharger = useCallback(async () => {
    try {
      setValeur(await fonction.current());
      setErreur("");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void recharger();
    const t = setInterval(() => document.visibilityState === "visible" && void recharger(), periodeMs);
    return () => clearInterval(t);
  }, [recharger, periodeMs]);
  return [valeur, erreur, recharger];
}

export function Accueil(props: { e: EtablissementAdmin; onAller: (r: Rubrique, options?: { carte?: string }) => void; onChange: () => Promise<void> }) {
  const { e } = props;
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const jour = dateComptable(new Date(maintenant));
  const [stats, erreurStats] = useDonnee(() => api.statistiques(e.id, dateComptable(new Date()), dateComptable(new Date())), 10_000);
  const [alertes, , rechargerAlertes] = useDonnee(() => api.alertes(e.id).then((r) => r.alertes), 30_000);
  const [resas] = useDonnee(
    () =>
      Promise.all([api.reglagesReservation(e.id), api.reservations(e.id, dateComptable(new Date()))]).then(([r, l]) => ({
        actif: r.reglages.actif,
        liste: l.reservations,
      })),
    60_000,
  );
  const [sansFiche] = useDonnee(
    () =>
      api.carte(e.carteId).then((c) => {
        const articles = new Set(emplacementsFiches(c.carte).filter((x) => !x.cle.includes("+") && !x.formule && !x.fiche).map((x) => x.articleId));
        return articles.size;
      }),
    300_000,
  );
  const [fidelite] = useDonnee(() => api.fidelite(e.id).then((f) => f.programme), 300_000);
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  // Les alertes du menu et de la cloche suivent celles de l'accueil.
  useEffect(() => void rechargerAlertes(), [e.alertesNonVues, rechargerAlertes]);

  const vue = async (a: AlerteApi) => {
    await api.marquerAlerteVue(a.id);
    await rechargerAlertes();
    await props.onChange();
  };

  const nomCaisse = (id: string | null) => e.caisses.find((c) => c.id === id)?.nom ?? "Serveur";
  const nomTable = (id: string) => e.tables.find((t) => t.id === id)?.nom ?? id;

  // À faire : réglages en attente, du plus engageant au plus confortable.
  const aFaire: Array<{ icone: LucideIcon; titre: string; detail: string; bouton: string; aller: () => void; ton?: "danger" | "attention" }> = [];
  const actives = e.caisses.filter((c) => !c.revoqueeLe);
  for (const c of actives.filter((x) => x.divergence))
    aFaire.push({ icone: TriangleAlert, titre: `Divergence sur ${c.nom}`, detail: c.divergence!, bouton: "Voir", aller: () => props.onAller("appareils"), ton: "danger" });
  if (!e.utilisateurs.some((u) => u.role === "responsable" && u.actif))
    aFaire.push({ icone: UserPlus, titre: "Aucun responsable dans l'équipe", detail: "Sans lui, personne ne peut ouvrir la caisse ni la clôturer", bouton: "Ajouter", aller: () => props.onAller("equipe"), ton: "attention" });
  if (actives.length === 0) aFaire.push({ icone: Tablet, titre: "Aucun appareil rattaché", detail: "Rattachez l'iPad ou l'iPhone qui encaissera", bouton: "Rattacher", aller: () => props.onAller("appareils") });
  const i = e.identite;
  if (!i.raisonSociale || !i.siret || !i.tvaIntracom || !i.adresse || !i.mentionsLegales)
    aFaire.push({
      icone: ScrollText,
      titre: "Identité légale incomplète",
      detail: "Raison sociale, adresse, SIRET et TVA figurent sur chaque note ; forme, capital et RCS sur les factures",
      bouton: "Compléter",
      aller: () => props.onAller("identite"),
      ton: "attention",
    });
  if (sansFiche)
    aFaire.push({
      icone: Package,
      titre: `${pluriel(sansFiche, "article")} sans fiche technique`,
      detail: "Leur consommation de stock et leur food cost ne sont pas calculés",
      bouton: "Relier",
      aller: () => props.onAller("cartes", { carte: e.carteId }),
    });
  if (!e.logo)
    aFaire.push({ icone: ImagePlus, titre: `Logo ${e.identite.enseigne ? `de ${e.identite.enseigne} ` : ""}à déposer`, detail: "Absent du module de réservation et des e-mails aux clients", bouton: "Déposer", aller: () => props.onAller("identite") });
  if (fidelite !== null && !fidelite?.actif)
    aFaire.push({
      icone: Gift,
      titre: fidelite ? "Programme de fidélité non activé" : "Pas de programme de fidélité",
      detail: fidelite ? "Règle et récompense à choisir, puis activer" : "Les points se gagnent au téléphone du client, en caisse",
      bouton: "Configurer",
      aller: () => props.onAller("fidelite"),
    });

  const ind = stats?.indicateurs;
  const avant = stats?.indicateursPrecedents;
  const comparaison = stats ? `vs ${jourCourt(stats.precedente.du)}${stats.precedente.jusqua ? ` à ${stats.precedente.jusqua.replace(":", " h ")}` : ""}` : "";
  const resasActives = resas?.liste.filter((r) => r.statut !== "annulee").sort((a, b) => a.heure.localeCompare(b.heure)) ?? [];
  const aLire = alertes?.filter((a) => !a.vueLe) ?? [];

  return (
    <div className="accueil">
      <div className="a-page-tete accueil-tete">
        <div>
          <p className="a-page-surtitre">Journée du {jourLong(jour)}</p>
          <h1 className="a-page-titre">Aujourd'hui</h1>
        </div>
        <div className="a-page-actions">
          {stats && (
            <span className={`accueil-direct${erreurStats ? " hors-ligne" : ""}`} role="status">
              <span aria-hidden="true" className="accueil-direct-point" />
              {erreurStats ? "Connexion perdue · nouvel essai dans 10 s" : `En direct · ${heureMinute(stats.calculeLe)}`}
            </span>
          )}
          <button type="button" className="bouton" onClick={() => props.onAller("statistiques")}>
            Statistiques détaillées
            <ArrowRight className="icone" size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!stats ? (
        <p className="explication">{erreurStats || "Chargement des indicateurs…"}</p>
      ) : (
        <>
          <div className="accueil-indicateurs">
            <Indicateur libelle="CA TTC" valeur={euros(ind!.caTTC, false)}>
              <Variation
                actuel={ind!.caTTC}
                precedent={avant!.caTTC}
                format={() => `${Math.round((Math.abs(ind!.caTTC - avant!.caTTC) / Math.abs(avant!.caTTC || 1)) * 100)} %`}
                comparaison={comparaison}
              />
            </Indicateur>
            <Indicateur libelle="Tickets" valeur={ind!.ventesConservees.toLocaleString("fr-FR")}>
              <Variation actuel={ind!.ventesConservees} precedent={avant!.ventesConservees} format={(n) => pluriel(n, "ticket")} comparaison="" />
            </Indicateur>
            <Indicateur libelle="Ticket moyen" valeur={euros(ind!.ticketMoyen)}>
              <Variation actuel={ind!.ticketMoyen} precedent={avant!.ticketMoyen} format={(n) => `${euros(n)} par ticket`} comparaison="" />
            </Indicateur>
            <Indicateur libelle="Couverts" valeur={ind!.couverts.toLocaleString("fr-FR")}>
              <p className="accueil-variation neutre">{ind!.couverts ? `${euros(ind!.parCouvert)} par couvert` : "Aucune table servie"}</p>
            </Indicateur>
            <Indicateur libelle="En salle maintenant" valeur={stats.enCours ? pluriel(stats.enCours.tables, "table") : "—"} accent>
              <p className="accueil-variation neutre">
                {stats.enCours && stats.enCours.tables ? (
                  <>
                    {pluriel(stats.enCours.couverts, "couvert")} · <strong className="texte-accent">{euros(stats.enCours.montantTTC - stats.enCours.acomptesTTC, false)} à encaisser</strong>
                  </>
                ) : (
                  "Aucune table ouverte"
                )}
              </p>
            </Indicateur>
          </div>
          <CaParHeure stats={stats} />
        </>
      )}

      <div className="accueil-colonnes">
        <div className="accueil-colonne">
          <Carte
            titre="Alertes"
            compteur={aLire.length > 0 && <span className="compteur danger">{aLire.length} à lire</span>}
            lien={{ libelle: "Toutes les alertes", onClick: () => props.onAller("alertes") }}
          >
            {!alertes ? (
              <p className="accueil-vide">Chargement…</p>
            ) : aLire.length === 0 ? (
              <p className="accueil-vide">Aucune alerte à lire : prix conformes à la carte, aucun code PIN bloqué.</p>
            ) : (
              aLire.slice(0, 4).map((a) => (
                <Ligne
                  key={a.id}
                  icone={ICONES_ALERTE[a.type] ?? TriangleAlert}
                  ton={a.type === "PIN_BLOQUE" ? "danger" : "attention"}
                  titre={LIBELLES_ALERTE[a.type] ?? a.type}
                  detail={`${a.message} · ${nomCaisse(a.caisseId)} · ${heureMinute(a.creeLe)}`}
                  action={
                    <button type="button" className="bouton" onClick={() => void vue(a)} aria-label={`Marquer vue : ${LIBELLES_ALERTE[a.type] ?? a.type}`}>
                      <Check className="icone" size={18} aria-hidden="true" />
                      Vu
                    </button>
                  }
                />
              ))
            )}
            {aLire.length > 4 && <p className="accueil-vide">Et {pluriel(aLire.length - 4, "autre alerte")} dans la rubrique Alertes.</p>}
          </Carte>
          <Carte titre="À faire" compteur={aFaire.length > 0 && <span className="compteur">{aFaire.length}</span>}>
            {aFaire.length === 0 ? (
              <p className="accueil-vide">Rien en attente : l'établissement est entièrement réglé.</p>
            ) : (
              aFaire.map((f) => (
                <Ligne
                  key={f.titre}
                  icone={f.icone}
                  ton={f.ton ?? "neutre"}
                  titre={f.titre}
                  detail={f.detail}
                  action={
                    <button type="button" className="bouton" onClick={f.aller}>
                      {f.bouton}
                    </button>
                  }
                />
              ))
            )}
          </Carte>
        </div>

        <div className="accueil-colonne">
          <Carte
            titre="Réservations du jour"
            compteur={resasActives.length > 0 && <span className="compteur discret">{`${resasActives.length} · ${pluriel(resasActives.reduce((s, r) => s + r.couverts, 0), "couvert")}`}</span>}
            lien={{ libelle: "Tout voir", onClick: () => props.onAller("reservations") }}
          >
            {!resas ? (
              <p className="accueil-vide">Chargement…</p>
            ) : resasActives.length === 0 ? (
              <p className="accueil-vide">{resas.actif ? "Aucune réservation aujourd'hui." : "Réservations en ligne non ouvertes."}</p>
            ) : (
              <ul className="accueil-resas">
                {resasActives.map((r) => (
                  <LigneResa key={r.id} r={r} tables={r.tables.map(nomTable).join(" + ")} maintenant={maintenant} />
                ))}
              </ul>
            )}
          </Carte>
          <Carte titre="Appareils" lien={{ libelle: "Gérer", onClick: () => props.onAller("appareils") }}>
            {actives.length === 0 && !e.imprimanteTickets ? (
              <p className="accueil-vide">Aucun appareil rattaché.</p>
            ) : (
              <div className="accueil-appareils">
                {actives.map((c) => {
                  const enLigne = c.derniereSynchro != null && maintenant - Date.parse(c.derniereSynchro) < EN_LIGNE_MS;
                  const type = typeDepuisDescription(c.appareil);
                  const Icone = type === "iPhone" ? Smartphone : Tablet;
                  return (
                    <div key={c.id} className="accueil-appareil">
                      <strong>
                        <Icone className={`icone${type === "iPhone" ? "" : " paysage"}`} size={16} aria-hidden="true" />
                        {c.nom}
                      </strong>
                      <small>
                        <span className={c.divergence ? "etat danger" : enLigne ? "etat bon" : "etat attention"}>● {c.divergence ? "Divergence" : enLigne ? "En ligne" : "Hors ligne"}</span>{" "}
                        {depuis(c.derniereSynchro, maintenant)}
                      </small>
                    </div>
                  );
                })}
                <div className="accueil-appareil">
                  <strong>Imprimante des tickets</strong>
                  <small>
                    {e.imprimanteTickets ? (
                      <>
                        <span className="etat bon">● Réglée</span> <span className="chiffres">{e.imprimanteTickets.adresse}</span>
                      </>
                    ) : (
                      <span className="etat attention">● Non réglée</span>
                    )}
                  </small>
                </div>
              </div>
            )}
          </Carte>
        </div>
      </div>
    </div>
  );
}

function LigneResa(props: { r: Reservation; tables: string; maintenant: number }) {
  const { r } = props;
  const passee = r.statut === "arrivee" || r.statut === "absente";
  const etat = r.statut === "arrivee" ? "Arrivée" : r.statut === "absente" ? "Absente" : r.tables.length ? "Confirmée" : "À placer";
  const ton = passee ? "neutre" : r.tables.length ? "bon" : "attention";
  return (
    <li className={`accueil-resa${passee ? " passee" : ""}`}>
      <span className="chiffres accueil-resa-heure">{r.heure}</span>
      <span className="accueil-resa-nom">
        {[r.prenom, r.nom].filter(Boolean).join(" ")} <small>· {r.couverts} pers.</small>
      </span>
      <span className="accueil-resa-table">{props.tables || "—"}</span>
      <span className={`accueil-resa-etat ${ton}`}>{etat}</span>
    </li>
  );
}

/** CA par heure de la journée de service, face au même jour de la semaine précédente. */
function CaParHeure(props: { stats: ReponseStatistiques }) {
  const { stats } = props;
  const jour = stats.parHeure;
  const avant = stats.parHeurePrecedente ?? [];
  // Une vente hors de 8 h – 3 h élargit l'axe, comme dans les statistiques.
  const heures = [...new Set([...HEURES, ...jour.filter((h) => h.ttc !== 0).map((h) => h.heure)])].sort((a, b) => ((a + 24 - 5) % 24) - ((b + 24 - 5) % 24));
  const max = Math.max(1, ...heures.map((h) => Math.max(jour[h]?.ttc ?? 0, avant[h]?.ttc ?? 0)));
  const hauteur = (v: number) => `${Math.max(0, Math.round((v / max) * 100))}%`;
  const libelleAvant = new Date(`${stats.precedente.du}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <section className="accueil-carte accueil-heures" aria-label="CA par heure">
      <div className="accueil-carte-tete">
        <h2>CA par heure</h2>
        <p className="accueil-legende">
          <span>
            <span className="accueil-legende-carre jour" aria-hidden="true" />
            Aujourd'hui
          </span>
          <span>
            <span className="accueil-legende-carre avant" aria-hidden="true" />
            {libelleAvant[0]!.toUpperCase() + libelleAvant.slice(1)}
          </span>
        </p>
      </div>
      <div className="accueil-barres" role="img" aria-label={`CA par heure : ${heures.filter((h) => (jour[h]?.ttc ?? 0) > 0).map((h) => `${h} h ${euros(jour[h]!.ttc, false)}`).join(", ") || "aucune vente"}`}>
        {heures.map((h) => (
          <div key={h} className="accueil-barre" title={`${h} h : ${euros(jour[h]?.ttc ?? 0, false)} (${euros(avant[h]?.ttc ?? 0, false)} ${libelleAvant})`}>
            <span className="avant" style={{ height: hauteur(avant[h]?.ttc ?? 0) }} />
            <span className="jour" style={{ height: hauteur(jour[h]?.ttc ?? 0) }} />
          </div>
        ))}
      </div>
      <div className="accueil-heures-libelles" aria-hidden="true">
        {heures.map((h, i) => (
          <span key={h}>{i === 0 ? `${h} h` : h}</span>
        ))}
      </div>
    </section>
  );
}
