import { CheckCircle2 } from "lucide-react";
import type { IpayPaymentType } from "../../services/payments";

const paymentMethods: Array<{
  description: string;
  label: string;
  type: IpayPaymentType;
}> = [
  {
    description: "Orange Money, Moov Money et Zamani Cash",
    label: "Mobile Money",
    type: "mobile"
  },
  {
    description: "Paiement depuis votre compte MyNita",
    label: "MyNita",
    type: "nita_online"
  },
  {
    description: "Paiement depuis votre compte Amanata",
    label: "Amanata",
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
      <span className="payment-brand-group" aria-label="Orange Money, Moov Money et Zamani Cash">
        <span className="payment-brand payment-brand--orange" title="Orange Money">
          <span>orange</span>
        </span>
        <span className="payment-brand payment-brand--moov" title="Moov Money">
          <span>moov</span>
        </span>
        <span className="payment-brand payment-brand--zamani" title="Zamani Cash">
          <span>Z</span>
        </span>
      </span>
    );
  }

  if (type === "nita_online") {
    return (
      <span className="payment-brand-group" aria-label="MyNita">
        <span className="payment-brand payment-brand--mynita" title="MyNita">
          <span>MyNita</span>
        </span>
      </span>
    );
  }

  return (
    <span className="payment-brand-group" aria-label="Amanata">
      <span className="payment-brand payment-brand--amanata" title="Amanata">
        <span>A</span>
      </span>
    </span>
  );
}
