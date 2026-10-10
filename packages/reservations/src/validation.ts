import { HEURE_VALIDE, JOUR_VALIDE, minutes } from "./moteur.js";
import type { Civilite, ReglagesReservation } from "./types.js";

const entier = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** Erreurs des réglages, en français ; vide : valides. */
export function validerReglages(r: ReglagesReservation): string[] {
  const e: string[] = [];
  if (!entier(r.dureeMinutes, 15, 480) || r.dureeMinutes % 5 !== 0) e.push("Durée par défaut : de 15 min à 8 h, par 5 min.");
  if (r.pasMinutes !== 15 && r.pasMinutes !== 30) e.push("Écart entre créneaux : 15 ou 30 min.");
  if (!entier(r.delaiMinutes, 0, 7 * 24 * 60)) e.push("Délai de réservation : de 0 min à 7 jours.");
  if (!entier(r.horizonJours, 1, 365)) e.push("Réservation à l'avance : de 1 à 365 jours.");
  if (!entier(r.groupeMax, 1, 100)) e.push("Groupe en ligne : de 1 à 100 personnes.");
  if (r.fermetures.some((j) => !JOUR_VALIDE.test(j))) e.push("Fermetures : dates au format AAAA-MM-JJ.");
  if (r.accueil.length > 400) e.push("Message d'accueil : 400 caractères au plus.");
  for (const lien of [r.conditions, r.confidentialite]) if (lien && !/^https:\/\/\S+$/.test(lien)) e.push(`Lien invalide : ${lien} (https://… attendu).`);
  if (r.actif && r.services.length === 0) e.push("Ajoutez au moins un service pour ouvrir la réservation en ligne.");
  const ids = new Set<string>();
  for (const s of r.services) {
    const nom = s.nom.trim() || "(sans nom)";
    if (!s.nom.trim()) e.push("Chaque service a un nom.");
    if (ids.has(s.id)) e.push(`Service en double : ${nom}.`);
    ids.add(s.id);
    if (s.jours.length === 0 || s.jours.some((j) => !entier(j, 1, 7))) e.push(`${nom} : choisissez au moins un jour.`);
    if (!HEURE_VALIDE.test(s.debut) || !HEURE_VALIDE.test(s.fin)) e.push(`${nom} : heures au format HH:MM.`);
    else if (minutes(s.fin) < minutes(s.debut)) e.push(`${nom} : la dernière arrivée précède la première.`);
    if (!entier(s.couvertsMax, 1, 2000)) e.push(`${nom} : couverts du service de 1 à 2 000.`);
    if (s.simultanesMax !== null && !entier(s.simultanesMax, 1, 2000)) e.push(`${nom} : personnes en même temps de 1 à 2 000.`);
    if (s.arriveesMax !== null && !entier(s.arriveesMax, 1, 2000)) e.push(`${nom} : arrivées par créneau de 1 à 2 000.`);
    if (s.dureeMinutes !== undefined && (!entier(s.dureeMinutes, 15, 480) || s.dureeMinutes % 5 !== 0)) e.push(`${nom} : durée de 15 min à 8 h, par 5 min.`);
  }
  // Deux services ne se chevauchent pas le même jour (une heure = un service).
  for (const a of r.services) {
    for (const b of r.services) {
      if (a.id >= b.id || !a.jours.some((j) => b.jours.includes(j))) continue;
      if (HEURE_VALIDE.test(a.debut) && HEURE_VALIDE.test(b.debut) && minutes(a.debut) <= minutes(b.fin) && minutes(b.debut) <= minutes(a.fin)) {
        e.push(`${a.nom} et ${b.nom} se chevauchent un même jour.`);
      }
    }
  }
  return e;
}

/** « 06 12 34 56 78 », « +33 6… », « 0033 6… » → « +33612345678 » ; null si illisible. */
export function normaliserTelephone(brut: string, indicatif = "+33"): string | null {
  let t = brut.replace(/[\s.\-()]/g, "");
  if (t.startsWith("00")) t = `+${t.slice(2)}`;
  if (/^0\d{9}$/.test(t)) t = `${indicatif}${t.slice(1)}`;
  return /^\+\d{8,15}$/.test(t) ? t : null;
}

export interface Coordonnees {
  civilite?: Civilite;
  prenom: string;
  nom: string;
  telephone: string;
  email?: string;
  commentaire?: string;
}

/** Coordonnées propres (espaces, téléphone normalisé) ou la liste des erreurs. */
export function validerCoordonnees(c: Partial<Coordonnees>, options: { emailObligatoire: boolean }): { ok: Coordonnees } | { erreurs: string[] } {
  const erreurs: string[] = [];
  const prenom = (c.prenom ?? "").trim();
  const nom = (c.nom ?? "").trim();
  const email = (c.email ?? "").trim().toLowerCase();
  const commentaire = (c.commentaire ?? "").trim();
  if (!prenom || prenom.length > 60) erreurs.push("Prénom obligatoire (60 caractères au plus).");
  if (!nom || nom.length > 60) erreurs.push("Nom obligatoire (60 caractères au plus).");
  const telephone = normaliserTelephone(c.telephone ?? "");
  if (!telephone) erreurs.push("Numéro de téléphone invalide.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erreurs.push("Adresse e-mail invalide.");
  if (!email && options.emailObligatoire) erreurs.push("Adresse e-mail obligatoire.");
  if (commentaire.length > 500) erreurs.push("Commentaire : 500 caractères au plus.");
  if (c.civilite && !["Mme", "M.", "Mx"].includes(c.civilite)) erreurs.push("Civilité invalide.");
  if (erreurs.length) return { erreurs };
  return {
    ok: {
      ...(c.civilite ? { civilite: c.civilite } : {}),
      prenom,
      nom,
      telephone: telephone!,
      ...(email ? { email } : {}),
      ...(commentaire ? { commentaire } : {}),
    },
  };
}
