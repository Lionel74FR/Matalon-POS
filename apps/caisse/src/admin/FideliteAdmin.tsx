import type { Catalogue } from "@matalon/catalogue";
import {
  LIBELLES_MOUVEMENT,
  problemeRegles,
  RECOMPENSES_MAX,
  telephoneLisible,
  unite,
  type MembreFidelite,
  type MouvementFidelite,
  type ProgrammeFidelite,
  type RecompenseFidelite,
  type ReglesFidelite,
  type TypeRecompense,
} from "@matalon/serveur/fidelite";
import { Gift, LogOut, Plus, RotateCw, Save, Search, Trash2, UserX } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Modale } from "../ui/communs";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api, type EtablissementAdmin } from "./api";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" }) : "—");
const dateHeure = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
const TYPES: Array<[TypeRecompense, string]> = [
  ["ARTICLE", "Article offert"],
  ["REMISE_EUROS", "Remise en euros"],
  ["REMISE_POURCENT", "Remise en %"],
];
/** Nombre saisi ou null (champ vide). */
const nombre = (v: string) => (v.trim() === "" ? null : Math.round(Number(v.replace(",", "."))));

function useEnvoi() {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const envoyer = useCallback(async (action: () => Promise<void>) => {
    setEnCours(true);
    setErreur("");
    try {
      await action();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
    }
  }, []);
  return { enCours, erreur, envoyer };
}

function Champ(props: { libelle: string; aide?: string; children: ReactNode }) {
  return (
    <label className="champ">
      <span>
        {props.libelle}
        {props.aide && <small>{props.aide}</small>}
      </span>
      {props.children}
    </label>
  );
}

/** Cases à cocher d'une liste (catégories, articles, moments). */
function Cases(props: { legende: string; options: Array<{ id: string; nom: string }>; valeur: string[]; onChange: (ids: string[]) => void; vide?: string }) {
  if (!props.options.length) return <p className="explication">{props.vide ?? "Rien à choisir."}</p>;
  return (
    <div className="fidelite-cases" role="group" aria-label={props.legende}>
      {props.options.map((o) => (
        <label key={o.id} className="case">
          <input
            type="checkbox"
            checked={props.valeur.includes(o.id)}
            onChange={(e) => props.onChange(e.target.checked ? [...props.valeur, o.id] : props.valeur.filter((x) => x !== o.id))}
          />
          {o.nom}
        </label>
      ))}
    </div>
  );
}

/**
 * Carte de fidélité de l'établissement (lot 7a) : création ou adhésion au programme d'un autre
 * établissement, règles (points ou tampons, récompenses, bonus, exclusions, validité) et membres.
 */
