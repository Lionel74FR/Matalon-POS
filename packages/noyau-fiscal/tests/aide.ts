import {
  genererPaireCles,
  Registre,
  signataireDepuis,
  StockageMemoire,
  type ResolveurCle,
  type SaisieLigne,
} from "../src/index.js";

/** Horloge pilotable : chaque appel renvoie l'instant courant, avancé à la demande. */
export function horlogeFixe(iso: string) {
  let t = Date.parse(iso);
  const horloge = () => new Date(t);
  return {
    horloge,
    aller(nouvelIso: string) {
      t = Date.parse(nouvelIso);
    },
    avancer(minutes: number) {
      t += minutes * 60_000;
    },
  };
}

export async function nouveauRegistre(debut = "2026-10-15T08:00:00Z") {
  const paire = await genererPaireCles("moka-ipad-1-k1");
  const stockage = new StockageMemoire();
  const temps = horlogeFixe(debut);
  const registre = new Registre({
    stockage,
    signataire: signataireDepuis(paire),
    contexte: { etablissementId: "moka", caisseId: "ipad-1" },
    horloge: temps.horloge,
  });
  const resoudreCle: ResolveurCle = (id) => (id === paire.cleId ? paire.clePubliqueJwk : null);
  return { registre, stockage, temps, paire, resoudreCle };
}

export const CAPPUCCINO: SaisieLigne = {
  articleId: "cafe-cappuccino",
  libelle: "Cappuccino",
  quantite: 1,
  prixUnitaireTTC: 400,
  tauxTVA: 1000,
};

export const SPRITZ: SaisieLigne = {
  articleId: "spritz-aperol",
  libelle: "Spritz Aperol",
  quantite: 1,
  prixUnitaireTTC: 1100,
  tauxTVA: 2000,
};
