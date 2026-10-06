import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Icônes de l'interface (Lucide, intégrées au code : elles s'affichent hors ligne).
 * Règle : une icône seule quand son sens est évident (fermer, retour, ajouter,
 * imprimer, se déconnecter…), toujours avec son libellé en `aria-label` et en
 * bulle ; une icône et un mot court quand l'action engage (encaisser, clôturer).
 */

/** Icône suivie d'un libellé, à l'intérieur d'un bouton ou d'un lien. */
export function AvecIcone(props: { icone: LucideIcon; children?: ReactNode; taille?: number; classe?: string }) {
  const Icone = props.icone;
  return (
    <>
      <Icone className={`icone${props.classe ? ` ${props.classe}` : ""}`} size={props.taille ?? 20} strokeWidth={2} aria-hidden="true" />
      {props.children != null && <span>{props.children}</span>}
    </>
  );
}

/** Bouton réduit à son icône ; `libelle` sert de nom accessible et de bulle. */
export function BoutonIcone(
  props: { icone: LucideIcon; libelle: string; taille?: number; variante?: "principal" | "danger" | "discret" } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "children"
  >,
) {
  const { icone, libelle, taille, variante, className, ...reste } = props;
  return (
    <button
      type="button"
      {...reste}
      className={`bouton bouton-icone${variante ? ` ${variante}` : ""}${className ? ` ${className}` : ""}`}
      aria-label={libelle}
      title={libelle}
    >
      <AvecIcone icone={icone} taille={taille ?? 22} />
    </button>
  );
}