export function FideliteAdmin(props: { e: EtablissementAdmin }) {
  const { e } = props;
  const [donnees, setDonnees] = useState<Awaited<ReturnType<typeof api.fidelite>> | null>(null);
  const [carte, setCarte] = useState<Catalogue | null>(null);
  const [rejoindre, setRejoindre] = useState("");
  const { enCours, erreur, envoyer } = useEnvoi();
  const charger = useCallback(() => envoyer(async () => setDonnees(await api.fidelite(e.id))), [envoyer, e.id]);
  useEffect(() => void charger(), [charger]);
  useEffect(() => {
    api.carte(e.carteId).then((r) => setCarte(r.carte), () => setCarte(null));
  }, [e.carteId]);

  const programme = donnees?.programme ?? null;
  const action = (a: "creer" | "rejoindre" | "quitter", id?: string) =>
    envoyer(async () => {
      await api.actionFidelite(e.id, a, id);
      setDonnees(await api.fidelite(e.id));
    });

  return (
    <section className="admin-section fidelite-admin">
      <h2 className="titre-icone">
        <AvecIcone icone={Gift} taille={22}>
          Carte de fidélité
        </AvecIcone>
      </h2>
      <p className="explication">
        Le client est reconnu en caisse par son numéro de téléphone. Il cumule à chaque vente reçue par le serveur, et une récompense
        atteinte s'applique sur le ticket comme une remise « Fidélité » : les points ne sont jamais un moyen de paiement, le noyau
        fiscal n'est pas touché. Les e-mails (bienvenue, récompense atteinte) partent avec l'expéditeur des réservations. Les clients
        sont informés sur la{" "}
        <a href={`/donnees/${e.id}`} target="_blank" rel="noopener">
          page d'information sur les données
        </a>
        .
      </p>
      {erreur && <p className="erreur">{erreur}</p>}
      {!donnees ? (
        <p className="explication">Chargement…</p>
      ) : !programme ? (
        <div className="admin-carte">
          <p>{e.identite.enseigne} n'a pas de programme. Créez le sien (inactif tant que vous ne l'activez pas), ou rejoignez celui d'un autre établissement du groupe : mêmes règles, même solde pour le client.</p>
          <div className="admin-ligne">
            <button className="bouton principal" disabled={enCours} onClick={() => void action("creer")}>
              <AvecIcone icone={Plus}>Créer le programme</AvecIcone>
            </button>
            {donnees.autres.length > 0 && (
              <>
                <select aria-label="Programme à rejoindre" value={rejoindre} onChange={(x) => setRejoindre(x.target.value)}>
                  <option value="">Rejoindre un programme…</option>
                  {donnees.autres.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nom} ({a.enseigne})
                    </option>
                  ))}
                </select>
                <button className="bouton" disabled={!rejoindre || enCours} onClick={() => void action("rejoindre", rejoindre)}>
                  Rejoindre
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="fidelite-entete">
            <span className={`pastille${programme.actif ? " active" : ""}`}>{programme.actif ? "Actif" : "Inactif"}</span>
            <span>
              {programme.nom} · {programme.membres.toLocaleString("fr-FR")} membre{programme.membres > 1 ? "s" : ""}
              {programme.etablissements.length > 1 && ` · partagé par ${programme.etablissements.map((x) => x.enseigne).join(", ")}`}
            </span>
            <button
              className="bouton discret"
              disabled={enCours}
              onClick={() => {
                if (confirm(`Retirer ${e.identite.enseigne} du programme « ${programme.nom} » ? La caisse ne proposera plus la fidélité ; les membres et leurs points restent.`)) void action("quitter");
              }}
            >
              <AvecIcone icone={LogOut}>Quitter le programme</AvecIcone>
            </button>
          </div>
          <EditeurProgramme key={programme.id} programme={programme} carte={carte} e={e} onEnregistre={(p) => setDonnees({ ...donnees, programme: p })} />
          <Membres programme={programme} />
        </>
      )}
    </section>
  );
}

