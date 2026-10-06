import "fake-indexeddb/auto";
import { CARTE_AUTOMNE_2026, ligneDepuisArticle, trouverArticle } from "@matalon/catalogue";
import { genererPaireCles, Registre, signataireDepuis, verifierRegistre } from "@matalon/noyau-fiscal";
import { describe, expect, it } from "vitest";
import { ouvrirBase } from "../src/donnees/base";
import { genererTables, type Configuration } from "../src/donnees/configuration";
import { StockageIndexedDB } from "../src/donnees/stockage-idb";
import { versEposXml } from "../src/impression/epson";
import { gabaritAddition, gabaritCloture, gabaritNote } from "../src/impression/gabarits";
import { LARGEUR, versTexte } from "../src/impression/recu";
import { ajouterLigne, avecQuantite, nouvelleCommande, totauxCommande, versSaisie } from "../src/metier/commande";

let n = 0;
async function preparer() {
  const db = await ouvrirBase(`test-${++n}`);
  const stockage = new StockageIndexedDB(db);
  const paire = await genererPaireCles("moka-ipad-test-k1");
  const registre = new Registre({ stockage, signataire: signataireDepuis(paire), contexte: { etablissementId: "moka", caisseId: "ipad-test" } });
  return { db, stockage, registre, resoudre: (id: string) => (id === paire.cleId ? paire.clePubliqueJwk : null) };
}

const config: Configuration = {
  etablissementId: "moka",
  caisseId: "ipad-test",
  caisseNom: "Comptoir",
  carteId: "carte-automne-2026",
  installeeLe: "2026-10-15T08:00:00Z",
  etablissement: {
    enseigne: "Moka",
    raisonSociale: "SAS Exemple",
    adresse: "6 rue Vaugelas",
    codePostalVille: "74000 Annecy",
    telephone: "04 56 19 02 68",
    siret: "12345678900012",
    tvaIntracom: "FR00123456789",
  },
  utilisateurs: [{ id: "u-lea", nom: "Léa", role: "serveur", pinHash: "", actif: true }],
  tables: genererTables(12),
  imprimante: { adresse: "", sansAccents: false },
  seuilNoteAutomatique: 2500,
};

function commandeType() {
  const carte = CARTE_AUTOMNE_2026;
  let c = nouvelleCommande("t4", "u-lea", 2);
  for (const [id, variante] of [
    ["cappuccino", undefined],
    ["cappuccino", undefined],
    ["spritz-aperol", undefined],
    ["eau-minerale", "100cl"],
  ] as const) {
    const a = trouverArticle(carte, id)!;
    c = ajouterLigne(c, { ...ligneDepuisArticle(a, variante ? { varianteId: variante } : {}), details: [], ajouteePar: "u-lea" });
  }
  return c;
}

describe("stockage IndexedDB", () => {
  it("enregistre ventes, annulation et clôture, et la chaîne reste vérifiable", async () => {
    const { stockage, registre, resoudre } = await preparer();
    const c = commandeType();
    expect(c.lignes.map((l) => [l.libelle, l.quantite])).toEqual([
      ["Cappuccino", 2],
      ["Spritz Aperol", 1],
      ["Eau minérale 100 cl", 1],
    ]);
    const t = await registre.enregistrerVente({
      lignes: c.lignes.map(versSaisie),
      paiements: [{ mode: "ESPECES", montant: 3000 }],
      operateurId: "u-lea",
      tableId: "t4",
      couverts: 2,
    });
    expect(t.totalTTC).toBe(totauxCommande(c).totalTTC);
    expect(t.totalTTC).toBe(2450);
    expect(t.renduMonnaie).toBe(550);
    await registre.enregistrerAnnulation({ numeroTicket: 1, motif: "Erreur de table", operateurId: "u-lea" });
    const [z] = await registre.cloturerJournee("u-lea");
    expect(z).toMatchObject({ totalTTC: 0, nbVentes: 1, nbAnnulations: 1, dernierTicketCouvert: 2 });
    expect(await stockage.derniers("tickets", 1)).toHaveLength(1);
    expect((await verifierRegistre(stockage, resoudre)).integre).toBe(true);
  });

  it("refuse un lot qui ne prolonge pas la chaîne sans rien écrire", async () => {
    const { stockage, registre } = await preparer();
    const t = await registre.enregistrerVente({
      lignes: commandeType().lignes.map(versSaisie),
      paiements: [{ mode: "CB", montant: 2450 }],
      operateurId: "u-lea",
    });
    await expect(
      stockage.ajouterLot([
        { chaine: "evenements", enregistrement: { ...(await stockage.dernier("evenements"))!, numero: 1 } as never },
        { chaine: "tickets", enregistrement: { ...t, numero: 2 } },
      ]),
    ).rejects.toThrow(/refusé/);
    expect((await stockage.lister("tickets")).length).toBe(1);
  });

  it("garde la remise proportionnelle quand la quantité change", () => {
    const c = commandeType();
    const l = { ...c.lignes[0]!, remise: { pourcentage: 50, montantTTC: 400, motif: "Geste", accordeePar: "u" } };
    expect(avecQuantite(l, 3).remise!.montantTTC).toBe(600);
    expect(avecQuantite({ ...l, remise: { ...l.remise, pourcentage: 100 } }, 1).remise!.montantTTC).toBe(400);
  });
});

