import { CheckCircle2, Copy, Smartphone } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { IpayPaymentType } from "../../services/payments";

type PaymentInstructionsProps = {
  amountLabel: string;
  method: IpayPaymentType;
  reference?: string | null;
};

export function PaymentInstructions({ amountLabel, method, reference }: PaymentInstructionsProps) {
  const [copied, setCopied] = useState(false);
  const isNita = method === "nita_online";
  const isAmana = method === "amanata";
  const steps: ReactNode[] = isNita
    ? [
        <>Ouvrez <strong>MyNita</strong> et connectez-vous.</>,
        <>Appuyez sur <strong>Paiement</strong>.</>,
        <>Choisissez <strong>Règlement d’achat</strong>, puis <strong>En ligne</strong>.</>,
        <>Copiez la référence <strong>ACHAT…</strong> ci-dessous, vérifiez le montant, puis validez.</>
      ]
    : isAmana
      ? [
          <>Ouvrez <strong>Amanata</strong> et connectez-vous.</>,
          <>Appuyez sur <strong>Notifications</strong>.</>,
          <>Choisissez <strong>Achats en cours</strong>, puis <strong>Valider</strong>.</>,
          <>Ouvrez la demande <strong>AutoTicket</strong> en attente, vérifiez le montant, puis validez.</>
        ]
      : [
          <>Gardez le téléphone associé au numéro de paiement à proximité.</>,
          <>Attendez l’ouverture automatique de la fenêtre <strong>USSD Mobile Money</strong>.</>,
          <>Vérifiez le bénéficiaire et le montant de <strong>{amountLabel}</strong>.</>,
          <>Saisissez votre code secret Mobile Money dans la fenêtre USSD, puis validez.</>
        ];

  const copyReference = async () => {
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="payment-instructions" aria-live="polite">
      <header className="payment-instructions__header">
        <span className="payment-instructions__icon"><Smartphone aria-hidden="true" size={20} /></span>
        <div>
          <strong>{isNita ? "Payer avec MyNita" : isAmana ? "Payer avec Amanata" : "Valider avec Mobile Money"}</strong>
          <span>Suivez ces étapes sur votre téléphone avant de confirmer dans TicketPro.</span>
        </div>
      </header>

      <ol className="payment-instructions__steps">
        {steps.map((step, index) => <li key={index}>{step}</li>)}
      </ol>

      {isNita && reference ? (
        <div className="payment-instructions__reference">
          <div>
            <span>Référence de paiement</span>
            <code>{reference}</code>
          </div>
          <button onClick={() => void copyReference()} type="button">
            {copied ? <CheckCircle2 aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
            {copied ? "Copiée" : "Copier"}
          </button>
        </div>
      ) : null}

      <p className="payment-instructions__security">
        TicketPro ne vous demandera jamais votre code secret. Saisissez-le uniquement dans MyNita, Amanata ou la fenêtre USSD de votre opérateur.
      </p>
    </section>
  );
}