function EditeurProgramme(props: { programme: ProgrammeFidelite; carte: Catalogue | null; e: EtablissementAdmin; onEnregistre: (p: ProgrammeFidelite) => void }) {
  const { programme, carte } = props;
  const [nom, setNom] = useState(programme.nom);
  const [actif, setActif] = useState(programme.actif);
  const [r, setR] = useState<ReglesFidelite>(programme.regles);
  const [ok, setOk] = useState("");
  const { enCours, erreur, envoyer } = useEnvoi();
  const maj = (x: Partial<ReglesFidelite>) => {
    setOk("");
    setR((v) => ({ ...v, ...x }));
  };
  const majRecompense = (id: string, x: Partial<RecompenseFidelite>) => maj({ recompenses: r.recompenses.map((y) => (y.id === id ? { ...y, ...x } : y)) });
  const categories = (carte?.categories ?? []).map((c) => ({ id: c.id, nom: c.nom }));
  const articles = (carte?.categories ?? []).flatMap((c) => c.articles.filter((a) => a.prixTTC !== null).map((a) => ({ id: a.id, nom: a.nom })));
  const probleme = problemeRegles(r) ?? (nom.trim() ? null : "Donnez un nom au programme.");
  const u = r.mode === "TAMPONS" ? "tampons" : "points";

  const enregistrer = (ev: FormEvent) => {
    ev.preventDefault();
    void envoyer(async () => {
      const { programme: p } = await api.enregistrerProgramme(programme.id, { nom: nom.trim(), actif, regles: r, version: programme.version });
      props.onEnregistre(p);
      setOk("Programme enregistré : la caisse l'applique à sa prochaine synchronisation.");
    });
  };

  return (
    <form className="fidelite-editeur" onSubmit={enregistrer}>
      {programme.etablissements.length > 1 && <p className="admin-alerte">Ces règles valent pour {programme.etablissements.map((x) => x.enseigne).join(", ")}.</p>}
      <fieldset>
        <legend>Programme</legend>
        <Champ libelle="Nom affiché au client">
          <input value={nom} maxLength={40} onChange={(x) => setNom(x.target.value)} />
        </Champ>
        <label className="case">
          <input type="checkbox" checked={actif} onChange={(x) => setActif(x.target.checked)} />
          Programme actif : la caisse propose la fidélité sur chaque commande
        </label>
      </fieldset>

      <fieldset>
        <legend>Cumul</legend>
        <div className="fidelite-choix" role="radiogroup" aria-label="Mode de cumul">
          <label className="case">
            <input type="radio" name="mode" checked={r.mode === "POINTS"} onChange={() => maj({ mode: "POINTS" })} />
            Points sur la dépense (un cadeau tous les X euros)
          </label>
          <label className="case">
            <input type="radio" name="mode" checked={r.mode === "TAMPONS"} onChange={() => maj({ mode: "TAMPONS" })} />
            Tampons (le 10ᵉ café offert)
          </label>
        </div>
        {r.mode === "POINTS" ? (
          <Champ libelle="Points par euro TTC" aide="Sur les articles vendus, hors catégories exclues et hors récompenses.">
            <input type="number" min={1} max={100} value={r.pointsParEuro} onChange={(x) => maj({ pointsParEuro: nombre(x.target.value) ?? 0 })} />
          </Champ>
        ) : (
          <>
            <Champ libelle="Un tampon">
              <select
                aria-label="Un tampon"
                value={r.tampon.par}
                onChange={(x) => maj({ tampon: x.target.value === "ARTICLE" ? { par: "ARTICLE", categories: [] } : { par: "VISITE", montantMin: 0 } })}
              >
                <option value="ARTICLE">par article des catégories choisies</option>
                <option value="VISITE">par visite, à partir d'un montant</option>
              </select>
            </Champ>
            {r.tampon.par === "ARTICLE" ? (
              <Cases legende="Catégories qui donnent un tampon" options={categories} valeur={r.tampon.categories} onChange={(ids) => maj({ tampon: { par: "ARTICLE", categories: ids } })} />
            ) : (
              <Champ libelle="Montant minimum d'une visite (€)">
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={r.tampon.montantMin / 100}
                  onChange={(x) => maj({ tampon: { par: "VISITE", montantMin: Math.round(Number(x.target.value || 0) * 100) } })}
                />
              </Champ>
            )}
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Récompenses</legend>
        <ul className="fidelite-recompenses" role="list">
          {r.recompenses.map((x) => (
            <li key={x.id} className="fidelite-recompense">
              <div className="fidelite-recompense-ligne">
                <label className="champ">
                  <span>Libellé</span>
                  <input aria-label="Libellé de la récompense" value={x.libelle} maxLength={60} onChange={(v) => majRecompense(x.id, { libelle: v.target.value })} />
                </label>
                <label className="champ">
                  <span>À ({u})</span>
                  <input aria-label={`${x.libelle || "Récompense"} : seuil`} type="number" min={1} value={x.seuil} onChange={(v) => majRecompense(x.id, { seuil: nombre(v.target.value) ?? 0 })} />
                </label>
                <label className="champ">
                  <span>Type</span>
                  <select
                    aria-label={`${x.libelle || "Récompense"} : type`}
                    value={x.type}
                    onChange={(v) => {
                      const type = v.target.value as TypeRecompense;
                      majRecompense(x.id, { type, articles: type === "ARTICLE" ? (x.articles ?? []) : undefined, montant: type === "REMISE_EUROS" ? (x.montant ?? 500) : undefined, pourcentage: type === "REMISE_POURCENT" ? (x.pourcentage ?? 10) : undefined });
                    }}
                  >
                    {TYPES.map(([t, l]) => (
                      <option key={t} value={t}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                {x.type === "REMISE_EUROS" && (
                  <label className="champ">
                    <span>Montant (€)</span>
                    <input aria-label={`${x.libelle || "Récompense"} : montant`} type="number" min={0} step="0.5" value={(x.montant ?? 0) / 100} onChange={(v) => majRecompense(x.id, { montant: Math.round(Number(v.target.value || 0) * 100) })} />
                  </label>
                )}
                {x.type === "REMISE_POURCENT" && (
                  <label className="champ">
                    <span>Remise (%)</span>
                    <input aria-label={`${x.libelle || "Récompense"} : pourcentage`} type="number" min={1} max={100} value={x.pourcentage ?? 0} onChange={(v) => majRecompense(x.id, { pourcentage: nombre(v.target.value) ?? 0 })} />
                  </label>
                )}
                <BoutonIcone icone={Trash2} variante="discret" libelle={`Retirer ${x.libelle || "cette récompense"}`} onClick={() => maj({ recompenses: r.recompenses.filter((y) => y.id !== x.id) })} />
              </div>
              {x.type === "ARTICLE" && (
                <details className="fidelite-articles" open={!x.articles?.length}>
                  <summary>
                    Articles au choix : {x.articles?.length ? x.articles.map((id) => articles.find((a) => a.id === id)?.nom ?? id).join(", ") : "aucun"}
                  </summary>
                  <Cases legende={`Articles offerts : ${x.libelle}`} options={articles} valeur={x.articles ?? []} onChange={(ids) => majRecompense(x.id, { articles: ids })} vide="Carte en cours de chargement…" />
                </details>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="bouton"
          disabled={r.recompenses.length >= RECOMPENSES_MAX}
          onClick={() => maj({ recompenses: [...r.recompenses, { id: `r-${crypto.randomUUID().slice(0, 8)}`, libelle: "", seuil: (r.recompenses.at(-1)?.seuil ?? 0) + 50, type: "REMISE_EUROS", montant: 500 }] })}
        >
          <AvecIcone icone={Plus}>Ajouter une récompense</AvecIcone>
        </button>
        <label className="case">
          <input type="checkbox" checked={r.uneRecompenseParTicket} onChange={(x) => maj({ uneRecompenseParTicket: x.target.checked })} />
          Une seule récompense par ticket
        </label>
      </fieldset>

      <fieldset>
        <legend>Bonus et limites</legend>
        <Champ libelle={`Bienvenue (${u})`} aide="Offerts à l'inscription.">
          <input type="number" min={0} value={r.bienvenue} onChange={(x) => maj({ bienvenue: nombre(x.target.value) ?? 0 })} />
        </Champ>
        <p className="explication">Cumul doublé pendant ces moments de la journée :</p>
        <Cases
          legende="Moments doublés"
          options={(props.e.moments ?? []).map((m) => ({ id: m.id, nom: `${m.nom} (${m.debut}–${m.fin})` }))}
          valeur={r.momentsDoubles}
          onChange={(ids) => maj({ momentsDoubles: ids })}
          vide="Aucun moment défini : Statistiques › CA par moment › Définir les moments."
        />
        <p className="explication">Catégories qui ne rapportent rien :</p>
        <Cases legende="Catégories exclues" options={categories} valeur={r.categoriesExclues} onChange={(ids) => maj({ categoriesExclues: ids })} vide="Carte en cours de chargement…" />
        <Champ libelle={`Plafond par ticket (${u})`} aide="Vide : sans plafond.">
          <input type="number" min={1} value={r.plafondParTicket ?? ""} onChange={(x) => maj({ plafondParTicket: nombre(x.target.value) })} />
        </Champ>
        <Champ libelle="Points perdus après (mois sans visite)" aide="Vide : jamais.">
          <input type="number" min={1} max={60} value={r.moisValidite ?? ""} onChange={(x) => maj({ moisValidite: nombre(x.target.value) })} />
        </Champ>
      </fieldset>
      {probleme && <p className="erreur">{probleme}</p>}
      {erreur && <p className="erreur">{erreur}</p>}
      {ok && <p className="admin-ok">{ok}</p>}
      <button className="bouton principal" disabled={!!probleme || enCours}>
        <AvecIcone icone={Save}>{enCours ? "Enregistrement…" : "Enregistrer le programme"}</AvecIcone>
      </button>
    </form>
  );
}

function Membres(props: { programme: ProgrammeFidelite }) {
  const { programme } = props;
  const [q, setQ] = useState("");
  const [membres, setMembres] = useState<MembreFidelite[] | null>(null);
  const [fiche, setFiche] = useState<string | null>(null);
  const { enCours, erreur, envoyer } = useEnvoi();
  const chercher = useCallback((texte: string) => envoyer(async () => setMembres((await api.membresFidelite(programme.id, texte.trim())).membres)), [envoyer, programme.id]);
  useEffect(() => void chercher(""), [chercher]);

  return (
    <div className="fidelite-membres">
      <h3>Membres</h3>
      <form
        className="admin-ligne"
        role="search"
        onSubmit={(ev) => {
          ev.preventDefault();
          void chercher(q);
        }}
      >
        <input aria-label="Chercher un membre" placeholder="Prénom, nom, e-mail ou téléphone" value={q} onChange={(x) => setQ(x.target.value)} />
        <button className="bouton" disabled={enCours}>
          <AvecIcone icone={Search}>Chercher</AvecIcone>
        </button>
        <BoutonIcone icone={RotateCw} variante="discret" libelle="Actualiser les membres" onClick={() => void chercher(q)} />
      </form>
      {erreur && <p className="erreur">{erreur}</p>}
      {membres && membres.length === 0 && <p className="explication">{q ? "Aucun membre trouvé." : "Aucun membre pour l'instant : ils s'inscrivent en caisse, par leur téléphone."}</p>}
      {membres && membres.length > 0 && (
        <ul className="tickets-liste" role="list" aria-label="Membres">
          {membres.map((m) => (
            <li key={m.id}>
              <button className="ticket-admin" onClick={() => setFiche(m.id)}>
                <span className="ticket-admin-texte">
                  <strong>{`${m.prenom} ${m.nom}`.trim()}</strong>
                  <small>
                    {telephoneLisible(m.telephone)}
                    {m.email ? ` · ${m.email}` : ""} · dernière visite {date(m.derniereVisite)}
                  </small>
                </span>
                <strong className="tickets-montant">{unite(programme.regles, m.solde)}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}
      {fiche && (
        <FicheMembre
          programme={programme}
          id={fiche}
          onFermer={() => {
            setFiche(null);
            void chercher(q);
          }}
        />
      )}
    </div>
  );
}

function FicheMembre(props: { programme: ProgrammeFidelite; id: string; onFermer: () => void }) {
  const { programme } = props;
  const [d, setD] = useState<{ membre: MembreFidelite; mouvements: MouvementFidelite[] } | null>(null);
  const [saisie, setSaisie] = useState<Pick<MembreFidelite, "telephone" | "prenom" | "nom" | "email" | "offres"> | null>(null);
  const [ajust, setAjust] = useState({ points: "", motif: "" });
  const [ok, setOk] = useState("");
  const { enCours, erreur, envoyer } = useEnvoi();
  const charger = useCallback(
    () =>
      envoyer(async () => {
        const r = await api.membreFidelite(programme.id, props.id);
        setD(r);
        setSaisie({ telephone: telephoneLisible(r.membre.telephone), prenom: r.membre.prenom, nom: r.membre.nom, email: r.membre.email, offres: r.membre.offres });
      }),
    [envoyer, programme.id, props.id],
  );
  useEffect(() => void charger(), [charger]);
  const m = d?.membre;

  return (
    <Modale titre={m ? `${m.prenom} ${m.nom}`.trim() : "Membre"} large onFermer={props.onFermer}>
      {!m || !saisie ? (
        <p className="explication">{erreur || "Chargement…"}</p>
      ) : (
        <>
          <p className="fidelite-solde">
            <strong>{unite(programme.regles, m.solde)}</strong> · inscrit le {date(m.inscritLe)} · dernière visite {date(m.derniereVisite)}
          </p>
          {!m.supprime && (
            <form
              className="fidelite-fiche"
              onSubmit={(ev) => {
                ev.preventDefault();
                void envoyer(async () => {
                  await api.modifierMembre(programme.id, m.id, saisie);
                  setOk("Fiche enregistrée.");
                  await charger();
                });
              }}
            >
              <Champ libelle="Prénom">
                <input value={saisie.prenom} maxLength={40} required onChange={(x) => setSaisie({ ...saisie, prenom: x.target.value })} />
              </Champ>
              <Champ libelle="Nom">
                <input value={saisie.nom} maxLength={60} onChange={(x) => setSaisie({ ...saisie, nom: x.target.value })} />
              </Champ>
              <Champ libelle="Téléphone">
                <input type="tel" value={saisie.telephone} maxLength={30} required onChange={(x) => setSaisie({ ...saisie, telephone: x.target.value })} />
              </Champ>
              <Champ libelle="E-mail">
                <input type="email" value={saisie.email} maxLength={254} onChange={(x) => setSaisie({ ...saisie, email: x.target.value })} />
              </Champ>
              <label className="case">
                <input type="checkbox" checked={saisie.offres} onChange={(x) => setSaisie({ ...saisie, offres: x.target.checked })} />
                Accepte de recevoir des offres
              </label>
              <button className="bouton" disabled={enCours}>
                <AvecIcone icone={Save}>Enregistrer la fiche</AvecIcone>
              </button>
            </form>
          )}
          {!m.supprime && (
            <form
              className="admin-ligne fidelite-ajustement"
              onSubmit={(ev) => {
                ev.preventDefault();
                void envoyer(async () => {
                  await api.ajusterMembre(programme.id, m.id, Number(ajust.points), ajust.motif.trim());
                  setAjust({ points: "", motif: "" });
                  setOk("Ajustement enregistré.");
                  await charger();
                });
              }}
            >
              <input aria-label="Points à ajouter ou retirer" type="number" placeholder="+10 ou -10" value={ajust.points} onChange={(x) => setAjust({ ...ajust, points: x.target.value })} />
              <input aria-label="Motif de l'ajustement" placeholder="Motif (obligatoire)" maxLength={120} value={ajust.motif} onChange={(x) => setAjust({ ...ajust, motif: x.target.value })} />
              <button className="bouton" disabled={enCours || !Number(ajust.points) || ajust.motif.trim().length < 3}>
                Ajuster
              </button>
            </form>
          )}
          {ok && <p className="admin-ok">{ok}</p>}
          {erreur && <p className="erreur">{erreur}</p>}
          <h3>Historique</h3>
          <table className="tableau">
            <tbody>
              {d.mouvements.map((x, i) => (
                <tr key={i}>
                  <td>{dateHeure(x.horodatage)}</td>
                  <td>
                    {LIBELLES_MOUVEMENT[x.nature]}
                    {x.motif ? <small> · {x.motif}</small> : null}
                    {x.ticket ? <small> · ticket n° {x.ticket.numero}</small> : null}
                  </td>
                  <td className={`nombre${x.points < 0 ? " erreur" : ""}`}>{x.points > 0 ? `+${x.points}` : x.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!m.supprime && (
            <button
              className="bouton danger"
              disabled={enCours}
              onClick={() => {
                if (confirm(`Effacer ${m.prenom} ? Son nom, son téléphone et son e-mail sont supprimés ; ses points sont perdus. Irréversible.`))
                  void envoyer(async () => {
                    await api.effacerMembre(programme.id, m.id);
                    props.onFermer();
                  });
              }}
            >
              <AvecIcone icone={UserX}>Effacer le membre (RGPD)</AvecIcone>
            </button>
          )}
        </>
      )}
    </Modale>
  );
}

