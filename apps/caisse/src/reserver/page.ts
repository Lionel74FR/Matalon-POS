/**
 * Module de réservation du site de l'établissement, ouvert dans un panneau par
 * /reservation.js (ou en page entière : /reserver/<établissement>). Trois étapes :
 * le choix (personnes, date, préférence de salle, horaire), les coordonnées, la
 * confirmation. Page d'annulation : /reserver/annuler?j=<jeton reçu par e-mail>.
 */
import type { CreneauxService } from "@matalon/reservations";
import type { ConfigPublique, ResumePublic } from "@matalon/serveur/partage";
import "./page.css";

// ───────── Petits outils ─────────

type Enfant = Node | string | null | false | undefined;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...enfants: Enfant[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") e.addEventListener(k.replace(/^on/, ""), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false) e.setAttribute(k, v);
  }
  for (const c of enfants) if (c !== null && c !== false && c !== undefined) e.append(c);
  return e;
}

/** Icônes Lucide (ISC), dessinées en ligne pour rester légères. */
const TRACES: Record<string, string> = {
  couverts: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  calendrier: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  fauteuil: '<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1"/><path d="M5 12h14"/>',
  horloge: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  lieu: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  bas: '<path d="m6 9 6 6 6-6"/>',
  haut: '<path d="m18 15-6-6-6 6"/>',
  gauche: '<path d="m15 18-6-6 6-6"/>',
  droite: '<path d="m9 18 6-6-6-6"/>',
  fermer: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  ok: '<path d="M20 6 9 17l-5-5"/>',
  bouclier: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
};
function icone(nom: keyof typeof TRACES & string, taille = 22): SVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", String(taille));
  s.setAttribute("height", String(taille));
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.75");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.classList.add("icone");
  s.innerHTML = TRACES[nom]!;
  return s;
}

const decaler = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dateCourte = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dateLongue = (jour: string) =>
  new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const jourCarte = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });
