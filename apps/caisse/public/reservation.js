/*
 * Matalon POS — module de réservation à intégrer à un site.
 *
 *   <script src="https://<caisse>/reservation.js" data-etablissement="moka" async></script>
 *
 * Options (attributs de la balise) :
 *   data-texte="R\u00e9server une table"   texte du bouton flottant
 *   data-bouton="non"                 pas de bouton flottant (seulement les boutons du site)
 *   data-logo="https://…/logo.png"    logo en tête du panneau
 *   data-position="gauche"            bouton flottant en bas à gauche
 * Tout élément du site portant data-matalon-reserver (ou un lien vers #reserver)
 * ouvre le panneau. En JavaScript : MatalonReservation.ouvrir() / .fermer().
 */
(function () {
  "use strict";
  var balise = document.currentScript;
  if (!balise || window.MatalonReservation) return;
  var etab = balise.getAttribute("data-etablissement") || "";
  var origine = new URL(balise.src).origin;
  var texte = balise.getAttribute("data-texte") || "R\u00e9server une table";
  var logo = balise.getAttribute("data-logo") || "";
  var gauche = balise.getAttribute("data-position") === "gauche";
  var avecBouton = balise.getAttribute("data-bouton") !== "non";

  var style = document.createElement("style");
  style.textContent = [
    ".mtl-bouton{position:fixed;bottom:20px;" + (gauche ? "left" : "right") + ":20px;z-index:2147483000;display:flex;align-items:center;gap:0;height:56px;padding:0;border:0;border-radius:14px;background:#282828;color:#fff;font:600 16px/1 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer}",
    ".mtl-bouton .mtl-ic{display:grid;place-items:center;width:58px;height:100%;border-right:1px solid #4a4a4a}",
    ".mtl-bouton .mtl-tx{padding:0 22px}",
    ".mtl-bouton:hover{background:#333}",
    ".mtl-voile{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.35);opacity:0;transition:opacity .2s}",
    ".mtl-panneau{position:fixed;bottom:20px;" + (gauche ? "left" : "right") + ":20px;z-index:2147483002;width:420px;height:min(760px,calc(100vh - 40px));border-radius:16px;overflow:hidden;background:#282828;box-shadow:0 18px 48px rgba(0,0,0,.45);transform:translateY(16px);opacity:0;transition:opacity .2s,transform .2s}",
    ".mtl-ouvert .mtl-voile{opacity:1}.mtl-ouvert .mtl-panneau{opacity:1;transform:none}",
    ".mtl-panneau iframe{display:block;width:100%;height:100%;border:0}",
    "@media (max-width:600px){.mtl-panneau{left:8px;right:8px;bottom:8px;top:max(8px,env(safe-area-inset-top));width:auto;height:auto}.mtl-bouton{bottom:14px;" + (gauche ? "left" : "right") + ":14px}}",
  ].join("");
  document.head.appendChild(style);

  var conteneur = null;
  var bouton = null;

  function url() {
    var p = "integre=1" + (logo ? "&logo=" + encodeURIComponent(logo) : "");
    return origine + "/reserver/" + encodeURIComponent(etab) + "?" + p;
  }

  function ouvrir() {
    if (conteneur) return;
    conteneur = document.createElement("div");
    conteneur.setAttribute("role", "dialog");
    conteneur.setAttribute("aria-label", "R\u00e9server une table");
    var voile = document.createElement("div");
    voile.className = "mtl-voile";
    voile.addEventListener("click", fermer);
    var panneau = document.createElement("div");
    panneau.className = "mtl-panneau";
    var cadre = document.createElement("iframe");
    cadre.src = url();
    cadre.title = "R\u00e9server une table";
    cadre.setAttribute("allow", "clipboard-write");
    panneau.appendChild(cadre);
    conteneur.appendChild(voile);
    conteneur.appendChild(panneau);
    document.body.appendChild(conteneur);
    if (bouton) bouton.style.display = "none";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (conteneur) conteneur.className = "mtl-ouvert";
      });
    });
  }

  function fermer() {
    if (!conteneur) return;
    var c = conteneur;
    conteneur = null;
    c.className = "";
    setTimeout(function () {
      c.remove();
    }, 220);
    if (bouton) bouton.style.display = "";
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== origine || !e.data) return;
    if (e.data.type === "matalon-reservation-fermer") fermer();
    if (e.data.type === "matalon-reservation-confirmee") {
      document.dispatchEvent(new CustomEvent("matalon:reservation", { detail: e.data }));
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") fermer();
  });
  document.addEventListener("click", function (e) {
    var cible = e.target && e.target.closest ? e.target.closest('[data-matalon-reserver],a[href="#reserver"]') : null;
    if (!cible) return;
    e.preventDefault();
    ouvrir();
  });

  function poserBouton() {
    if (!avecBouton) return;
    bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "mtl-bouton";
    bouton.innerHTML =
      '<span class="mtl-ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg></span><span class="mtl-tx"></span>';
    bouton.querySelector(".mtl-tx").textContent = texte;
    bouton.addEventListener("click", ouvrir);
    document.body.appendChild(bouton);
  }
  if (document.body) poserBouton();
  else document.addEventListener("DOMContentLoaded", poserBouton);

  window.MatalonReservation = { ouvrir: ouvrir, fermer: fermer };
})();
