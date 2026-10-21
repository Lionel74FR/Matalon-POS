import { ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { AvecIcone } from "../ui/icones";
import { api, type EtablissementAdmin } from "./api";

/** Taille la plus grande du logo envoyé : assez pour un en-tête net, légère pour les e-mails. */
const LARGEUR_MAX = 600;
const HAUTEUR_MAX = 240;
const POIDS_MAX = 300_000;

/** Image choisie (PNG, JPEG, WebP ou SVG) ramenée à un PNG de 600 × 240 au plus, transparence gardée. */
async function versPng(fichier: File): Promise<string> {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error("Image illisible : choisissez un PNG, un JPEG, un WebP ou un SVG."));
      i.src = url;
    });
    const largeur = img.naturalWidth || 600;
    const hauteur = img.naturalHeight || 240;
    for (const facteur of [1, 0.7, 0.5]) {
      const e = Math.min(1, (LARGEUR_MAX * facteur) / largeur, (HAUTEUR_MAX * facteur) / hauteur);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(largeur * e));
      canvas.height = Math.max(1, Math.round(hauteur * e));
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
      if (png.length * 0.75 <= POIDS_MAX) return png;
    }
    throw new Error("Logo trop détaillé : choisissez une image plus simple (300 Ko au plus une fois réduite).");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Logo de l'établissement : en tête du module de réservation (sur fond sombre) et des e-mails
 * aux clients (sur fond blanc) : réservations, fidélité, note par e-mail. L'aperçu montre les deux.
 */
export function LogoEtablissement(props: { e: EtablissementAdmin; onChange: () => Promise<void> }) {
  const { e } = props;
  const champ = useRef<HTMLInputElement>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [ok, setOk] = useState("");
  const source = e.logo ? `/logo/${e.id}?v=${e.logo}` : null;

  const envoyer = async (png: string | null) => {
    setEnCours(true);
    setErreur("");
    setOk("");
    try {
      await api.enregistrerLogo(e.id, png);
      await props.onChange();
      setOk(png ? "Logo enregistré : le module de réservation et les e-mails l'affichent désormais." : "Logo retiré : le nom de l'établissement le remplace.");
    } catch (x) {
      setErreur(x instanceof Error ? x.message : String(x));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <section className="admin-section logo-etablissement">
      <h2 className="titre-icone">
        <AvecIcone icone={ImagePlus} taille={22}>
          Logo
        </AvecIcone>
      </h2>
      <p className="explication">
        En tête du module de réservation (fond sombre) et des e-mails aux clients (fond blanc). Une image PNG à fond transparent passe
        partout ; elle est réduite à {LARGEUR_MAX} × {HAUTEUR_MAX} pixels au plus. Sans logo, le nom de l'établissement s'affiche.
      </p>
      {source ? (
        <div className="logo-apercus">
          <figure className="logo-apercu sombre">
            <img src={source} alt={`Logo de ${e.identite.enseigne}`} />
            <figcaption>Module de réservation</figcaption>
          </figure>
          <figure className="logo-apercu clair">
            <img src={source} alt="" />
            <figcaption>E-mails</figcaption>
          </figure>
        </div>
      ) : (
        <p className="explication">Aucun logo pour l'instant.</p>
      )}
      <input
        ref={champ}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        aria-label="Fichier du logo"
        hidden
        onChange={(x) => {
          const f = x.target.files?.[0];
          x.target.value = "";
          if (f) void versPng(f).then((png) => envoyer(png), (err: Error) => setErreur(err.message));
        }}
      />
      <div className="admin-ligne">
        <button type="button" className="bouton principal" disabled={enCours} onClick={() => champ.current?.click()}>
          <AvecIcone icone={ImagePlus}>{source ? "Changer le logo" : "Choisir le logo"}</AvecIcone>
        </button>
        {source && (
          <button type="button" className="bouton" disabled={enCours} onClick={() => void envoyer(null)}>
            <AvecIcone icone={Trash2}>Retirer</AvecIcone>
          </button>
        )}
      </div>
      {ok && <p className="admin-ok">{ok}</p>}
      {erreur && <p className="erreur">{erreur}</p>}
    </section>
  );
}
