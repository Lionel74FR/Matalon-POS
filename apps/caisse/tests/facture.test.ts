import { genererPaireCles, Registre, signataireDepuis, StockageMemoire, verifierRegistre } from "@matalon/noyau-fiscal";
import { describe, expect, it } from "vitest";
import { controlerClient, emettreAvoir, emettreFacture, impressionsFacture, listerFactures, mentionsVendeurManquantes, natureOperation, numeroFacture, prixUnitaireHT, tracerImpressionFacture } from "../src/metier/facture";

const CLIENT = { nom: "SARL Alpes Conseil", adresse: "3 avenue de Genève", codePostalVille: "74000 Annecy", siren: "123 456 789", tvaIntracom: "fr12123456789" };
const CAFE = { articleId: "cafe", libelle: "Cappuccino", quantite: 2, prixUnitaireTTC: 400, tauxTVA: 1000 };

async function caisse() {
  const paire = await genererPaireCles("ipad-1de068f6-k1");
  const stockage = new StockageMemoire();
  const registre = new Registre({ stockage, signataire: signataireDepuis(paire), contexte: { etablissementId: "moka", caisseId: "ipad-1de068f6" } });
  const vente = () => registre.enregistrerVente({ lignes: [CAFE], paiements: [{ mode: "CB", montant: 800 }], operateurId: "u-00000001" });
  return { stockage, registre, vente, resoudre: (id: string) => (id === paire.cleId ? paire.clePubliqueJwk : null) };
}

describe("factures sur demande", () => {
  it("numérote sans trou par caisse, réédite en duplicata et refuse les clients incomplets", async () => {
    const { stockage, registre, vente, resoudre } = await caisse();
    const [t1, t2] = [await vente(), await vente()];
    const o = { operateurId: "u-00000001", caisseId: "ipad-1de068f6" };
    await expect(emettreFacture(registre, stockage, { ...o, ticket: t1, client: { ...CLIENT, adresse: "" } })).rejects.toThrow(/adresse/);
    // Deux demandes simultanées ne prennent pas le même numéro.
    const [a, b] = await Promise.all([
      emettreFacture(registre, stockage, { ...o, ticket: t1, client: CLIENT }),
      emettreFacture(registre, stockage, { ...o, ticket: t2, client: CLIENT }),
    ]);
    expect([a.facture.numero, b.facture.numero]).toEqual(["F-1DE068F6-000001", "F-1DE068F6-000002"]);
    expect(a.facture.client).toMatchObject({ siren: "123456789", tvaIntracom: "FR12123456789" });
    const encore = await emettreFacture(registre, stockage, { ...o, ticket: t1, client: CLIENT });
    expect(encore).toMatchObject({ existante: true, facture: { numero: "F-1DE068F6-000001" } });
    expect(await listerFactures(stockage)).toHaveLength(2);
    expect(prixUnitaireHT(t1.lignes[0]!)).toBe(364);
    // Première impression = original, les suivantes sont des duplicatas tracés.
    expect(await impressionsFacture(stockage, a.facture.numero)).toBe(0);
    await tracerImpressionFacture(registre, stockage, a.facture, "a4", "u-00000001");
    await tracerImpressionFacture(registre, stockage, a.facture, "papier", "u-00000001");
    expect(await impressionsFacture(stockage, a.facture.numero)).toBe(2);
    expect((await stockage.lister("evenements")).filter((e) => e.details.facture === a.facture.numero).map((e) => e.code)).toEqual(["IMPRESSION_TICKET", "REIMPRESSION_TICKET"]);
    expect(natureOperation(t1)).toMatch(/restauration sur place/);
    expect((await verifierRegistre(stockage, resoudre)).integre).toBe(true);
  });

  it("émet un avoir à l'annulation d'une vente facturée et refuse de facturer une vente annulée", async () => {
    const { stockage, registre, vente } = await caisse();
    const o = { operateurId: "u-00000001", caisseId: "ipad-1de068f6" };
    const [t1, t2] = [await vente(), await vente()];
    await emettreFacture(registre, stockage, { ...o, ticket: t1, client: CLIENT });
    const a1 = await registre.enregistrerAnnulation({ numeroTicket: t1.numero, motif: "Réclamation client", operateurId: "u-00000001" });
    const avoir = await emettreAvoir(registre, stockage, { ...o, annulation: a1 });
    expect(avoir).toMatchObject({ nature: "AVOIR", numero: "F-1DE068F6-000002", factureOrigine: "F-1DE068F6-000001", ticket: a1.numero });
    expect(avoir?.evenement.details.totalTTC).toBe(-800);

    const a2 = await registre.enregistrerAnnulation({ numeroTicket: t2.numero, motif: "Erreur de saisie", operateurId: "u-00000001" });
    expect(await emettreAvoir(registre, stockage, { ...o, annulation: a2 })).toBeNull();
    await expect(emettreFacture(registre, stockage, { ...o, ticket: t2, client: CLIENT })).rejects.toThrow(/annulé/);
  });

  it("contrôle les mentions du vendeur et du client", () => {
    expect(numeroFacture("ipad-0a1b2c3d", 12)).toBe("F-0A1B2C3D-000012");
    expect(mentionsVendeurManquantes({ enseigne: "Moka", raisonSociale: "", adresse: "", codePostalVille: "", telephone: "", siret: "1", tvaIntracom: "", mentionsLegales: "" })).toEqual([
      "raison sociale",
      "adresse",
      "SIRET",
      "n° de TVA intracommunautaire",
      "forme juridique, capital et RCS",
    ]);
    expect(controlerClient({ ...CLIENT, siren: "12345" })).toMatch(/SIREN/);
  });
});
