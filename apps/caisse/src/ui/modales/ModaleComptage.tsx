import { Calculator, Check, ChevronRight, Coins, Delete, Lock, Plus, Trash2 } from "lucide-react";
import { AvecIcone, BoutonIcone } from "../icones";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { COUPURES, etatJournee, rapprocher, totalCoupures, totalDepenses, type EtatJournee, type SaisieComptage } from "../../metier/tresorerie";
import type { ReponseJournee } from "@matalon/serveur/partage";
import { fraicheur } from "../../fiscal/journee";
import { centimesDepuisSaisie, Modale, saisieDepuisCentimes } from "../communs";
import { appliquerTouche, enregistrerBrouillonComptage, lireBrouillonComptage } from "../../metier/brouillon-comptage";
import { euros, useCaisse } from "../contexte";

/**
 * Appareils couverts par la clôture, avec la fraîcheur de leur
 * synchronisation : un ticket qu'un appareil n'a pas encore envoyé entrera
 * dans la Z suivante.
 */
export function AppareilsDeLaJournee(props: { journee: ReponseJournee; caisseId: string }) {
  const ids = Object.keys(props.journee.appareils);
  if (ids.length < 2) return null;
  const autres = ids.filter((id) => id !== props.caisseId);
  return (
    <p className="explication appareils-journee">
      Appareils : {props.journee.appareils[props.caisseId] ?? "cet appareil"} (cet appareil)
      {autres.map((id) => `, ${props.journee.appareils[id]} (${fraicheur(props.journee.synchros[id] ?? null)})`).join("")}. Un ticket
      encore sur un appareil hors ligne entrera dans la clôture suivante.
    </p>
  );
}

const coupureLisible = (c: number) => (c >= 100 ? `${c / 100} €` : `${c} c`);

function Ecart(props: { valeur: number }) {
  if (props.valeur === 0) return <span className="ecart nul">Juste</span>;
  return (
    <span className="ecart">
      {props.valeur > 0 ? "Excédent" : "Manque"} {euros(Math.abs(props.valeur))}
    </span>
  );
}

/**
 * Montant ou nombre saisi au pavé de la fenêtre, jamais au clavier de l'iPad : dans une fenêtre fixe
 * d'une app posée sur l'écran d'accueil, le clavier d'iOS fige l'écran quand il s'ouvre et se ferme
 * de champ en champ (constaté au Moka pendant les comptages, 28 octobre 2026).
 */
function ChampPave(props: { id: string; libelle: string; aide?: ReactNode; valeur: string; actif: boolean; entier?: boolean; onChoisir: (id: string) => void }) {
  const invalide = !props.entier && props.valeur.trim() !== "" && centimesDepuisSaisie(props.valeur) == null;
  return (
    <div className="champ champ-euros">
      <span>
        {props.libelle}
        {props.aide && <small>{props.aide}</small>}
      </span>
      <button
        type="button"
        className={`saisie-pave${props.actif ? " actif" : ""}`}
        aria-label={props.libelle}
        aria-pressed={props.actif}
        aria-invalid={invalide}
        data-champ={props.id}
        onClick={() => props.onChoisir(props.id)}
      >
        <span className={props.valeur ? "" : "saisie-vide"}>{props.valeur || "0,00"}</span>
        <span aria-hidden="true">€</span>
      </button>
    </div>
  );
}

const TOUCHES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "effacer"];

