import type { Catalogue } from "@matalon/catalogue";
import type { ReponseCarte, ReponseStock, ReponseVentesCarte } from "@matalon/serveur/partage";
import type { Recette } from "@matalon/stock";
import { createContext, useContext } from "react";
import { api } from "./api";

/**
 * Lectures et écritures de l'éditeur de carte et des fiches techniques. Dans
 * l'administration : la session administrateur. Sur l'iPad : le jeton de
 * l'appareil et le responsable connecté (voir ui/EditionCaisse.tsx).
 */
export interface AccesEdition {
  stock(): Promise<ReponseStock>;
  carte(id: string): Promise<ReponseCarte>;
  ventesCarte(id: string): Promise<ReponseVentesCarte>;
  enregistrerCarte(id: string, carte: Catalogue, version: number): Promise<ReponseCarte>;
  enregistrerRecette(recette: Recette): Promise<ReponseStock>;
}

export const ACCES_ADMIN: AccesEdition = {
  stock: () => api.stock(),
  carte: (id) => api.carte(id),
  ventesCarte: (id) => api.ventesCarte(id),
  enregistrerCarte: (id, carte, version) => api.enregistrerCarte(id, carte, version),
  enregistrerRecette: (recette) => api.enregistrerRecette(recette),
};

const Contexte = createContext<AccesEdition>(ACCES_ADMIN);
export const FournisseurAccesEdition = Contexte.Provider;
export const useAccesEdition = () => useContext(Contexte);
