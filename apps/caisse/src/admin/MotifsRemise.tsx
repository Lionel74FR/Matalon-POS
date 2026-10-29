import { MOTIFS_REMISE_DEFAUT, problemeMotifsRemise } from "@matalon/serveur/partage";
import { ArrowDown, ArrowUp, BadgePercent, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { AvecIcone, BoutonIcone } from "../ui/icones";
import { api, type EtablissementAdmin } from "./api";

/**
 * Motifs de remise et d'offert de l'établissement (29 octobre 2026, demande de Lionel : isoler les
 * offerts à Camby) : ceux que la caisse propose quand on offre ou remise un article. Les statistiques
 * regroupent remises et offerts par motif (« Offert · Camby »). Renommer un motif ne réécrit pas les
 * tickets passés : ils gardent le motif de leur vente.
 */
export function MotifsRemise(props: { e: EtablissementAdmin; onChange: () => Promise<void> }) {
  const initiaux = props.e.motifsRemise?.length ? props.e.motifsRemise : MOTIFS_REMISE_DEFAUT;
  const [motifs, setMotifs] = useState<Array<{ cle: number; texte: string }>>(() => initiaux.map((texte, i) => ({ cle: i + 1, texte })));
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const textes = motifs.map((m) => m.texte.trim());
  const modifie = JSON.stringify(textes) !== JSON.stringify(initiaux);
  const probleme = problemeMotifsRemise(textes);

  const deplacer = (i: number, sens: -1 | 1) =>
    setMotifs((l) => {
      const j = i + sens;
      if (j < 0 || j >= l.length) return l;
      const copie = [...l];
      [copie[i], copie[j]] = [copie[j]!, copie[i]!];
      return copie;
    });

  const enregistrer = async () => {
    setEnCours(true);
    setMessage(null);
    try {
      await api.majMotifsRemise(props.e.id, textes);
      await props.onChange();
      setMessage({ ok: true, texte: "Motifs enregistrés : les appareils les reçoivent à leur prochaine synchronisation (une minute au plus)." });
    } catch (x) {
      setMessage({ ok: false, texte: x instanceof Error ? x.message : String(x) });
    } finally {
      setEnCours(false);
    }
  };

  return (
    <section className="admin-section motifs-remise">
      <h2 className="titre-icone">
        <AvecIcone icone={BadgePercent} taille={22}>
          Remises et offerts
        </AvecIcone>
      </h2>
      <p className="explication">
        Les motifs que la caisse propose pour une remise ou un article offert, dans cet ordre. Les statistiques donnent le montant de
        chaque motif (« Offert · Camby »). Un motif renommé ou retiré reste sur les tickets passés.
      </p>
      <ol className="motifs-liste">
        {motifs.map((m, i) => (
          <li key={m.cle}>
            <input
              value={m.texte}
              maxLength={40}
              aria-label={`Motif ${i + 1}`}
              onChange={(ev) => setMotifs((l) => l.map((x) => (x.cle === m.cle ? { ...x, texte: ev.target.value } : x)))}
            />
            <BoutonIcone icone={ArrowUp} variante="discret" libelle={`Monter « ${m.texte} »`} disabled={i === 0} onClick={() => deplacer(i, -1)} />
            <BoutonIcone icone={ArrowDown} variante="discret" libelle={`Descendre « ${m.texte} »`} disabled={i === motifs.length - 1} onClick={() => deplacer(i, 1)} />
            <BoutonIcone
              icone={Trash2}
              variante="discret"
              libelle={`Retirer « ${m.texte} »`}
              disabled={motifs.length === 1}
              onClick={() => setMotifs((l) => l.filter((x) => x.cle !== m.cle))}
            />
          </li>
        ))}
      </ol>
      <div className="options">
        <button
          type="button"
          className="bouton"
          disabled={motifs.length >= 12}
          onClick={() => setMotifs((l) => [...l, { cle: Math.max(0, ...l.map((x) => x.cle)) + 1, texte: "" }])}
        >
          <AvecIcone icone={Plus}>Ajouter un motif</AvecIcone>
        </button>
        <button type="button" className="bouton principal" disabled={!modifie || !!probleme || enCours} onClick={() => void enregistrer()}>
          <AvecIcone icone={Save}>Enregistrer les motifs</AvecIcone>
        </button>
      </div>
      {modifie && probleme && <p className="erreur">{probleme}</p>}
      {message && <p className={message.ok ? "succes" : "erreur"}>{message.texte}</p>}
    </section>
  );
}