/** Pavé du comptage, collé en bas de la fenêtre tant qu'un champ est choisi. */
function PaveComptage(props: { libelle: string; entier: boolean; onTouche: (t: string) => void; onSuivant: (() => void) | null; onTermine: () => void }) {
  return (
    <div className="pave-comptage" role="group" aria-label={`Pavé : ${props.libelle}`}>
      <span className="pave-comptage-champ">{props.libelle}</span>
      <div className="pave-comptage-touches">
        {TOUCHES.map((t) => (
          <button
            key={t}
            type="button"
            className="touche"
            disabled={t === "," && props.entier}
            aria-label={t === "effacer" ? "Effacer" : t === "," ? "Virgule" : t}
            onClick={() => props.onTouche(t)}
          >
            {t === "effacer" ? <Delete className="icone" size={24} aria-hidden="true" /> : t}
          </button>
        ))}
      </div>
      <div className="pave-comptage-actions">
        {props.onSuivant && (
          <button type="button" className="bouton" onClick={props.onSuivant}>
            <AvecIcone icone={ChevronRight}>Suivant</AvecIcone>
          </button>
        )}
        <button type="button" className="bouton principal" onClick={props.onTermine}>
          <AvecIcone icone={Check}>Terminé</AvecIcone>
        </button>
      </div>
    </div>
  );
}

/**
 * Comptage avant la clôture Z : espèces (fond + encaissements nets), CB et
 * titres-restaurant rapprochés du TPE. Tout écart demande un motif ; le
 * comptage est tracé au journal puis repris sur le ticket Z.
 *
 * Depuis le 28 octobre 2026 (écrans figés au Moka) : montants au pavé de la fenêtre, saisie gardée
 * sur l'appareil à chaque touche et reprise à la réouverture, écran maintenu allumé, fenêtre qui ne
 * se ferme plus d'un toucher à côté, journée chargée une seule fois.
 */
