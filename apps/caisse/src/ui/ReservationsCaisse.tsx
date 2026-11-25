import { maintenantParis, minutes, type Reservation, type ServiceReservation } from "@matalon/reservations";
import { useCallback, useEffect, useState } from "react";
import { useCaisse } from "./contexte";

const CLE = "matalon.reservations.jour";

export interface JourCaisse {
  date: string;
  reservations: Reservation[];
  actif: boolean;
  /** Fenêtre de réservation en ligne (jours) : étendue de la recherche. */
  horizonJours?: number;
  dureeMinutes?: number;
  /** Services, écart entre créneaux et fermetures (liste par service, remplissage de la saisie). */
  services?: ServiceReservation[];
  pasMinutes?: 15 | 30;
  fermetures?: string[];
  /** Lu sur le serveur à cette heure ; hors ligne, la dernière copie gardée. */
  luLe: string;
}

function lireCopie(): JourCaisse | null {
  try {
    const j = JSON.parse(localStorage.getItem(CLE) ?? "null") as JourCaisse | null;
    return j && j.date === maintenantParis(new Date()).jour ? j : null;
  } catch {
    return null;
  }
}

/**
 * Réservations du jour, relues chaque minute (et au retour sur l'écran). Hors
 * ligne : la dernière copie du jour, gardée sur l'appareil.
 */
export function useReservationsDuJour() {
  const { caisse } = useCaisse();
  const [jour, setJour] = useState<JourCaisse | null>(lireCopie);
  const [horsLigne, setHorsLigne] = useState(false);
  const recharger = useCallback(async () => {
    try {
      const r = await caisse.client.reservations();
      const j: JourCaisse = {
        date: r.date,
        reservations: r.reservations,
        actif: r.actif,
        dureeMinutes: r.dureeMinutes,
        ...(r.horizonJours !== undefined ? { horizonJours: r.horizonJours } : {}),
        ...(r.services ? { services: r.services } : {}),
        ...(r.pasMinutes ? { pasMinutes: r.pasMinutes } : {}),
        ...(r.fermetures ? { fermetures: r.fermetures } : {}),
        luLe: new Date().toISOString(),
      };
      setJour(j);
      setHorsLigne(false);
      try {
        localStorage.setItem(CLE, JSON.stringify(j));
      } catch {
        /* stockage plein ou indisponible : la copie sert seulement hors ligne */
      }
    } catch {
      setHorsLigne(true);
    }
  }, [caisse.client]);
  useEffect(() => {
    void recharger();
    const t = setInterval(() => void recharger(), 60_000);
    const visible = () => document.visibilityState === "visible" && void recharger();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [recharger]);
  return { jour, horsLigne, recharger };
}

/** Minute de Paris maintenant (0–1439). */
export const minuteParis = () => maintenantParis(new Date()).minute;

/** Prochaine réservation à venir (pas encore installée) de chaque table, sur le reste du jour. */
export function aVenirParTable(liste: Reservation[]): Map<string, Reservation> {
  const m = new Map<string, Reservation>();
  const maintenant = minuteParis();
  for (const r of [...liste].sort((a, b) => minutes(a.heure) - minutes(b.heure))) {
    if (r.statut !== "confirmee" || minutes(r.heure) + r.dureeMinutes <= maintenant) continue;
    for (const t of r.tables) if (!m.has(t)) m.set(t, r);
  }
  return m;
}

export const nomClient = (r: Reservation) => `${r.prenom} ${r.nom}`.trim();
