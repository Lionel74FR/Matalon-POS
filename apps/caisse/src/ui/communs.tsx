import { Delete, X } from "lucide-react";
import { BoutonIcone } from "./icones";
import { useEffect, type ReactNode } from "react";

export function Modale(props: {
  titre: string;
  onFermer: () => void;
  children: ReactNode;
  pied?: ReactNode;
  large?: boolean;
}) {
  useEffect(() => {
    const echap = (e: KeyboardEvent) => e.key === "Escape" && props.onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [props]);
  return (
    <div className="voile" onPointerDown={(e) => e.target === e.currentTarget && props.onFermer()}>
      <div className={`modale${props.large ? " large" : ""}`} role="dialog" aria-modal="true" aria-label={props.titre}>
        <header className="modale-tete">
          <h2>{props.titre}</h2>
          <BoutonIcone icone={X} variante="discret" libelle="Fermer" onClick={props.onFermer} />
        </header>
        <div className="modale-corps">{props.children}</div>
        {props.pied && <footer className="modale-pied">{props.pied}</footer>}
      </div>
    </div>
  );
}

/** Pavé numérique tactile. `onTouche` reçoit un chiffre, "00", "," ou "effacer". */
export function Pave(props: { onTouche: (t: string) => void; virgule?: boolean; doubleZero?: boolean }) {
  const touches = ["1", "2", "3", "4", "5", "6", "7", "8", "9", props.virgule ? "," : props.doubleZero ? "00" : "", "0", "effacer"];
  return (
    <div className="pave">
      {touches.map((t, i) =>
        t === "" ? (
          <span key={i} />
        ) : (
          <button key={i} className="touche" onClick={() => props.onTouche(t)} aria-label={t === "effacer" ? "Effacer" : t}>
            {t === "effacer" ? <Delete className="icone" size={28} aria-hidden="true" /> : t}
          </button>
        ),
      )}
    </div>
  );
}

/** Saisie d'un montant au pavé, en centimes (frappe « 1250 » → 12,50 €). */
export function appliquerToucheMontant(actuel: number, touche: string): number {
  if (touche === "effacer") return Math.floor(actuel / 10);
  if (touche === "00") return Math.min(actuel * 100, 99_999_99);
  if (/^\d$/.test(touche)) return Math.min(actuel * 10 + Number(touche), 99_999_99);
  return actuel;
}

export function Vide(props: { children: ReactNode }) {
  return <div className="vide">{props.children}</div>;
}

/** Saisie d'un montant en euros au clavier (« 152,30 »), restitué en centimes ; null si vide ou illisible. */
export function centimesDepuisSaisie(texte: string): number | null {
  const propre = texte.replace(/\s/g, "").replace("€", "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(propre)) return null;
  return Math.round(Number(propre) * 100);
}

export function saisieDepuisCentimes(c: number | null): string {
  return c == null ? "" : (c / 100).toFixed(2).replace(".", ",");
}

export function ChampEuros(props: { valeur: string; onChange: (texte: string) => void; libelle: string; aide?: ReactNode; autoFocus?: boolean }) {
  const invalide = props.valeur.trim() !== "" && centimesDepuisSaisie(props.valeur) == null;
  return (
    <label className="champ champ-euros">
      <span>
        {props.libelle}
        {props.aide && <small>{props.aide}</small>}
      </span>
      <span className="champ-euros-saisie">
        <input
          value={props.valeur}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={props.autoFocus}
          aria-invalid={invalide}
          placeholder="0,00"
          onChange={(e) => props.onChange(e.target.value)}
        />
        <span aria-hidden="true">€</span>
      </span>
    </label>
  );
}