const nomMois = (mois: string) => new Date(`${mois}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const pl = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

class ErreurApi extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
async function api<T>(chemin: string, corps?: unknown): Promise<T> {
  const r = await fetch(`/api/public/reservation/${chemin}`, {
    method: corps === undefined ? "GET" : "POST",
    headers: corps === undefined ? {} : { "Content-Type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const json = (await r.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!r.ok) throw new ErreurApi(json.code ?? "ERREUR", json.message ?? "Le service de réservation ne répond pas. Réessayez dans un instant.");
  return json as T;
}

const params = new URLSearchParams(location.search);
const integre = params.get("integre") === "1";
const logo = /^https:\/\/\S+$/.test(params.get("logo") ?? "") ? params.get("logo")! : null;
const racine = document.getElementById("reserver")!;
document.documentElement.classList.toggle("integre", integre);

function fermer() {
  window.parent.postMessage({ type: "matalon-reservation-fermer" }, "*");
}

function entete(nom: string): HTMLElement {
  return el(
    "header",
    { class: "entete" },
    el("span", { class: "entete-cote" }),
    logo ? el("img", { class: "logo", src: logo, alt: nom }) : el("span", { class: "nom-etab" }, nom),
    el("span", { class: "entete-cote" }, integre ? el("button", { class: "fermer", "aria-label": "Fermer", onclick: fermer }, icone("fermer", 24)) : null),
  );
}

// ───────── Annulation par le lien de l'e-mail ─────────

async function pageAnnulation(jeton: string) {
  const afficher = (r: ResumePublic, message?: string) => {
    racine.replaceChildren(
      entete(r.etablissement.nom),
      el(
        "section",
        { class: "clair contenu" },
        el("h1", {}, r.statut === "annulee" ? "Réservation annulée" : "Votre réservation"),
        recap(r),
        message ? el("p", { class: "info" }, message) : null,
        r.annulable
          ? el(
              "button",
              {
                class: "bouton sombre",
                onclick: async (e: Event) => {
                  (e.currentTarget as HTMLButtonElement).disabled = true;
                  try {
                    const fait = await api<{ reservation: ResumePublic }>(`annulation/${jeton}`, {});
                    afficher(fait.reservation, "Votre réservation est annulée. Un e-mail vous le confirme.");
                  } catch (err) {
                    afficher(r, (err as Error).message);
                  }
                },
              },
              "Annuler ma réservation",
            )
          : r.statut === "confirmee"
            ? el("p", { class: "info" }, `Cette réservation ne peut plus être annulée en ligne. Appelez-nous${r.etablissement.telephone ? ` au ${r.etablissement.telephone}` : ""}.`)
            : null,
      ),
    );
  };
  try {
    const r = await api<{ reservation: ResumePublic }>(`annulation/${jeton}`);
    afficher(r.reservation);
  } catch (e) {
    racine.replaceChildren(el("section", { class: "clair contenu" }, el("h1", {}, "Lien invalide"), el("p", {}, (e as Error).message)));
  }
}

function recap(r: { couverts: number; date: string; heure: string; etablissement: ResumePublic["etablissement"] }, modifier?: () => void): HTMLElement {
  const adresse = `${r.etablissement.adresse}, ${r.etablissement.codePostalVille}`;
  return el(
    "div",
    { class: "recap" },
    el("div", { class: "recap-tete" }, el("h2", {}, "Votre réservation"), modifier ? el("button", { class: "lien", onclick: modifier }, "modifier") : null),
    el("p", {}, icone("couverts"), el("b", {}, String(r.couverts))),
    el("p", {}, icone("calendrier"), el("b", {}, dateCourte(r.date))),
    el("p", {}, icone("horloge"), el("b", {}, r.heure)),
    el(
      "p",
      {},
      icone("lieu"),
      el(
        "span",
        {},
        el("b", {}, r.etablissement.nom),
        el("br"),
        el("a", { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.etablissement.nom} ${adresse}`)}`, target: "_blank", rel: "noopener" }, adresse),
      ),
    ),
  );
}

// ───────── Réservation ─────────

interface Etat {
  config: ConfigPublique;
  couverts: number;
  date: string;
  zone: string;
  heure: string | null;
  ouvert: "couverts" | "date" | "zone" | "horaire" | null;
  /** Calendrier « Autre » ouvert, sur ce mois. */
  mois: string | null;
  plusDePersonnes: boolean;
  libres: Set<string>;
  moisCharges: Set<string>;
  services: CreneauxService[] | null;
  etape: "choix" | "contact" | "confirme";
  erreur: string | null;
  envoi: boolean;
  resultat: { reservation: ResumePublic; annulation: string; email: string } | null;
}

const INDICATIFS: Array<[string, string, string]> = [
  ["FR", "🇫🇷", "+33"],
  ["CH", "🇨🇭", "+41"],
  ["BE", "🇧🇪", "+32"],
  ["LU", "🇱🇺", "+352"],
  ["IT", "🇮🇹", "+39"],
  ["DE", "🇩🇪", "+49"],
  ["ES", "🇪🇸", "+34"],
  ["GB", "🇬🇧", "+44"],
  ["NL", "🇳🇱", "+31"],
  ["US", "🇺🇸", "+1"],
];
const MEMOIRE = "matalon.reservation.contact";
interface Contact {
  civilite: string;
  prenom: string;
  nom: string;
  pays: string;
  telephone: string;
  email: string;
  commentaire: string;
  memoriser: boolean;
  offresEmail: boolean;
  offresSms: boolean;
  conditions: boolean;
}
function contactMemorise(): Contact {
  const vide: Contact = { civilite: "", prenom: "", nom: "", pays: "FR", telephone: "", email: "", commentaire: "", memoriser: false, offresEmail: false, offresSms: false, conditions: false };
  try {
    const m = JSON.parse(localStorage.getItem(MEMOIRE) ?? "null") as Partial<Contact> | null;
    return m ? { ...vide, ...m, commentaire: "", conditions: false, memoriser: true } : vide;
  } catch {
    return vide;
  }
}

async function pageReservation(etabId: string) {
  let config: ConfigPublique;
  try {
    config = await api<ConfigPublique>(etabId);
  } catch (e) {
    racine.replaceChildren(
      el("header", { class: "entete" }, el("span", { class: "entete-cote" }), el("span", { class: "nom-etab" }, "Réservation"), el("span", { class: "entete-cote" }, integre ? el("button", { class: "fermer", "aria-label": "Fermer", onclick: fermer }, icone("fermer", 24)) : null)),
      el("section", { class: "contenu" }, el("p", { class: "accueil" }, (e as Error).message)),
    );
    return;
  }
  document.title = `Réserver · ${config.etablissement.nom}`;
  const etat: Etat = {
    config,
    couverts: Math.min(2, config.groupeMax),
    date: config.aujourdhui,
    zone: "",
    heure: null,
    ouvert: "couverts",
    mois: null,
    plusDePersonnes: false,
    libres: new Set(),
    moisCharges: new Set(),
    services: null,
    etape: "choix",
    erreur: null,
    envoi: false,
    resultat: null,
  };
  const contact = contactMemorise();
  const finHorizon = decaler(config.aujourdhui, config.horizonJours);

  const chargerJours = async (du: string, au: string) => {
    const r = await api<{ jours: string[] }>(`${etabId}/jours?du=${du}&au=${au}&couverts=${etat.couverts}`);
    for (const j of r.jours) etat.libres.add(j);
  };
  const chargerCreneaux = async () => {
    etat.services = null;
    rendre();
    const r = await api<{ services: CreneauxService[] }>(`${etabId}/creneaux?date=${etat.date}&couverts=${etat.couverts}`);
    etat.services = r.services;
    if (etat.heure && !r.services.some((s) => s.creneaux.some((c) => c.heure === etat.heure && c.libre))) etat.heure = null;
    rendre();
  };
  /** Nouveau nombre de personnes : disponibilités relues, date gardée si elle reste libre. */
  const recharger = async () => {
    etat.libres = new Set();
    etat.moisCharges = new Set();
    try {
      await chargerJours(config.aujourdhui, decaler(config.aujourdhui, 45));
      if (!etat.libres.has(etat.date)) etat.date = [...etat.libres].sort()[0] ?? etat.date;
      await chargerCreneaux();
    } catch (e) {
      etat.erreur = (e as Error).message;
      rendre();
    }
  };

  const ligne = (cle: NonNullable<Etat["ouvert"]>, ic: string, titre: string, contenu: () => HTMLElement) => {
    const ouvert = etat.ouvert === cle;
    return el(
      "div",
      { class: `section${ouvert ? " ouverte" : ""}` },
      el(
        "button",
        {
          class: "section-tete",
          "aria-expanded": String(ouvert),
          onclick: () => {
            etat.ouvert = ouvert ? null : cle;
            rendre();
          },
        },
        icone(ic),
        el("span", {}, titre),
        icone(ouvert ? "haut" : "bas", 20),
      ),
      ouvert ? el("div", { class: "section-corps" }, contenu()) : null,
    );
  };

  const libelleDate = (j: string) => (j === config.aujourdhui ? "Aujourd'hui" : j === decaler(config.aujourdhui, 1) ? "Demain" : dateCourte(j));

  const choixCouverts = () => {
    const max = config.groupeMax;
    const visibles = etat.plusDePersonnes ? max : Math.min(max, 9);
    const boutons = Array.from({ length: visibles }, (_, i) => i + 1).map((n) =>
      el(
        "button",
        {
          class: `case${etat.couverts === n ? " choisie" : ""}`,
          "aria-pressed": String(etat.couverts === n),
          onclick: () => {
            etat.couverts = n;
            etat.ouvert = "date";
            void recharger();
          },
        },
        String(n),
      ),
    );
    const plus =
      !etat.plusDePersonnes &&
      el(
        "button",
        {
          class: "case",
          "aria-label": "Plus de personnes",
          onclick: () => {
            etat.plusDePersonnes = true;
            rendre();
          },
        },
        icone("plus"),
      );
    return el(
      "div",
      {},
      el("div", { class: "grille-cases" }, ...boutons, plus),
      etat.plusDePersonnes
        ? el("p", { class: "note" }, `Au-delà de ${pl(max, "personne")}, contactez-nous${config.telephone ? ` au ${config.telephone}` : ""}${config.email ? ` ou à ${config.email}` : ""}.`)
        : null,
    );
  };

  const calendrier = () => {
    const mois = etat.mois!;
    const premier = `${mois}-01`;
    const decalage = (new Date(`${premier}T12:00:00Z`).getUTCDay() + 6) % 7;
    const fin = decaler(`${decaler(premier, 32).slice(0, 7)}-01`, -1);
    const jours: Enfant[] = Array.from({ length: decalage }, () => el("span"));
    for (let j = premier; j <= fin; j = decaler(j, 1)) {
      const libre = etat.libres.has(j);
      jours.push(
        el(
          "button",
          {
            class: `jour${j === etat.date ? " choisie" : ""}`,
            disabled: !libre,
            "aria-label": dateLongue(j),
            onclick: () => {
              etat.date = j;
              etat.mois = null;
              etat.heure = null;
              etat.ouvert = "horaire";
              void chargerCreneaux();
            },
          },
          String(Number(j.slice(8))),
        ),
      );
    }
    const changer = (n: number) => async () => {
      const suivant = decaler(`${mois}-15`, n * 30).slice(0, 7);
      etat.mois = suivant;
      rendre();
      if (!etat.moisCharges.has(suivant)) {
        etat.moisCharges.add(suivant);
        await chargerJours(`${suivant}-01`, decaler(`${decaler(`${suivant}-01`, 32).slice(0, 7)}-01`, -1)).catch(() => undefined);
        rendre();
      }
    };
    return el(
      "div",
      { class: "calendrier" },
      el(
        "div",
        { class: "calendrier-tete" },
        el("button", { class: "fleche", "aria-label": "Mois précédent", disabled: mois <= config.aujourdhui.slice(0, 7), onclick: changer(-1) }, icone("gauche", 20)),
        el("span", {}, nomMois(mois)),
        el("button", { class: "fleche", "aria-label": "Mois suivant", disabled: mois >= finHorizon.slice(0, 7), onclick: changer(1) }, icone("droite", 20)),
      ),
      el("div", { class: "calendrier-jours" }, ...["L", "M", "M", "J", "V", "S", "D"].map((x) => el("span", { class: "jsem" }, x)), ...jours),
    );
  };

  const choixDate = () => {
    if (etat.mois) return calendrier();
    const prochains = [...etat.libres].sort().slice(0, 2);
    return el(
      "div",
      {},
      el("p", { class: "pastille" }, "Prochaine disponibilité"),
      el(
        "div",
        { class: "cartes-jours" },
        ...prochains.map((j) =>
          el(
            "button",
            {
              class: `carte-jour${j === etat.date ? " choisie" : ""}`,
              onclick: () => {
                etat.date = j;
                etat.heure = null;
                etat.ouvert = "horaire";
                void chargerCreneaux();
              },
            },
            el("b", {}, jourCarte(j)),
            el("span", {}, j === config.aujourdhui ? "Aujourd'hui" : j === decaler(config.aujourdhui, 1) ? "Demain" : new Date(`${j}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" })),
          ),
        ),
        el(
          "button",
          {
            class: `carte-jour${!prochains.includes(etat.date) ? " choisie" : ""}`,
            onclick: () => {
              etat.mois = etat.date.slice(0, 7);
              etat.moisCharges.add(etat.mois);
              rendre();
              void chargerJours(`${etat.mois}-01`, decaler(`${decaler(`${etat.mois}-01`, 32).slice(0, 7)}-01`, -1))
                .then(rendre)
                .catch(() => undefined);
            },
          },
          icone("calendrier", 26),
          el("span", {}, "Autre"),
        ),
      ),
      prochains.length === 0 ? el("p", { class: "note" }, "Aucune disponibilité dans les prochaines semaines pour ce nombre de personnes.") : null,
    );
  };

  const choixZone = () =>
    el(
      "div",
      { class: "liste-choix" },
      ...["", ...config.zones].map((z) =>
        el(
          "button",
          {
            class: `choix${etat.zone === z ? " choisie" : ""}`,
            onclick: () => {
              etat.zone = z;
              etat.ouvert = "horaire";
              rendre();
            },
          },
          z || "Pas de préférence",
        ),
      ),
    );

  const choixHoraire = () => {
    if (!etat.services) return el("p", { class: "note" }, "Recherche des disponibilités…");
    if (etat.services.length === 0) return el("p", { class: "note" }, "Aucun service ouvert à la réservation ce jour-là.");
    return el(
      "div",
      {},
      ...etat.services.map((s) =>
        el(
          "div",
          { class: "service" },
          el("h3", {}, s.nom),
          ...s.creneaux.map((c) =>
            el(
              "button",
              {
                class: `creneau${etat.heure === c.heure ? " choisie" : ""}${c.libre ? "" : " complet"}`,
                disabled: !c.libre,
                onclick: () => {
                  etat.heure = c.heure;
                  rendre();
                },
              },
              el("i", { class: "puce" }),
              el("span", {}, c.heure),
              c.libre ? null : el("small", {}, "Complet"),
            ),
          ),
        ),
      ),
    );
  };

  const pageChoix = () =>
    el(
      "section",
      { class: "contenu sombre" },
      el(
        "p",
        { class: "accueil" },
        config.accueil || `Bienvenue chez ${config.etablissement.nom}`,
        el("br"),
        `Pour une réservation de plus de ${pl(config.groupeMax, "personne")}, contactez-nous${config.email ? " par e-mail" : ""}${config.telephone ? `${config.email ? " ou" : ""} au ${config.telephone}` : ""}.`,
      ),
      ligne("couverts", "couverts", pl(etat.couverts, "couvert"), choixCouverts),
      ligne("date", "calendrier", libelleDate(etat.date), choixDate),
      config.zones.length > 1 ? ligne("zone", "fauteuil", etat.zone || "Pas de préférence", choixZone) : null,
      ligne("horaire", "horloge", etat.heure ?? "Horaire", choixHoraire),
      etat.erreur ? el("p", { class: "erreur" }, etat.erreur) : null,
      el(
        "div",
        { class: "pied" },
        el(
          "button",
          {
            class: "bouton clair-btn",
            disabled: !etat.heure,
            onclick: () => {
              etat.etape = "contact";
              etat.erreur = null;
              rendre();
              racine.scrollTo?.({ top: 0 });
              window.scrollTo({ top: 0 });
            },
          },
          "Réserver",
        ),
      ),
    );

  const champ = (libelle: string, saisie: HTMLElement, facultatif = false) =>
    el("label", { class: "champ" }, el("span", { class: "etiquette" }, el("b", {}, libelle), facultatif ? el("small", {}, "(facultatif)") : null), saisie);
  const texte = (cle: "prenom" | "nom" | "email" | "telephone", attrs: Record<string, string> = {}) =>
    el("input", {
      ...attrs,
      value: contact[cle],
      oninput: (e: Event) => {
        contact[cle] = (e.target as HTMLInputElement).value;
      },
    });
  const caseACocher = (cle: "conditions" | "memoriser" | "offresEmail" | "offresSms", ...libelle: Enfant[]) =>
    el(
      "label",
      { class: "case-cocher" },
      el("input", {
        type: "checkbox",
        checked: contact[cle],
        onchange: (e: Event) => {
          contact[cle] = (e.target as HTMLInputElement).checked;
        },
      }),
      el("span", {}, ...libelle),
    );

  const envoyer = async (e: Event) => {
    e.preventDefault();
    if (etat.envoi) return;
    if (!contact.conditions) {
      etat.erreur = "Merci d'accepter les conditions d'utilisation du service.";
      rendre();
      return;
    }
    etat.envoi = true;
    etat.erreur = null;
    rendre();
    const indicatif = INDICATIFS.find(([p]) => p === contact.pays)?.[2] ?? "+33";
    const tel = contact.telephone.trim().replace(/^0(?=\d)/, indicatif);
    try {
      const r = await api<{ reservation: ResumePublic; annulation: string }>(etabId, {
        date: etat.date,
        heure: etat.heure,
        couverts: etat.couverts,
        ...(contact.civilite ? { civilite: contact.civilite } : {}),
        prenom: contact.prenom,
        nom: contact.nom,
        telephone: tel.startsWith("+") ? tel : `${indicatif}${tel}`,
        email: contact.email,
        commentaire: contact.commentaire,
        ...(etat.zone ? { zone: etat.zone } : {}),
        offresEmail: contact.offresEmail,
        offresSms: contact.offresSms,
        conditions: true,
        site: (document.getElementById("site-web") as HTMLInputElement | null)?.value ?? "",
      });
      try {
        if (contact.memoriser) {
          const { commentaire: _c, conditions: _k, memoriser: _m, ...garde } = contact;
          localStorage.setItem(MEMOIRE, JSON.stringify(garde));
        } else localStorage.removeItem(MEMOIRE);
      } catch {
        /* stockage indisponible (navigation privée) : rien à garder */
      }
      etat.resultat = { ...r, email: contact.email };
      etat.etape = "confirme";
      window.parent.postMessage({ type: "matalon-reservation-confirmee", date: etat.date, heure: etat.heure, couverts: etat.couverts }, "*");
    } catch (err) {
      const e2 = err as ErreurApi;
      etat.erreur = e2.message;
      // Le créneau a été pris entre-temps : retour au choix, disponibilités relues.
      if (["SERVICE_COMPLET", "SALLE_PLEINE", "CRENEAU_COMPLET", "TROP_TARD", "HORS_SERVICE", "FERME"].includes(e2.code)) {
        etat.etape = "choix";
        etat.ouvert = "horaire";
        etat.heure = null;
        void chargerCreneaux();
      }
    } finally {
      etat.envoi = false;
      rendre();
    }
  };

  const pageContact = () =>
    el(
      "section",
      { class: "clair" },
      recap({ couverts: etat.couverts, date: etat.date, heure: etat.heure!, etablissement: config.etablissement }, () => {
        etat.etape = "choix";
        rendre();
      }),
      el(
        "form",
        { class: "contenu formulaire", onsubmit: envoyer, novalidate: true },
        el(
          "h2",
          { class: "titre-contact" },
          el("button", { type: "button", class: "retour", "aria-label": "Retour", onclick: () => ((etat.etape = "choix"), rendre()) }, icone("gauche", 24)),
          "Contact",
        ),
        el(
          "fieldset",
          { class: "civilites" },
          el("legend", {}, el("b", {}, "Civilité")),
          ...[
            ["Mme", "Madame"],
            ["M.", "Monsieur"],
            ["Mx", "Mx."],
          ].map(([v, l]) =>
            el(
              "label",
              { class: "radio" },
              el("input", { type: "radio", name: "civilite", value: v!, checked: contact.civilite === v, onchange: () => (contact.civilite = v!) }),
              el("span", {}, l!),
            ),
          ),
        ),
        champ("Prénom", texte("prenom", { autocomplete: "given-name", required: "" })),
        champ("Nom", texte("nom", { autocomplete: "family-name", required: "" })),
        champ(
          "Téléphone",
          el(
            "div",
            { class: "telephone" },
            el(
              "select",
              {
                "aria-label": "Pays",
                onchange: (e: Event) => {
                  contact.pays = (e.target as HTMLSelectElement).value;
                  rendre();
                },
              },
              ...INDICATIFS.map(([p, drapeau, ind]) => el("option", { value: p, selected: contact.pays === p }, `${drapeau} ${ind}`)),
            ),
            texte("telephone", { type: "tel", autocomplete: "tel-national", placeholder: `${INDICATIFS.find(([p]) => p === contact.pays)?.[2] ?? "+33"} 6 12 34 56 78`, required: "" }),
          ),
        ),
        champ("Email", texte("email", { type: "email", autocomplete: "email", required: "" })),
        champ(
          "Commentaires, préférences ou restrictions alimentaires",
          el("textarea", {
            rows: "3",
            maxlength: "500",
            oninput: (e: Event) => {
              contact.commentaire = (e.target as HTMLTextAreaElement).value;
            },
          }, contact.commentaire),
          true,
        ),
        // Champ piège : invisible pour une personne, rempli par les robots.
        el("input", { id: "site-web", name: "site", class: "piege", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" }),
        el(
          "div",
          { class: "cases" },
          caseACocher(
            "conditions",
            "J'accepte les ",
            config.conditions ? el("a", { href: config.conditions, target: "_blank", rel: "noopener" }, "conditions générales d'utilisation du service") : "conditions d'utilisation du service",
            ". *",
          ),
          caseACocher("memoriser", "Sauvegarder les informations pour mes prochaines réservations."),
          caseACocher("offresEmail", "Envoyez-moi des offres et actualités par e-mail."),
          caseACocher("offresSms", "Envoyez-moi des offres et actualités par SMS."),
        ),
        etat.erreur ? el("p", { class: "erreur" }, etat.erreur) : null,
        el("div", { class: "pied-form" }, el("button", { class: "bouton sombre", type: "submit", disabled: etat.envoi }, etat.envoi ? "Réservation…" : "Réserver")),
        el(
          "details",
          { class: "confidentialite" },
          el("summary", {}, icone("bouclier"), el("span", {}, "Politique de protection des données personnelles"), icone("bas", 20)),
          el(
            "p",
            {},
            `${config.etablissement.nom} utilise vos coordonnées pour gérer votre réservation : confirmation, rappel éventuel et contact en cas d'imprévu. Elles ne sont transmises à personne et sont effacées un an après la date de la réservation. Les offres ne vous sont envoyées que si vous les avez demandées, et vous pouvez vous désinscrire à tout moment. Pour accéder à vos données ou les faire effacer, écrivez-nous${config.email ? ` à ${config.email}` : ""}.`,
            config.confidentialite ? el("span", {}, " ", el("a", { href: config.confidentialite, target: "_blank", rel: "noopener" }, "Politique de confidentialité complète")) : null,
          ),
        ),
      ),
    );

  const ics = (r: ResumePublic) => {
    const debut = `${r.date.replaceAll("-", "")}T${r.heure.replace(":", "")}00`;
    const fin = new Date(`${r.date}T${r.heure}:00Z`);
    fin.setUTCMinutes(fin.getUTCMinutes() + 90);
    const f = fin.toISOString().replace(/[-:]/g, "").slice(0, 15);
    const contenu = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Matalon POS//Reservation//FR",
      "BEGIN:VEVENT",
      `UID:${r.id}@matalon-pos`,
      `DTSTART;TZID=Europe/Paris:${debut}`,
      `DTEND;TZID=Europe/Paris:${f}`,
      `SUMMARY:${r.etablissement.nom} · ${pl(r.couverts, "personne")}`,
      `LOCATION:${r.etablissement.adresse}\\, ${r.etablissement.codePostalVille}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(contenu)}`;
  };

  const pageConfirmee = () => {
    const { reservation: r, annulation, email } = etat.resultat!;
    return el(
      "section",
      { class: "clair contenu confirmation" },
      el("div", { class: "rond-ok" }, icone("ok", 34)),
      el("h1", {}, "Réservation confirmée"),
      el("p", {}, `Merci ${r.prenom}, votre table vous attend le ${dateLongue(r.date)} à ${r.heure.replace(":", " h ")}, pour ${pl(r.couverts, "personne")}.`),
      email ? el("p", { class: "note-clair" }, `Un e-mail de confirmation part à ${email}.`) : null,
      recap(r),
      el(
        "div",
        { class: "actions-confirmation" },
        el("a", { class: "bouton contour", href: ics(r), download: "reservation.ics" }, icone("calendrier", 20), "Ajouter à mon agenda"),
        el("a", { class: "lien", href: `/reserver/annuler?j=${encodeURIComponent(annulation)}${integre ? "&integre=1" : ""}` }, "Annuler cette réservation"),
      ),
      integre ? el("button", { class: "bouton sombre", onclick: fermer }, "Fermer") : null,
    );
  };

  function rendre() {
    const vue = etat.etape === "choix" ? pageChoix() : etat.etape === "contact" ? pageContact() : pageConfirmee();
    document.documentElement.classList.toggle("theme-clair", etat.etape !== "choix");
    racine.replaceChildren(entete(config.etablissement.nom), vue);
  }

  rendre();
  await recharger();
}

// ───────── Aiguillage ─────────

const morceaux = location.pathname.split("/").filter(Boolean);
if (morceaux[1] === "annuler") {
  document.documentElement.classList.add("theme-clair");
  void pageAnnulation(params.get("j") ?? "");
} else {
  void pageReservation(morceaux[1] ?? params.get("etablissement") ?? "");
}
