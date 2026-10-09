/**
 * Sur iPhone, les tableaux de l'administration passent en fiches (une ligne =
 * un bloc) : chaque cellule reprend alors le titre de sa colonne, posé ici en
 * `data-l` d'après l'en-tête du tableau. Tenu à jour à chaque rendu (React
 * ajoute, retire ou réordonne des lignes).
 */
function etiqueter(racine: ParentNode): void {
  for (const table of racine.querySelectorAll<HTMLTableElement>("table.admin-tableau")) {
    const titres = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
    if (!titres.length) continue;
    for (const tr of table.querySelectorAll("tbody tr")) {
      [...tr.children].forEach((td, i) => {
        const t = titres[i] ?? "";
        if (i > 0 && t && td.getAttribute("data-l") !== t) td.setAttribute("data-l", t);
      });
    }
  }
}

export function etiqueterTableaux(): void {
  let prevu = false;
  const planifier = () => {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => {
      prevu = false;
      etiqueter(document);
    });
  };
  new MutationObserver(planifier).observe(document.body, { childList: true, subtree: true, characterData: true });
  planifier();
}
