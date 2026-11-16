// Outils des parcours : Réglages en onglets (16 novembre 2026), imprimantes de l'établissement déclarées
// dans l'onglet « Imprimantes », choix de chaque appareil dans l'onglet « Cet appareil ».

/** Ouvre un onglet des Réglages (« Cet appareil », « Imprimantes », « Établissement », « Équipe »). */
export async function ongletReglages(p, nom) {
  const onglets = p.getByRole("tablist", { name: "Réglages" });
  if (await onglets.isVisible()) return onglets.getByRole("tab", { name: nom }).click();
  // iPhone : menu des réglages, puis la rubrique.
  const retour = p.locator(".retour-reglages");
  if (await retour.isVisible()) await retour.click();
  await p.getByRole("navigation", { name: "Réglages" }).getByRole("button", { name: new RegExp(`^${nom}`) }).click();
}

// liste : [{ nom, type: "epson" | "serie" | "reseau", adresse?, dalle? }] ; postes : { Bar: "Nom de l'imprimante" }.
export async function declarerImprimantes(p, liste, postes = {}) {
  await ongletReglages(p, "Imprimantes");
  const bloc = p.locator("fieldset", { has: p.locator("legend", { hasText: "Imprimantes de l'établissement" }) });
  const lignes = bloc.locator(".liste-imprimantes .imprimante-ligne:not(.entete)");
  const deja = await lignes.count();
  for (const [k, i] of liste.entries()) {
    await bloc.getByRole("button", { name: "Ajouter une imprimante" }).click();
    const ligne = lignes.nth(deja + k);
    await ligne.locator("input").first().fill(i.nom);
    const types = { epson: "Epson réseau", serie: "Série sur une dalle", reseau: "Réseau par une dalle (script)" };
    await ligne.locator("select").first().selectOption({ label: types[i.type] });
    if (i.adresse) await ligne.getByLabel(/^Adresse IP de/).fill(i.adresse);
    if (i.dalle) await ligne.getByLabel(/^Dalle de/).selectOption({ label: i.dalle });
  }
  for (const [poste, nom] of Object.entries(postes)) await bloc.getByLabel(`Imprimante du poste ${poste}`).selectOption({ label: nom });
  await bloc.getByRole("button", { name: "Enregistrer les imprimantes" }).click();
  await bloc.getByText("Imprimantes enregistrées pour tout l'établissement").waitFor();
}

/** Choisit sur cet appareil l'imprimante des tickets (et des additions) dans la liste de l'établissement. */
export async function choisirImprimantes(p, tickets, additions) {
  await ongletReglages(p, "Cet appareil");
  const choisir = async (libelle, nom) => {
    const liste = p.getByLabel(libelle, { exact: true });
    await liste.locator("option", { hasText: new RegExp(`^${nom} \\(`) }).waitFor({ state: "attached" });
    const valeur = await liste.locator("option").evaluateAll((os, n) => os.find((o) => o.textContent.startsWith(`${n} (`))?.value, nom);
    await liste.selectOption(valeur);
  };
  if (tickets) await choisir("Imprimante des tickets", tickets);
  if (additions) await choisir("Imprimante des additions", additions);
}
