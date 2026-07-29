import { CheckCircle2 } from "lucide-react";
import type { IpayPaymentType } from "../../services/payments";
import airtelMoneyLogo from "../../assets/payements/airtel.png";
import amanaLogo from "../../assets/payements/amana.png";
import moovMoneyLogo from "../../assets/payements/moov.png";
import nitaLogo from "../../assets/payements/nita.png";
import zamaniLogo from "../../assets/payements/zamani.png";

const paymentMethods: Array<{
  description: string;
  label: string;
  type: IpayPaymentType;
}> = [
  {
    description: "Airtel Money, Moov Money et Zamani",
    label: "Mobile Money",
    type: "mobile"
  },
  {
    description: "Paiement depuis votre compte Nita",
    label: "Nita",
    type: "nita_online"
  },
  {
    description: "Paiement depuis votre compte Amana",
    label: "Amana",
    type: "amanata"
  }
];

export function PaymentMethodPicker({
  onChange,
  value
}: {
  onChange: (value: IpayPaymentType) => void;
  value: IpayPaymentType;
}) {
  return (
    <div className="payment-method-picker">
      <div className="payment-method-picker__heading">
        <strong>Opérateurs disponibles</strong>
        <span>Cliquez sur un moyen de paiement pour le sélectionner.</span>
      </div>
      <div className="payment-method-grid">
        {paymentMethods.map((method) => (
          <button
            aria-pressed={value === method.type}
            className={`payment-method-card${value === method.type ? " payment-method-card--selected" : ""}`}
            key={method.type}
            onClick={() => onChange(method.type)}
            type="button"
          >
            <PaymentMethodLogos type={method.type} />
            <span className="payment-method-card__copy">
              <strong>{method.label}</strong>
              <small>{method.description}</small>
            </span>
            <span className="payment-method-card__check" aria-hidden="true">
              <CheckCircle2 size={18} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PaymentMethodLogos({ type }: { type: IpayPaymentType }) {
  if (type === "mobile") {
    return (
      <span className="payment-brand-group payment-brand-group--mobile">
        <span className="payment-brand-logo payment-brand-logo--compact">
          <img alt="Airtel Money" src={airtelMoneyLogo} />
        </span>
        <span className="payment-brand-logo payment-brand-logo--compact">
          <img alt="Moov Money" src={moovMoneyLogo} />
        </span>
        <span className="payment-brand-logo payment-brand-logo--compact">
          <img alt="Zamani" src={zamaniLogo} />
        </span>
      </span>
    );
  }

  if (type === "nita_online") {
    return (
      <span className="payment-brand-group">
        <span className="payment-brand-logo payment-brand-logo--wide">
          <img alt="Nita" src={nitaLogo} />
        </span>
      </span>
    );
  }

  return (
    <span className="payment-brand-group">
      <span className="payment-brand-logo payment-brand-logo--wide">
        <img alt="Amana" src={amanaLogo} />
      </span>
    </span>
  );
}