export function ModaleComptage(props: {
  commandesOuvertes: number;
  /** Journée de l'établissement reçue du serveur (verrou de clôture pris) ; null : hors ligne, appareil seul. */
  journee: ReponseJournee | null;
  enCours?: boolean;
  onValide: (saisie: SaisieComptage, etat: EtatJournee) => void;
  onFermer: () => void;
}) {
  const { caisse, config, imprimanteConfiguree, notifier } = useCaisse();
  const [etat, setEtat] = useState<EtatJournee | null>(null);
  const [fond, setFond] = useState("");
  const [detail, setDetail] = useState<SaisieComptage["detail"]>({});
  const [totalDirect, setTotalDirect] = useState<string | null>(null);
  const [cbTpe, setCbTpe] = useState("");
  const [trCarteTpe, setTrCarteTpe] = useState("");
  const [trPapier, setTrPapier] = useState("");
  const [fondConserve, setFondConserve] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  // Dépenses payées avec les espèces du tiroir : libellé et montant saisis.
  const [depenses, setDepenses] = useState<Array<{ cle: number; libelle: string; montant: string }>>([]);
  /** Champ en cours de saisie au pavé ; `neuf` : la prochaine touche remplace la valeur. */
  const [actif, setActif] = useState<{ id: string; neuf: boolean } | null>(null);
  /** Heure du brouillon repris à l'ouverture. */
  const [repris, setRepris] = useState<string | null>(null);
  const journeeBrouillon = useRef<string | null>(null);

  // La journée se charge une fois : une resynchronisation (nouvelle configuration) ne recharge pas
  // la fenêtre et ne remet pas le fond à zéro en pleine saisie.
  const caisseRef = useRef(caisse);
  const notifierRef = useRef(notifier);
  const fermerRef = useRef(props.onFermer);
  fermerRef.current = props.onFermer;
  useEffect(() => {
    let annule = false;
    etatJournee(caisseRef.current, props.journee).then(
      (e) => {
        if (annule) return;
        const journee = e.dateComptable ?? "jour";
        journeeBrouillon.current = journee;
        const b = lireBrouillonComptage(config.caisseId, journee);
        if (b) {
          setFond(b.fond);
          setDetail(b.detail as SaisieComptage["detail"]);
          setTotalDirect(b.totalDirect);
          setCbTpe(b.cbTpe);
          setTrCarteTpe(b.trCarteTpe);
          setTrPapier(b.trPapier);
          setFondConserve(b.fondConserve);
          setMotif(b.motif);
          setDepenses(b.depenses);
          setRepris(b.enregistreLe);
        } else {
          setFond(saisieDepuisCentimes(e.fondDeclare ?? e.fondPropose ?? null));
        }
        setEtat(e);
      },
      (e) => {
        if (annule) return;
        notifierRef.current(e instanceof Error ? e.message : String(e), "erreur");
        fermerRef.current();
      },
    );
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.journee]);

  // Chaque touche est gardée sur l'appareil : un écran figé ou un redémarrage ne perd pas le comptage.
  useEffect(() => {
    if (!etat || !journeeBrouillon.current) return;
    enregistrerBrouillonComptage(config.caisseId, {
      journee: journeeBrouillon.current,
      enregistreLe: new Date().toISOString(),
      fond,
      detail: detail as Record<string, number>,
      totalDirect,
      cbTpe,
      trCarteTpe,
      trPapier,
      fondConserve,
      motif,
      depenses,
    });
  }, [etat, config.caisseId, fond, detail, totalDirect, cbTpe, trCarteTpe, trPapier, fondConserve, motif, depenses]);

  // On compte la monnaie sans toucher l'écran : il reste allumé tant que la fenêtre est ouverte (là où iPadOS le permet).
  useEffect(() => {
    type Verrou = { release: () => Promise<void> };
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Verrou> } }).wakeLock;
    if (!wl) return;
    let verrou: Verrou | null = null;
    let fini = false;
    const demander = () =>
      void wl.request("screen").then(
        (v) => (fini ? void v.release() : (verrou = v)),
        () => undefined,
      );
    const visible = () => document.visibilityState === "visible" && demander();
    demander();
    document.addEventListener("visibilitychange", visible);
    return () => {
      fini = true;
      document.removeEventListener("visibilitychange", visible);
      void verrou?.release().catch(() => undefined);
    };
  }, []);

  const depensesLues = depenses.map((d) => ({ libelle: d.libelle.trim(), montant: centimesDepuisSaisie(d.montant) }));
  const depensesInvalides = depensesLues.some((d) => d.libelle.length < 2 || d.montant == null || d.montant <= 0);
  const depensesValides = depensesInvalides ? null : depensesLues.map((d) => ({ libelle: d.libelle, montant: d.montant! }));
  const especesComptees = totalDirect != null ? centimesDepuisSaisie(totalDirect) : totalCoupures(detail);
  const trPapierCaisse = etat?.totaux.paiements.find((p) => p.mode === "TITRE_RESTAURANT_PAPIER")?.montant ?? 0;
  const saisie: SaisieComptage | null = useMemo(() => {
    const valeurs = {
      fondInitial: centimesDepuisSaisie(fond),
      especesComptees,
      cbTpe: centimesDepuisSaisie(cbTpe),
      trCarteTpe: centimesDepuisSaisie(trCarteTpe),
      trPapierComptes: trPapierCaisse === 0 && trPapier.trim() === "" ? 0 : centimesDepuisSaisie(trPapier),
    };
    if (Object.values(valeurs).some((v) => v == null)) return null;
    const fc = fondConserve == null ? valeurs.fondInitial! : centimesDepuisSaisie(fondConserve);
    if (fc == null || !depensesValides) return null;
    return { ...(valeurs as Record<keyof typeof valeurs, number>), depenses: depensesValides, detail: totalDirect != null ? {} : detail, fondConserve: fc, motif };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fond, especesComptees, cbTpe, trCarteTpe, trPapier, trPapierCaisse, fondConserve, totalDirect, detail, motif, JSON.stringify(depensesValides)]);

  const r = etat && saisie ? rapprocher(etat.totaux, saisie) : null;
  const motifManquant = !!r?.avecEcart && motif.trim().length < 3;
  const fondTropGrand = !!saisie && saisie.fondConserve > saisie.especesComptees;

  // ── Champs saisis au pavé : lecture, écriture, ordre de « Suivant » ──
  const champs: Array<{ id: string; libelle: string; entier: boolean; lire: () => string; ecrire: (v: string) => void }> = [
    { id: "fond", libelle: "Fond de caisse du matin", entier: false, lire: () => fond, ecrire: setFond },
    ...depenses.map((d, i) => ({
      id: `depense:${d.cle}`,
      libelle: `Dépense ${i + 1} : montant`,
      entier: false,
      lire: () => d.montant,
      ecrire: (v: string) => setDepenses((x) => x.map((y) => (y.cle === d.cle ? { ...y, montant: v } : y))),
    })),
    ...(totalDirect == null
      ? COUPURES.map((c) => ({
          id: `coupure:${c}`,
          libelle: coupureLisible(c),
          entier: true,
          lire: () => (detail[c] ? String(detail[c]) : ""),
          ecrire: (v: string) => setDetail((x) => ({ ...x, [c]: Number(v) || undefined })),
        }))
      : [{ id: "total", libelle: "Espèces comptées", entier: false, lire: () => totalDirect, ecrire: (v: string) => setTotalDirect(v) }]),
    { id: "cb", libelle: "Total CB du TPE", entier: false, lire: () => cbTpe, ecrire: setCbTpe },
    { id: "trCarte", libelle: "Titres-restaurant carte du TPE", entier: false, lire: () => trCarteTpe, ecrire: setTrCarteTpe },
    ...(trPapierCaisse > 0 ? [{ id: "trPapier", libelle: "Titres-restaurant papier comptés", entier: false, lire: () => trPapier, ecrire: setTrPapier }] : []),
    { id: "fondConserve", libelle: "Fond laissé dans le tiroir", entier: false, lire: () => fondConserve ?? fond, ecrire: (v: string) => setFondConserve(v) },
  ];
  const champActif = actif ? champs.find((c) => c.id === actif.id) ?? null : null;
  const choisir = (id: string) => setActif((a) => (a?.id === id ? null : { id, neuf: true }));
  const toucher = (t: string) => {
    if (!champActif || !actif) return;
    champActif.ecrire(appliquerTouche(champActif.lire(), t, { entier: champActif.entier, neuf: actif.neuf }));
    setActif({ id: actif.id, neuf: false });
  };
  const indexActif = champActif ? champs.indexOf(champActif) : -1;
  const suivant = indexActif >= 0 && indexActif < champs.length - 1 ? champs[indexActif + 1]! : null;
  // Le champ choisi reste visible au-dessus du pavé.
  useEffect(() => {
    if (!actif) return;
    document.querySelector(`[data-champ="${CSS.escape(actif.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [actif?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Clavier physique (ordinateur, clavier d'iPad) : chiffres, virgule, effacement, Entrée.
  useEffect(() => {
    if (!actif) return;
    const touche = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const t = /^\d$/.test(e.key) ? e.key : e.key === "," || e.key === "." ? "," : e.key === "Backspace" ? "effacer" : null;
      if (t) {
        e.preventDefault();
        toucher(t);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        setActif(suivant ? { id: suivant.id, neuf: true } : null);
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  });

  if (!etat) {
    return (
      <Modale titre="Comptage de fin de journée" onFermer={props.onFermer} fermetureDehors={false}>
        <p>Calcul des totaux…</p>
      </Modale>
    );
  }
  const t = etat.totaux;
  const encaisseEspeces = t.paiements.find((p) => p.mode === "ESPECES")?.montant ?? 0;
  const cbCaisse = t.paiements.find((p) => p.mode === "CB")?.montant ?? 0;
  const trCarteCaisse = t.paiements.find((p) => p.mode === "TITRE_RESTAURANT_CARTE")?.montant ?? 0;
  const champ = (id: string, aide?: ReactNode) => {
    const c = champs.find((x) => x.id === id)!;
    return <ChampPave id={c.id} libelle={c.libelle} aide={aide} valeur={c.lire()} actif={actif?.id === c.id} entier={c.entier} onChoisir={choisir} />;
  };

  return (
    <Modale
      titre={`Comptage et clôture${etat.dateComptable ? ` · journée du ${etat.dateComptable}` : ""}`}
      large
      fermetureDehors={false}
      onFermer={props.onFermer}
      pied={
        <>
          {r && (
            <span className="comptage-resume">
              {r.avecEcart ? "Écart à justifier" : "Aucun écart"} · remise en banque {euros(Math.max(0, r.remiseEnBanque))}
            </span>
          )}
          <button
            className="bouton principal"
            disabled={!saisie || motifManquant || fondTropGrand || props.enCours}
            onClick={() => saisie && props.onValide(saisie, etat)}
          >
            <AvecIcone icone={Lock}>{imprimanteConfiguree ? "Valider, clôturer et imprimer le Z" : "Valider et clôturer la journée"}</AvecIcone>
          </button>
        </>
      }
    >
      {repris && (
        <p className="comptage-repris" role="status">
          Comptage repris là où il s'était arrêté ({new Date(repris).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", timeStyle: "short" })}).
        </p>
      )}
      <p className="explication">
        {t.nbVentes} vente{t.nbVentes > 1 ? "s" : ""} pour {euros(t.totalTTC)}, tous appareils confondus. La clôture fige la journée de
        l'établissement et ne peut pas être annulée. La saisie est gardée sur l'appareil jusqu'à la clôture.
      </p>
      {props.journee ? (
        <AppareilsDeLaJournee journee={props.journee} caisseId={config.caisseId} />
      ) : (
        <p className="explication">Hors ligne : cet appareil est le seul de l'établissement, la clôture se fait sans le serveur.</p>
      )}
      {etat.journees.length > 1 && (
        <p className="erreur">
          La clôture de la veille a été oubliée : {etat.journees.length} Z seront produites ({etat.journees.join(", ")}). Le comptage
          porte sur l'ensemble et figure sur la dernière.
        </p>
      )}
      {props.commandesOuvertes > 0 && (
        <p className="erreur">
          {props.commandesOuvertes} commande{props.commandesOuvertes > 1 ? "s ouvertes seront comptées" : " ouverte sera comptée"} sur la
          journée de leur encaissement. Une table qui part sans payer peut être portée au compte d'un client : Encaisser › En compte.
        </p>
      )}

      <div className="comptage">
        <section>
          <h3>Espèces</h3>
          {champ("fond", etat.fondDeclare == null ? "Non déclaré à l'ouverture : saisissez-le" : "Déclaré à l'ouverture")}
          <dl className="comptage-lignes">
            <div>
              <dt>Encaissé en espèces (rendu déduit)</dt>
              <dd>{euros(encaisseEspeces)}</dd>
            </div>
          </dl>
          <div className="depenses-especes">
            <h4>Dépenses payées en espèces</h4>
            {depenses.map((d, i) => (
              <div key={d.cle} className="depense-ligne">
                <input
                  value={d.libelle}
                  maxLength={60}
                  placeholder="Objet (glaçons, livreur…)"
                  aria-label={`Dépense ${i + 1} : objet`}
                  onFocus={() => setActif(null)}
                  onChange={(e) => setDepenses((x) => x.map((y) => (y.cle === d.cle ? { ...y, libelle: e.target.value } : y)))}
                />
                <button
                  type="button"
                  className={`saisie-pave${actif?.id === `depense:${d.cle}` ? " actif" : ""}`}
                  aria-label={`Dépense ${i + 1} : montant`}
                  aria-pressed={actif?.id === `depense:${d.cle}`}
                  aria-invalid={d.montant.trim() !== "" && centimesDepuisSaisie(d.montant) == null}
                  data-champ={`depense:${d.cle}`}
                  onClick={() => choisir(`depense:${d.cle}`)}
                >
                  <span className={d.montant ? "" : "saisie-vide"}>{d.montant || "0,00"}</span>
                  <span aria-hidden="true">€</span>
                </button>
                <BoutonIcone
                  icone={Trash2}
                  taille={18}
                  variante="discret"
                  libelle={`Retirer la dépense ${i + 1}`}
                  onClick={() => {
                    setActif(null);
                    setDepenses((x) => x.filter((y) => y.cle !== d.cle));
                  }}
                />
              </div>
            ))}
            {depenses.length < 10 && (
              <button className="bouton discret" onClick={() => setDepenses((x) => [...x, { cle: Date.now(), libelle: "", montant: "" }])}>
                <AvecIcone icone={Plus}>Ajouter une dépense</AvecIcone>
              </button>
            )}
            {depensesInvalides && <p className="erreur">Chaque dépense demande un objet et un montant.</p>}
          </div>
          <dl className="comptage-lignes">
            {depenses.length > 0 && (
              <div>
                <dt>Dépenses en espèces</dt>
                <dd>− {euros(totalDepenses(depensesValides ?? []))}</dd>
              </div>
            )}
            <div>
              <dt>Attendu dans le tiroir</dt>
              <dd>{centimesDepuisSaisie(fond) == null ? "—" : euros(centimesDepuisSaisie(fond)! + encaisseEspeces - totalDepenses(depensesValides ?? []))}</dd>
            </div>
          </dl>
          {totalDirect == null ? (
            <>
              <div className="coupures">
                {COUPURES.map((c) => (
                  <div key={c} className="coupure">
                    <span aria-hidden="true">{coupureLisible(c)}</span>
                    <button
                      type="button"
                      className={`saisie-pave${actif?.id === `coupure:${c}` ? " actif" : ""}`}
                      aria-label={`${coupureLisible(c)} : nombre`}
                      aria-pressed={actif?.id === `coupure:${c}`}
                      data-champ={`coupure:${c}`}
                      onClick={() => choisir(`coupure:${c}`)}
                    >
                      <span className={detail[c] ? "" : "saisie-vide"}>{detail[c] ?? "0"}</span>
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="bouton discret"
                onClick={() => {
                  setActif(null);
                  setTotalDirect(saisieDepuisCentimes(totalCoupures(detail) || null));
                }}
              >
                <AvecIcone icone={Calculator}>Saisir le total directement</AvecIcone>
              </button>
            </>
          ) : (
            <>
              {champ("total")}
              <button
                className="bouton discret"
                onClick={() => {
                  setActif(null);
                  setTotalDirect(null);
                }}
              >
                <AvecIcone icone={Coins}>Compter par billets et pièces</AvecIcone>
              </button>
            </>
          )}
          <dl className="comptage-lignes">
            <div>
              <dt>Compté</dt>
              <dd className="fort">{especesComptees == null ? "—" : euros(especesComptees)}</dd>
            </div>
            <div>
              <dt>Écart espèces</dt>
              <dd>{r ? <Ecart valeur={r.ecartEspeces} /> : "—"}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3>Cartes (ticket de fin de journée du TPE)</h3>
          {champ("cb", `Caisse : ${euros(cbCaisse)}`)}
          {r && <p className="comptage-ecart">Écart CB : <Ecart valeur={r.ecartCb} /></p>}
          {champ("trCarte", `Caisse : ${euros(trCarteCaisse)}`)}
          {r && <p className="comptage-ecart">Écart titres carte : <Ecart valeur={r.ecartTrCarte} /></p>}
          {trPapierCaisse > 0 && (
            <>
              {champ("trPapier", `Caisse : ${euros(trPapierCaisse)}`)}
              {r && <p className="comptage-ecart">Écart titres papier : <Ecart valeur={r.ecartTrPapier} /></p>}
            </>
          )}

          <h3>Pour demain</h3>
          {champ("fondConserve", "Le reste part en remise en banque")}
          {fondTropGrand && <p className="erreur">Le fond laissé dépasse les espèces comptées.</p>}
          {r?.avecEcart && (
            <label className="champ champ-motif">
              <span>
                Motif de l'écart
                <small>Obligatoire, tracé au journal</small>
              </span>
              <input value={motif} onFocus={() => setActif(null)} onChange={(e) => setMotif(e.target.value)} maxLength={200} placeholder="Erreur de rendu, oubli de saisie…" />
            </label>
          )}
        </section>
      </div>
      {champActif && (
        <PaveComptage
          libelle={champActif.libelle}
          entier={champActif.entier}
          onTouche={toucher}
          onSuivant={suivant ? () => setActif({ id: suivant.id, neuf: true }) : null}
          onTermine={() => setActif(null)}
        />
      )}
    </Modale>
  );
}
