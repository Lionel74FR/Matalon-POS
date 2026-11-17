import {
  COULEURS_RESERVATION,
  MESSAGES_REFUS,
  remplissageDuJour,
  TAGS_RESERVATION,
  type Civilite,
  type CouleurReservation,
  type Reservation,
  type SourceReservation,
  type StatutReservation,
} from "@matalon/reservations";
import {
  Ban,
  CalendarCheck,
  CalendarDays,
  Clock,
  Hourglass,
  LayoutGrid,
  Mail,
  MessageSquareText,
  Save,
  Sparkles,
  Tag,
  TriangleAlert,
  UserPlus,
  Users,
  Utensils,
  X,
  Armchair,
  DoorOpen,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { confirmer } from "../../admin/Panneau";
import { ChoixTables } from "../ChoixTables";
import { AvecIcone, BoutonIcone } from "../icones";
import {
  dateLongue,
  dateRecap,
  decaler,
  estConflit,
  jourAbrege,
  LIBELLES_CANAL,
  LIBELLES_STATUT,
  messageErreur,
  nomClient,
  pl,
  servicesDuJour,
  TEINTES,
  type AccesReservations,
  type ContexteReservations,
} from "./commun";

/** Indicatifs proposés devant le téléphone ; un numéro qui commence par « + » ou « 00 » garde le sien. */
const INDICATIFS: Array<[string, string]> = [
  ["+33", "🇫🇷 +33"],
  ["+41", "🇨🇭 +41"],
  ["+32", "🇧🇪 +32"],
  ["+352", "🇱🇺 +352"],
  ["+49", "🇩🇪 +49"],
  ["+39", "🇮🇹 +39"],
  ["+34", "🇪🇸 +34"],
  ["+44", "🇬🇧 +44"],
  ["+31", "🇳🇱 +31"],
  ["+1", "🇺🇸 +1"],
];
const CANAUX: SourceReservation[] = ["telephone", "sur_place", "email", "messagerie"];
const COULEURS_NOMS: Record<CouleurReservation, string> = {
  rose: "Rose",
  violet: "Violet",
  bleu: "Bleu",
  vert: "Vert",
  jaune: "Jaune",
  orange: "Orange",
  rouge: "Rouge",
  gris: "Gris",
};
/** Créneaux montrés avant « Autres créneaux horaires ». */
const CRENEAUX_COURTS = 4;

/** Numéro complet : « 06 12… » avec l'indicatif +41 → « +41 6 12… » ; un numéro international reste tel quel. */
export function avecIndicatif(indicatif: string, brut: string): string {
  const t = brut.trim();
  if (!t || t.startsWith("+") || t.startsWith("00") || indicatif === "+33") return t;
  return `${indicatif}${t.replace(/^0/, "")}`;
}

function Section(props: { titre: string; children: ReactNode }) {
  return (
    <section className="resa-p-section" aria-label={props.titre}>
      <h3>{props.titre}</h3>
      {props.children}
    </section>
  );
}

/** Choix exclusif en boutons (date, personnes, civilité, statut temporaire). */
function Choix<T extends string | number>(props: { libelle: string; valeur: T | null; options: Array<[T, string]>; onChange: (v: T) => void; classe?: string }) {
  return (
    <div className={`resa-p-choix${props.classe ? ` ${props.classe}` : ""}`} role="group" aria-label={props.libelle}>
      {props.options.map(([v, texte]) => (
        <button key={String(v)} type="button" className={`option${props.valeur === v ? " active" : ""}`} aria-pressed={props.valeur === v} onClick={() => props.onChange(v)}>
          {texte}
        </button>
      ))}
    </div>
  );
}

/**
 * Panneau de saisie façon Zenchef, à droite du plan : nouvelle réservation (ou client de passage)
 * et fiche d'une réservation existante. Jour en raccourcis, personnes de 1 à 8 (« Plus »), créneaux
 * avec leur remplissage, attribution des tables (d'office, à la main ou d'un toucher sur le plan),
 * client, puis la réservation (prise par, canal, allergies, étiquettes, mémo, couleur, statut).
 */
export function PanneauReservation(props: {
  ctx: ContexteReservations;
  acces: AccesReservations;
  /** Fiche d'une réservation existante ; absente : nouvelle réservation. */
  reservation?: Reservation;
  dateInitiale: string;
  /** Tables choisies : tenues par l'espace, le plan peut les modifier d'un toucher. */
  tables: string[];
  onTables: (ids: string[]) => void;
  /** Le plan de salle est visible à côté (on peut y toucher les tables). */
  planVisible: boolean;
  onFermer: () => void;
  /** Enregistrée : la réservation et une phrase pour le message de l'équipe. */
  onEnregistree: (r: Reservation, message: string) => void;
  /** Caisse : client de passage installé aussitôt (la table s'ouvre). */
  installer?: (r: Reservation) => Promise<void>;
}) {
  const { ctx, acces } = props;
  const r = props.reservation;
  const edition = !!r;
  const [onglet, setOnglet] = useState<"reservation" | "passage">("reservation");
  const [date, setDate] = useState(r?.date ?? props.dateInitiale);
  const [autreDate, setAutreDate] = useState(false);
  const [couverts, setCouverts] = useState(r?.couverts ?? 2);
  const [plus, setPlus] = useState((r?.couverts ?? 2) > 8);
  const [heure, setHeure] = useState(r?.heure ?? "");
  const [filtreService, setFiltreService] = useState("");
  const [zone, setZone] = useState(r?.zoneSouhaitee ?? "");
  const [tousCreneaux, setTousCreneaux] = useState(false);
  const [civilite, setCivilite] = useState<Civilite | null>(r?.civilite ?? null);
  const [prenom, setPrenom] = useState(r?.prenom ?? "");
  const [nom, setNom] = useState(r?.nom ?? "");
  const [indicatif, setIndicatif] = useState("+33");
  const [telephone, setTelephone] = useState(r?.telephone ?? "");
  const [email, setEmail] = useState(r?.email ?? "");
  const [offresEmail, setOffresEmail] = useState(!!r?.offresEmail);
  const [offresSms, setOffresSms] = useState(!!r?.offresSms);
  const [notifier, setNotifier] = useState(true);
  const [prisePar, setPrisePar] = useState(r ? (r.prisePar ?? "") : (ctx.priseParDefaut ?? ""));
  const [canal, setCanal] = useState<SourceReservation>(r?.source ?? "telephone");
  const [allergies, setAllergies] = useState(r?.allergies ?? "");
  const [tags, setTags] = useState<string[]>(r?.tags ?? []);
  const [tagsOuverts, setTagsOuverts] = useState(false);
  const [memo, setMemo] = useState(r?.memo ?? "");
  const [couleur, setCouleur] = useState<CouleurReservation | null>(r?.couleur ?? null);
  const [temporaire, setTemporaire] = useState<"option" | "attente" | null>(null);
  const [statut, setStatut] = useState<StatutReservation>(r?.statut ?? "confirmee");
  const [commentaire, setCommentaire] = useState(r?.commentaire ?? "");
  const [duree, setDuree] = useState(String(r?.dureeMinutes ?? ctx.reglages.dureeMinutes));
  const [jour, setJour] = useState<Reservation[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  // Réservations du jour choisi : remplissage des créneaux et tables prises.
  useEffect(() => {
    let fini = false;
    setJour(null);
    acces
      .lister(date, date)
      .then((l) => !fini && setJour(l))
      .catch(() => !fini && setJour([]));
    return () => {
      fini = true;
    };
  }, [acces, date]);

  const services = servicesDuJour(ctx.reglages, date);
  const remplissage = useMemo(
    () => remplissageDuJour({ ...ctx.reglages, services: ctx.reglages.services, delaiMinutes: 0, groupeMax: 200, accueil: "" }, jour ?? [], date, couverts, r?.id),
    [ctx.reglages, jour, date, couverts, r?.id],
  );
  const affiches = remplissage.filter((s) => !filtreService || s.service.id === filtreService);
  const creneaux = affiches.flatMap((s) => s.creneaux.map((c) => ({ ...c, service: s })));
  // Créneaux courts : à partir de l'heure choisie (ou des premiers), le reste derrière « Autres créneaux horaires ».
  const depart = Math.max(0, creneaux.findIndex((c) => c.heure === heure));
  const montres = tousCreneaux ? creneaux : creneaux.slice(depart, depart + CRENEAUX_COURTS);
  const heureHorsGrille = !!heure && !creneaux.some((c) => c.heure === heure);

  const jours: Array<[string, string]> = [
    [ctx.aujourdhui, "Auj."],
    ...[1, 2, 3].map((n): [string, string] => [decaler(ctx.aujourdhui, n), jourAbrege(decaler(ctx.aujourdhui, n))]),
  ];
  const dateRaccourci = jours.some(([j]) => j === date) && !autreDate;
  const zones = [...new Set(ctx.tables.filter((t) => !t.masquee).map((t) => t.zone))];
  const nomTables = props.tables.map((id) => ctx.tables.find((t) => t.id === id)?.nom ?? id).join(" + ");
  const equipe = [...new Set([...ctx.equipe, ...(prisePar ? [prisePar] : [])])];

  const envoyer = async (faire: (forcer: boolean) => Promise<Reservation>, message: (x: Reservation) => string) => {
    setEnvoi(true);
    setErreur("");
    try {
      let fait: Reservation;
      try {
        fait = await faire(false);
      } catch (e) {
        if (estConflit(e) && (await confirmer({ titre: "Enregistrer quand même ?", message: messageErreur(e), confirmer: "Enregistrer quand même" }))) fait = await faire(true);
        else throw e;
      }
      props.onEnregistree(fait, message(fait));
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  const details = () => ({
    prisePar,
    allergies,
    memo,
    couleur,
    tags,
  });

  const enregistrer = (e?: FormEvent) => {
    e?.preventDefault();
    if (onglet === "passage") {
      const corps = { passage: true, couverts, prenom, nom, telephone: avecIndicatif(indicatif, telephone), tables: props.tables, ...details() };
      return void envoyer(
        async () => {
          const { reservation } = await acces.creer(corps);
          if (props.installer && reservation.tables.length) await props.installer(reservation);
          return reservation;
        },
        (x) => `${nomClient(x)} installé${x.tables.length ? "" : " (sans table)"}.`,
      );
    }
    if (!heure) return setErreur("Choisissez un créneau horaire.");
    if (!edition) {
      if (!prisePar) return setErreur("Indiquez qui prend la réservation.");
      const corps: Record<string, unknown> = {
        date,
        heure,
        couverts,
        ...(civilite ? { civilite } : {}),
        prenom,
        nom,
        telephone: avecIndicatif(indicatif, telephone),
        email,
        offresEmail,
        offresSms,
        notifier,
        source: canal,
        ...details(),
        ...(temporaire ? { statut: temporaire } : {}),
        ...(zone ? { zone } : {}),
        ...(props.tables.length ? { tables: props.tables } : {}),
      };
      return void envoyer(
        async (forcer) => (await acces.creer({ ...corps, ...(forcer ? { forcer: true } : {}) })).reservation,
        (x) => `Réservation de ${nomClient(x)} enregistrée${x.date === ctx.aujourdhui ? "" : ` (${dateLongue(x.date)})`}, ${x.heure}.`,
      );
    }
    // Fiche : seuls les changements partent (l'historique les trace un à un).
    const corps: Record<string, unknown> = {};
    if (date !== r.date) corps.date = date;
    if (heure !== r.heure) corps.heure = heure;
    if (couverts !== r.couverts) corps.couverts = couverts;
    if (Number(duree) !== r.dureeMinutes) corps.dureeMinutes = Number(duree);
    if (statut !== r.statut) corps.statut = statut;
    if ((civilite ?? null) !== (r.civilite ?? null)) corps.civilite = civilite ?? "";
    const textes: Array<[string, string, string | undefined]> = [
      ["prenom", prenom, r.prenom],
      ["nom", nom, r.nom],
      ["telephone", avecIndicatif(indicatif, telephone), r.telephone],
      ["email", email, r.email],
      ["commentaire", commentaire, r.commentaire],
      ["prisePar", prisePar, r.prisePar],
      ["allergies", allergies, r.allergies],
      ["memo", memo, r.memo],
    ];
    for (const [cle, v, avant] of textes) if (v.trim() !== (avant ?? "")) corps[cle] = v;
    if ((couleur ?? null) !== (r.couleur ?? null)) corps.couleur = couleur;
    if (tags.join() !== (r.tags ?? []).join()) corps.tags = tags;
    if (canal !== r.source && r.source !== "en_ligne") corps.source = canal;
    if (offresEmail !== !!r.offresEmail) corps.offresEmail = offresEmail;
    if (offresSms !== !!r.offresSms) corps.offresSms = offresSms;
    if (props.tables.join() !== r.tables.join()) corps.tables = props.tables;
    if (Object.keys(corps).length === 0) return props.onFermer();
    if (!notifier) corps.notifier = false;
    void envoyer(async (forcer) => (await acces.modifier(r.id, { ...corps, ...(forcer ? { forcer: true } : {}) })).reservation, (x) => `Réservation de ${nomClient(x)} enregistrée.`);
  };

  const annuler = async () => {
    if (!r) return;
    const ok = await confirmer({
      titre: `Annuler la réservation de ${nomClient(r)} ?`,
      message: `${dateLongue(r.date)}, ${r.heure}, ${pl(r.couverts, "personne")}.${r.email && notifier && r.statut !== "option" && r.statut !== "attente" ? " Le client est prévenu par e-mail." : ""}`,
      confirmer: "Annuler la réservation",
      annuler: "Garder",
      danger: true,
    });
    if (ok) void envoyer(async () => (await acces.modifier(r.id, { statut: "annulee", ...(notifier ? {} : { notifier: false }) })).reservation, (x) => `Réservation de ${nomClient(x)} annulée.`);
  };

  const basculerTag = (t: string) => setTags((l) => (l.includes(t) ? l.filter((x) => x !== t) : TAGS_RESERVATION.filter((x) => x === t || l.includes(x))));
  const titre = edition ? `Réservation de ${nomClient(r)}` : "Nouvelle réservation";
  const peutNotifier = !!email.trim();

  return (
    <aside className="resa-panneau" aria-label={titre}>
      <header className="resa-p-tete">
        {edition ? (
          <h2>{titre}</h2>
        ) : (
          <div className="resa-p-onglets" role="tablist" aria-label="Type de saisie">
            <button type="button" role="tab" aria-selected={onglet === "reservation"} className={onglet === "reservation" ? "actif" : ""} onClick={() => setOnglet("reservation")}>
              <AvecIcone icone={CalendarCheck} taille={18}>
                Réservation
              </AvecIcone>
            </button>
            <button type="button" role="tab" aria-selected={onglet === "passage"} className={onglet === "passage" ? "actif" : ""} onClick={() => setOnglet("passage")}>
              <AvecIcone icone={DoorOpen} taille={18}>
                Client(e) de passage
              </AvecIcone>
            </button>
          </div>
        )}
        <BoutonIcone icone={X} libelle="Fermer le panneau" variante="discret" onClick={props.onFermer} />
      </header>
      <p className="resa-p-recap" aria-label="Récapitulatif">
        {onglet === "reservation" && (
          <span>
            <AvecIcone icone={CalendarDays} taille={15}>
              {dateRecap(date)}
            </AvecIcone>
          </span>
        )}
        <span>
          <AvecIcone icone={Utensils} taille={15}>
            {couverts}
          </AvecIcone>
        </span>
        {onglet === "reservation" && (
          <span>
            <AvecIcone icone={Clock} taille={15}>
              {heure || "–"}
            </AvecIcone>
          </span>
        )}
        <span>
          <AvecIcone icone={Armchair} taille={15}>
            {nomTables || (onglet === "passage" ? "–" : "Auto")}
          </AvecIcone>
        </span>
      </p>

      <form id="resa-p-form" className="resa-p-corps" onSubmit={enregistrer}>
        {onglet === "reservation" && (
          <Section titre="Date">
            <Choix
              libelle="Jour"
              valeur={dateRaccourci ? date : "autre"}
              options={[...jours, ["autre", "Autre"]]}
              onChange={(v) => {
                if (v === "autre") setAutreDate(true);
                else {
                  setAutreDate(false);
                  setDate(v);
                }
              }}
            />
            {!dateRaccourci && (
              <label className="champ resa-p-date">
                <span>Date</span>
                <input type="date" value={date} required onChange={(e) => e.target.value && setDate(e.target.value)} />
              </label>
            )}
          </Section>
        )}
        <Section titre="Personnes">
          <Choix
            libelle="Nombre de personnes"
            classe="resa-p-personnes"
            valeur={plus ? "plus" : String(couverts)}
            options={[...Array.from({ length: 8 }, (_, i): [string, string] => [String(i + 1), String(i + 1)]), ["plus", "Plus"]]}
            onChange={(v) => {
              if (v === "plus") {
                setPlus(true);
                setCouverts((c) => Math.max(c, 9));
              } else {
                setPlus(false);
                setCouverts(Number(v));
              }
            }}
          />
          {plus && (
            <label className="champ resa-p-plus">
              <span>Personnes</span>
              <input type="number" inputMode="numeric" min={1} max={200} value={couverts} onChange={(e) => setCouverts(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
            </label>
          )}
        </Section>

        {onglet === "reservation" && (
          <Section titre="Horaire">
            <div className="resa-p-filtres">
              <label className="champ">
                <span className="lecteur-ecran">Filtrer par service</span>
                <select value={filtreService} aria-label="Filtrer par service" onChange={(e) => setFiltreService(e.target.value)}>
                  <option value="">Tous les services</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nom}
                    </option>
                  ))}
                </select>
              </label>
              <label className="champ">
                <span className="lecteur-ecran">Filtrer par zone</span>
                <select value={zone} aria-label="Zone souhaitée" onChange={(e) => setZone(e.target.value)}>
                  <option value="">Toutes les zones</option>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {ctx.reglages.fermetures.includes(date) && <p className="resa-p-alerte">Établissement fermé ce jour-là : une réservation ne peut s'enregistrer que « quand même ».</p>}
            {jour === null ? (
              <p className="explication">Chargement des créneaux…</p>
            ) : creneaux.length === 0 ? (
              <p className="explication">Aucun service ce jour-là : saisissez une heure.</p>
            ) : (
              <ul className="resa-p-creneaux" aria-label="Créneaux">
                {montres.map((c) => (
                  <li key={`${c.service.service.id}-${c.heure}`}>
                    <button
                      type="button"
                      className={`resa-p-creneau${c.heure === heure ? " actif" : ""}${c.refus ? " complet" : ""}`}
                      aria-pressed={c.heure === heure}
                      title={c.refus ? `${MESSAGES_REFUS[c.refus]} L'équipe peut enregistrer quand même.` : undefined}
                      onClick={() => setHeure(c.heure)}
                    >
                      <strong>{c.heure}</strong>
                      {c.refus && <TriangleAlert className="icone resa-p-complet" size={15} aria-label={MESSAGES_REFUS[c.refus]} />}
                      <span title="Arrivées sur ce créneau">
                        <AvecIcone icone={UserPlus} taille={15}>
                          {c.service.service.arriveesMax ? `${c.arrivees}/${c.service.service.arriveesMax}` : c.arrivees}
                        </AvecIcone>
                      </span>
                      <span title={`Couverts du service ${c.service.service.nom}`}>
                        <AvecIcone icone={LayoutGrid} taille={15}>{`${c.service.couverts}/${c.service.service.couvertsMax}`}</AvecIcone>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(creneaux.length > CRENEAUX_COURTS || heureHorsGrille || creneaux.length === 0) && (
              <div className="resa-p-autres">
                {creneaux.length > CRENEAUX_COURTS && (
                  <button type="button" className="bouton" onClick={() => setTousCreneaux((t) => !t)}>
                    <AvecIcone icone={Clock} taille={18}>
                      {tousCreneaux ? "Moins de créneaux" : "Autres créneaux horaires"}
                    </AvecIcone>
                  </button>
                )}
                <label className="champ resa-p-heure">
                  <span>Autre heure</span>
                  <input type="time" step={300} value={heure} onChange={(e) => setHeure(e.target.value)} />
                </label>
              </div>
            )}
          </Section>
        )}

        <Section titre="Tables">
          <div className="resa-p-attribution">
            <button type="button" className={`bouton${props.tables.length === 0 ? " actif" : ""}`} aria-pressed={props.tables.length === 0} onClick={() => props.onTables([])}>
              <AvecIcone icone={Sparkles} taille={18}>
                {onglet === "passage" ? "Sans table" : "Attribution auto"}
              </AvecIcone>
            </button>
            <ChoixTables
              tables={ctx.tables}
              valeur={props.tables}
              couverts={couverts}
              vide="Attribution manuelle"
              libelle="Tables de la nouvelle réservation"
              classe={props.tables.length ? "actif" : ""}
              {...(r ? { reservation: { ...r, date, heure: heure || r.heure, tables: props.tables } } : heure ? { reservation: { id: "", date, heure, dureeMinutes: Number(duree), tables: props.tables } as Reservation } : {})}
              {...(jour ? { autres: jour } : {})}
              onChange={props.onTables}
            />
          </div>
          {props.planVisible && <p className="explication resa-p-astuce">Ou touchez les tables sur le plan de salle.</p>}
        </Section>

        <Section titre="Client">
          <Choix
            libelle="Civilité"
            valeur={civilite}
            options={[
              ["M.", "M."],
              ["Mme", "Mme"],
              ["Mx", "Mx."],
            ]}
            onChange={(c) => setCivilite((x) => (x === c ? null : c))}
          />
          <div className="resa-p-grille">
            <label className="champ">
              <span>Prénom</span>
              <input value={prenom} maxLength={60} required={onglet === "reservation"} autoComplete="off" placeholder="ex. Jeanne" onChange={(e) => setPrenom(e.target.value)} />
            </label>
            <label className="champ">
              <span>Nom</span>
              <input value={nom} maxLength={60} required={onglet === "reservation"} autoComplete="off" placeholder={onglet === "passage" ? "Client de passage" : "ex. Dupont"} onChange={(e) => setNom(e.target.value)} />
            </label>
          </div>
          <div className="resa-p-telephone">
            <select value={indicatif} aria-label="Indicatif du pays" onChange={(e) => setIndicatif(e.target.value)}>
              {INDICATIFS.map(([v, texte]) => (
                <option key={v} value={v}>
                  {texte}
                </option>
              ))}
            </select>
            <label className="champ">
              <span>Téléphone</span>
              <input type="tel" value={telephone} required={onglet === "reservation"} autoComplete="off" placeholder="06 12 34 56 78" onChange={(e) => setTelephone(e.target.value)} />
            </label>
          </div>
          {onglet === "reservation" && (
            <>
              <label className="champ">
                <span>E-mail</span>
                <input type="email" value={email} autoComplete="off" placeholder="ex. jeanne@exemple.fr" onChange={(e) => setEmail(e.target.value)} />
              </label>
              <fieldset className="resa-p-rgpd">
                <legend>Consentement RGPD</legend>
                <label className="case">
                  <input type="checkbox" checked={offresEmail} onChange={(e) => setOffresEmail(e.target.checked)} /> Campagnes e-mail
                </label>
                <label className="case">
                  <input type="checkbox" checked={offresSms} onChange={(e) => setOffresSms(e.target.checked)} /> Campagnes SMS
                </label>
              </fieldset>
              <div className="resa-p-notification">
                <label className="interrupteur">
                  <input type="checkbox" role="switch" checked={notifier && peutNotifier} disabled={!peutNotifier} onChange={(e) => setNotifier(e.target.checked)} />
                  <span>{edition ? "Prévenir le client par e-mail" : "Envoyer la notification de confirmation"}</span>
                </label>
                <span className={`resa-p-canal-notif${notifier && peutNotifier ? " actif" : ""}`}>
                  <AvecIcone icone={Mail} taille={15}>
                    Email
                  </AvecIcone>
                </span>
                {!peutNotifier && <small>Sans e-mail, rien n'est envoyé.</small>}
              </div>
            </>
          )}
        </Section>

        <Section titre="Réservation">
          <div className="resa-p-grille">
            <label className="champ">
              <span>Prise par</span>
              <select value={prisePar} aria-label="Prise par" required={!edition} onChange={(e) => setPrisePar(e.target.value)}>
                <option value="">Prise par…</option>
                {equipe.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="champ">
              <span>Canal</span>
              {r?.source === "en_ligne" ? (
                <input value={LIBELLES_CANAL.en_ligne} aria-label="Canal" disabled />
              ) : (
                <select value={onglet === "passage" ? "sur_place" : canal} aria-label="Canal" disabled={onglet === "passage"} onChange={(e) => setCanal(e.target.value as SourceReservation)}>
                  {CANAUX.map((c) => (
                    <option key={c} value={c}>
                      {LIBELLES_CANAL[c]}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>
          <label className="champ resa-p-icone">
            <span>Allergies</span>
            <TriangleAlert className="icone" size={18} aria-hidden="true" />
            <input value={allergies} maxLength={200} placeholder="ex. Allergie aux pistaches" onChange={(e) => setAllergies(e.target.value)} />
          </label>
          <div className="resa-p-tags">
            <button type="button" className="bouton resa-p-tags-bouton" aria-expanded={tagsOuverts} onClick={() => setTagsOuverts((o) => !o)}>
              <AvecIcone icone={Tag} taille={18}>
                {tags.length ? tags.join(", ") : "Sélectionnez une ou plusieurs étiquettes…"}
              </AvecIcone>
            </button>
            {tagsOuverts && (
              <div className="resa-p-tags-liste" role="group" aria-label="Étiquettes">
                {TAGS_RESERVATION.map((t) => (
                  <button key={t} type="button" className={`resa-tag${tags.includes(t) ? " actif" : ""}`} aria-pressed={tags.includes(t)} onClick={() => basculerTag(t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          {edition && (
            <label className="champ resa-p-icone">
              <span>Message du client</span>
              <MessageSquareText className="icone" size={18} aria-hidden="true" />
              <textarea value={commentaire} aria-label="Message du client" maxLength={500} rows={2} onChange={(e) => setCommentaire(e.target.value)} />
            </label>
          )}
          <label className="champ">
            <span>Mémo</span>
            <textarea value={memo} aria-label="Mémo" maxLength={500} rows={3} placeholder="Partagez un mémo ou des détails supplémentaires avec votre équipe…" onChange={(e) => setMemo(e.target.value)} />
          </label>
          <div className="resa-p-couleurs" role="radiogroup" aria-label="Couleur">
            <button type="button" role="radio" aria-checked={couleur === null} aria-label="Sans couleur" title="Sans couleur" className={`resa-p-couleur aucune${couleur === null ? " actif" : ""}`} onClick={() => setCouleur(null)}>
              <Utensils size={16} aria-hidden="true" />
            </button>
            {COULEURS_RESERVATION.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={couleur === c}
                aria-label={COULEURS_NOMS[c]}
                title={COULEURS_NOMS[c]}
                className={`resa-p-couleur${couleur === c ? " actif" : ""}`}
                style={{ background: TEINTES[c] }}
                onClick={() => setCouleur(c)}
              />
            ))}
          </div>
          {edition ? (
            <div className="resa-p-grille">
              <label className="champ">
                <span>Statut</span>
                <select value={statut} aria-label="Statut" onChange={(e) => setStatut(e.target.value as StatutReservation)}>
                  {(Object.keys(LIBELLES_STATUT) as StatutReservation[]).map((s) => (
                    <option key={s} value={s}>
                      {LIBELLES_STATUT[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="champ">
                <span>Durée (min)</span>
                <input type="number" min={15} max={480} step={5} value={duree} onChange={(e) => setDuree(e.target.value)} />
              </label>
            </div>
          ) : (
            onglet === "reservation" && (
              <div className="resa-p-temporaire">
                <h4>Statut temporaire</h4>
                <Choix
                  libelle="Statut temporaire"
                  valeur={temporaire}
                  options={[
                    ["option", "Sous option"],
                    ["attente", "Liste d'attente"],
                  ]}
                  onChange={(v) => setTemporaire((x) => (x === v ? null : v))}
                />
                <p className="explication">
                  <AvecIcone icone={Hourglass} taille={15}>
                    {temporaire
                      ? "Ne compte ni dans les capacités ni sur le plan, sans e-mail au client, tant qu'elle n'est pas confirmée."
                      : "Confirmée d'office si aucun statut temporaire n'est choisi."}
                  </AvecIcone>
                </p>
              </div>
            )
          )}
        </Section>

        {edition && (
          <details className="resa-historique">
            <summary>Historique</summary>
            <ul>
              {r.historique.map((h, i) => (
                <li key={i}>
                  {new Date(h.le).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })} · {h.par} · {h.action}
                </li>
              ))}
            </ul>
          </details>
        )}
      </form>

      {erreur && (
        <p className="erreur resa-p-erreur" role="alert">
          {erreur}
        </p>
      )}
      <footer className="resa-p-pied">
        {edition && (r.statut === "annulee" || r.statut === "absente" ? (
          <button type="button" className="bouton" disabled={envoi || ctx.horsLigne} onClick={() => void envoyer(async () => (await acces.modifier(r.id, { statut: "confirmee" })).reservation, (x) => `Réservation de ${nomClient(x)} rétablie.`)}>
            <AvecIcone icone={CalendarCheck}>Rétablir</AvecIcone>
          </button>
        ) : (
          <button type="button" className="bouton danger" disabled={envoi || ctx.horsLigne} onClick={() => void annuler()}>
            <AvecIcone icone={Ban}>Annuler la réservation</AvecIcone>
          </button>
        ))}
        <span className="resa-p-espace" />
        {!edition && (
          <button type="button" className="bouton" onClick={props.onFermer}>
            Annuler
          </button>
        )}
        <button className="bouton principal" type="submit" form="resa-p-form" disabled={envoi || ctx.horsLigne}>
          <AvecIcone icone={onglet === "passage" ? Users : Save}>{onglet === "passage" ? (props.installer ? "Installer" : "Enregistrer") : "Enregistrer"}</AvecIcone>
        </button>
      </footer>
    </aside>
  );
}