describe("impression", () => {
  it("produit une note de 48 colonnes avec les mentions et la TVA", async () => {
    const { registre } = await preparer();
    const t = await registre.enregistrerVente({
      lignes: commandeType().lignes.map(versSaisie),
      paiements: [{ mode: "CB", montant: 2450 }],
      operateurId: "u-lea",
      tableId: "t4",
      couverts: 2,
    });
    const texte = versTexte(gabaritNote(t, config));
    expect(texte.every((l) => l.length <= LARGEUR)).toBe(true);
    const tout = texte.join("\n");
    for (const attendu of ["SIRET 12345678900012", "TVA FR00123456789", "Table 4", "Servi par Léa", "2 x Cappuccino", "24,50 EUR", "Carte bancaire"]) {
      expect(tout).toContain(attendu);
    }
    expect(tout).toMatch(/10 %.*\n.*20 %/);
    const xml = versEposXml(gabaritNote(t, config, 1), { sansAccents: true });
    expect(xml).toContain("DUPLICATA");
    expect(xml).toContain("Servi par Lea");
    expect(xml).toContain('<cut type="feed"/>');
  });

  it("imprime une addition et un Z lisibles", async () => {
    const { registre } = await preparer();
    const addition = versTexte(gabaritAddition(commandeType(), config, "u-lea")).join("\n");
    expect(addition).toContain("ne vaut pas ticket de caisse");
    await registre.enregistrerVente({ lignes: commandeType().lignes.map(versSaisie), paiements: [{ mode: "CB", montant: 2450 }], operateurId: "u-lea" });
    const [z] = await registre.cloturerJournee("u-lea");
    const texteZ = versTexte(gabaritCloture(z!, config));
    expect(texteZ.every((l) => l.length <= LARGEUR)).toBe(true);
    expect(texteZ.join("\n")).toContain("Grand total perpétuel");
  });
});

describe("réponses de l'imprimante", () => {
  it("interprète l'état ePOS-Print", async () => {
    const { lireReponse } = await import("../src/impression/epson");
    expect(lireReponse('<response success="true" code="" status="251658262"/>')).toMatchObject({ succes: true, pret: true, problemes: [] });
    const capot = lireReponse('<response success="false" code="EPTR_COVER_OPEN" status="${0x20 | 0x8}"/>'.replace("${0x20 | 0x8}", String(0x20 | 0x8)));
    expect(capot.pret).toBe(false);
    expect(capot.problemes).toEqual(["imprimante hors ligne", "capot ouvert"]);
    expect(lireReponse(`<response success="true" code="" status="${0x00020000}"/>`).papierBientotFini).toBe(true);
    expect(lireReponse('<response success="false" code="EPTR_REC_EMPTY" status="0"/>').problemes).toEqual(["plus de papier"]);
  });
});

describe("note numérique (QR code)", () => {
  it("fait l'aller-retour, reste assez courte pour un QR code et détecte un lien abîmé", async () => {
    const { noteDepuisTicket, encoderNote, decoderNote, urlNote } = await import("../src/note/format");
    const { registre } = await preparer();
    const lignes = commandeType().lignes.map(versSaisie);
    const t = await registre.enregistrerVente({
      lignes: [...lignes, { articleId: "x", libelle: "Déjeuner Moka (Plat du jour, Cheesecake citron, Flat white)", quantite: 2, prixUnitaireTTC: 1900, tauxTVA: 1000, remise: { montantTTC: 1900, motif: "Offert maison" } }],
      paiements: [{ mode: "ESPECES", montant: 5000 }],
      operateurId: "u-lea",
      tableId: "t4",
      couverts: 2,
    });
    const note = noteDepuisTicket(t, { etablissement: config.etablissement, caisseId: config.caisseId, table: "Table 4", serveur: "Léa", test: true });
    const url = urlNote("https://moka-caisse-test.vercel.app", note);
    expect(url.length).toBeLessThan(900);
    const relue = decoderNote(url.split("#")[1]!);
    expect(relue).toEqual(note);
    expect(relue.tt).toBe(t.totalTTC);
    expect(() => decoderNote(encoderNote(note).slice(0, 40))).toThrow(/abîmé|valide/);
    expect(() => decoderNote("")).toThrow();
  });
});
