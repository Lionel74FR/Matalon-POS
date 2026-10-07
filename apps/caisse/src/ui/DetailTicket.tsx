import { paiementsEffectifs, type Ticket } from "@matalon/noyau-fiscal";
import { LIBELLES_PAIEMENT } from "../impression/gabarits";
import { euros, useCaisse } from "./contexte";

const listePaiements = (l: Ticket["paiements"]) => l.map((p) => `${LIBELLES_PAIEMENT[p.mode]} ${euros(p.montant)}`).join(", ");

/**
 * Contenu d'un ticket : lignes, moyens de paiement (corrections comprises),
 * compte client, règlement. `tickets` : les tickets connus de cette caisse,
 * pour retrouver les corrections d'une vente (vide pour une autre caisse).
 */
export function DetailTicket(props: { ticket: Ticket; tickets: Ticket[] }) {
  const { config } = useCaisse();
  const t = props.ticket;
  const corrections = props.tickets.filter((x) => x.type === "CORRECTION" && x.ticketOrigine?.numero === t.numero && x.ticketOrigine.hash === t.hash);

  if (t.type === "CORRECTION") {
    return (
      <>
        <p className="explication">
          Corrige les moyens de paiement du ticket n° {t.ticketOrigine?.numero}. Total inchangé.
        </p>
        <ul className="detail-lignes">
          {t.paiements.map((p) => (
            <li key={p.mode}>
              <span>
                {LIBELLES_PAIEMENT[p.mode]} {p.montant < 0 ? "retiré" : "ajouté"}
              </span>
              <span>{p.montant > 0 ? `+${euros(p.montant)}` : euros(p.montant)}</span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      {t.client && !t.reglement && (
        <p className="explication">
          Au compte de <strong>{t.client.nom}</strong> : {euros(t.paiements.filter((p) => p.mode === "EN_COMPTE").reduce((x, p) => x + p.montant, 0))}
        </p>
      )}
      {t.reglement ? (
        <>
          <p className="explication">
            Règlement de <strong>{t.client?.nom}</strong>
          </p>
          <ul className="detail-lignes">
            {t.reglement.imputations.map((i) => (
              <li key={`${i.caisseId}-${i.numero}`}>
                <span>
                  Note n° {i.numero}
                  {i.caisseId !== config.caisseId && <small> · {i.caisseId}</small>}
                </span>
                <span>{euros(i.montantTTC)}</span>
              </li>
            ))}
            <li className="total">
              <span>Total réglé</span>
              <span>{euros(t.reglement.montantTTC)}</span>
            </li>
          </ul>
        </>
      ) : (
        <ul className="detail-lignes">
          {t.lignes.map((l, i) => (
            <li key={i}>
              <span>
                {l.quantite} × {l.libelle}
                {l.remiseTTC !== 0 && <small> · remise {euros(l.remiseTTC)} ({l.motifRemise})</small>}
              </span>
              <span>{euros(l.montantTTC)}</span>
            </li>
          ))}
          <li className="total">
            <span>Total</span>
            <span>{euros(t.totalTTC)}</span>
          </li>
        </ul>
      )}
      <section className="detail-paiements" aria-label="Moyens de paiement">
        <h3>{t.type === "ANNULATION" ? "Remboursement" : "Paiement"}</h3>
        <ul className="detail-lignes">
          {(corrections.length ? paiementsEffectifs(t, props.tickets) : t.paiements).map((p) => (
            <li key={p.mode}>
              <span>{LIBELLES_PAIEMENT[p.mode]}</span>
              <span>{euros(p.montant)}</span>
            </li>
          ))}
          {!corrections.length && t.renduMonnaie > 0 && (
            <li>
              <span>Rendu monnaie</span>
              <span>{euros(-t.renduMonnaie)}</span>
            </li>
          )}
        </ul>
        {corrections.length > 0 && (
          <p className="explication">
            Corrigé par le{corrections.length > 1 ? "s" : ""} ticket{corrections.length > 1 ? "s" : ""} n°{" "}
            {corrections.map((c) => `${c.numero} (${c.motif})`).join(", ")}. À l'origine : {listePaiements(t.paiements)}
            {t.renduMonnaie > 0 ? `, rendu ${euros(t.renduMonnaie)}` : ""}.
          </p>
        )}
      </section>
    </>
  );
}
