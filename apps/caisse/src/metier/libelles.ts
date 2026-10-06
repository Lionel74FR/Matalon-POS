import type { ModePaiement } from "@matalon/noyau-fiscal";

export const LIBELLES_PAIEMENT: Record<ModePaiement, string> = {
  CB: "Carte bancaire",
  ESPECES: "Espèces",
  TITRE_RESTAURANT_PAPIER: "Titre-restaurant papier",
  TITRE_RESTAURANT_CARTE: "Titre-restaurant carte",
  AUTRE: "Autre",
};
