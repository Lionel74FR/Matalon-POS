// Outils des parcours : déclare les imprimantes de l'établissement dans Réglages › Imprimantes de
// l'établissement (16 novembre 2026), puis l'imprimante de chaque poste.
// liste : [{ nom, type: "epson" | "serie" | "reseau", adresse?, dalle? }] ; postes : { Bar: "Nom de l'imprimante" }.
export async function declarerImprimantes(p, liste, postes = {}) {
  const bloc = p.locator("fieldset", { has: p.locator("legend", { hasText: "Imprimantes de l'établissement" }) });
  const lignes = bloc.locator(".imprimantes-etablissement > table:not(.postes-production)").locator("tbody tr");
  const deja = await lignes.count();
  for (const [k, i] of liste.entries()) {
    await bloc.getByRole("button", { name: "Ajouter une imprimante" }).click();
    const ligne = lignes.nth(deja + k);
    await ligne.locator("input").first().fill(i.nom);
    const types = { epson: "Epson réseau", serie: "Série sur une dalle", reseau: "Réseau par une dalle (script)" };
    await ligne.locator("select").first().selectOption({ label: types[i.type] });
    if (i.adresse) await ligne.locator(".imprimante-lieu input").fill(i.adresse);
    if (i.dalle) await ligne.locator(".imprimante-lieu select").selectOption({ label: i.dalle });
  }
  for (const [poste, nom] of Object.entries(postes)) await bloc.getByLabel(`Imprimante du poste ${poste}`).selectOption({ label: nom });
  await bloc.getByRole("button", { name: "Enregistrer les imprimantes" }).click();
  await bloc.getByText("Imprimantes enregistrées pour tout l'établissement").waitFor();
}

/** Choisit sur cet appareil l'imprimante des tickets (et des additions) dans la liste de l'établissement. */
export async function choisirImprimantes(p, tickets, additions) {
  const bloc = p.locator("fieldset", { has: p.locator("legend", { hasText: /^Imprimantes de cet/ }) });
  if (tickets) await bloc.getByRole("radiogroup", { name: "Imprimante des tickets" }).getByRole("radio", { name: new RegExp(`^${tickets}`) }).click();
  if (additions) await bloc.getByRole("radiogroup", { name: "Imprimante des additions" }).getByRole("radio", { name: new RegExp(`^${additions}`) }).click();
}
