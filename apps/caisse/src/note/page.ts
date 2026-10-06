import { ventiler } from "@matalon/noyau-fiscal";
import { LIBELLES_PAIEMENT } from "../metier/libelles";
import { decoderNote, NoteIllisible, type NoteNumerique } from "./format";
import "./page.css";

const euros = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const taux = (t: number) => `${(t / 100).toLocaleString("fr-FR")} %`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...enfants: Array<Node | string | null>) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of enfants) if (c != null) e.append(c);
  return e;
}

function ligneMontant(gauche: string, droite: string, classe = "") {
  return el("div", { class: `ligne ${classe}` }, el("span", {}, gauche), el("span", {}, droite));
}

function rendre(n: NoteNumerique): HTMLElement {
  const [enseigne, raison, adresse, cpVille, tel, siret, tva] = n.e;
  const lignes = n.l.map(([q, libelle, pu, t, remise, motif]) => ({ q, libelle, pu, t, remise, motif, montant: q * pu - remise }));
  const ventilation = ventiler(lignes.map((l) => ({ tauxTVA: l.t, montantTTC: l.montant })));
  const total = lignes.reduce((s, l) => s + l.montant, 0);
  const date = new Date(n.d).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" });

  const papier = el(
    "article",
    { class: "papier" },
    n.x ? el("p", { class: "test" }, "Caisse de test — note sans valeur") : null,
    el("h1", {}, enseigne),
    el("p", { class: "etab" }, [raison, adresse, cpVille, tel && `Tél. ${tel}`].filter(Boolean).join("\n")),
    el("p", { class: "etab petit" }, [siret && `SIRET ${siret}`, tva && `TVA ${tva}`].filter(Boolean).join(" · ")),
    n.dup ? el("p", { class: "mention" }, `Duplicata n° ${n.dup}`) : null,
    n.k === "A" ? el("p", { class: "mention" }, `Annulation du ticket n° ${n.o}${n.m ? ` — ${n.m}` : ""}`) : null,
    el(
      "div",
      { class: "meta" },
      ligneMontant(`Note n° ${String(n.n).padStart(6, "0")}`, ""),
      el("div", { class: "date" }, date),
      el("div", {}, [n.tb, n.cv ? `${Math.abs(n.cv)} couvert(s)` : "", n.s && `servi par ${n.s}`].filter(Boolean).join(" · ")),
    ),
    el(
      "div",
      { class: "articles" },
      ...lignes.flatMap((l) => [
        ligneMontant(`${l.q} × ${l.libelle}`, euros(l.q * l.pu)),
        l.remise ? ligneMontant(`Remise${l.motif ? ` (${l.motif})` : ""}`, euros(-l.remise), "remise") : null,
      ]),
    ),
    ligneMontant("Total TTC", euros(total), "total"),
    el(
      "table",
      { class: "tva" },
      el("thead", {}, el("tr", {}, el("th", {}, "TVA"), el("th", {}, "HT"), el("th", {}, "TVA"), el("th", {}, "TTC"))),
      el(
        "tbody",
        {},
        ...ventilation.filter((v) => v.montantTTC !== 0).map((v) =>
          el("tr", {}, el("td", {}, taux(v.tauxTVA)), el("td", {}, euros(v.baseHT)), el("td", {}, euros(v.montantTVA)), el("td", {}, euros(v.montantTTC))),
        ),
      ),
    ),
    el(
      "div",
      { class: "paiements" },
      ...n.p.map(([mode, montant]) => ligneMontant(LIBELLES_PAIEMENT[mode], euros(montant))),
      n.r ? ligneMontant("Rendu monnaie", euros(n.r)) : null,
    ),
    el("p", { class: "pied" }, "Prix nets, service compris"),
    el("p", { class: "pied petit" }, `${n.c} · Matalon POS ${n.ver} · empreinte ${n.h}`),
    total !== n.tt ? el("p", { class: "alerte" }, "Les montants de ce lien ne correspondent pas : demandez la note au comptoir.") : null,
  );

  const actions = el("div", { class: "actions" });
  const enregistrer = el("button", { type: "button" }, "Enregistrer en PDF");
  enregistrer.addEventListener("click", () => window.print());
  actions.append(enregistrer);
  if (navigator.share) {
    const partager = el("button", { type: "button" }, "Envoyer");
    partager.addEventListener("click", () => void navigator.share({ title: `Note ${enseigne}`, url: location.href }).catch(() => undefined));
    actions.append(partager);
  }
  return el("div", {}, papier, actions, el("p", { class: "aide" }, "Cette note n'est enregistrée nulle part : gardez ce lien ou enregistrez-la."));
}

const racine = document.getElementById("note")!;
try {
  const note = decoderNote(location.hash);
  document.title = `Note ${note.e[0]} n° ${note.n}`;
  racine.append(rendre(note));
} catch (e) {
  racine.append(
    el(
      "div",
      { class: "papier" },
      el("h1", {}, "Note introuvable"),
      el("p", {}, e instanceof NoteIllisible ? e.message : "Ce lien ne peut pas être lu."),
      el("p", {}, "Scannez de nouveau le QR code affiché sur la caisse, ou demandez une note imprimée."),
    ),
  );
}
