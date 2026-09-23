import { useState } from "react";
import { CheckCircle2, QrCode, Ticket } from "lucide-react";
import type { TicketDisplaySettings } from "../../services/tickets";
import { formatInternationalPhone, normalizeInternationalPhone } from "../../shared/phone";

export function TicketDisplaySettingsForm({
  companyName,
  dataLimitRequired = false,
  lockedCurrency,
  onChange,
  value
}: {
  companyName?: string | null;
  dataLimitRequired?: boolean;
  lockedCurrency?: string | null;
  onChange: (value: TicketDisplaySettings) => void;
  value: TicketDisplaySettings;
}) {
  const update = (partial: Partial<TicketDisplaySettings>) => onChange({ ...value, ...partial });
  const [contactTouched, setContactTouched] = useState(false);
  const contactValidation = normalizeInternationalPhone(value.contactNumber);
  const contactError = contactTouched && !contactValidation.ok ? contactValidation.message : null;

  return (
    <div className="ticket-settings-form">
      <section className="ticket-settings-section">
        <div className="ticket-settings-section__heading">
          <Ticket aria-hidden="true" />
          <div><h3>Identité du voucher</h3><p>Un seul titre sera affiché en haut du ticket.</p></div>
        </div>
        <div className="router-form-grid">
          <label className="form-field">
            Titre affiché
            <select
              value={value.titleMode}
              onChange={(event) => update({ titleMode: event.target.value as TicketDisplaySettings["titleMode"] })}
            >
              <option value="wifi">Nom du WiFi</option>
              <option value="company">Nom de l'entreprise{companyName ? ` - ${companyName}` : ""}</option>
              <option value="custom">Texte personnalisé</option>
            </select>
          </label>
          {value.titleMode === "custom" ? (
            <label className="form-field">
              Texte personnalisé
              <input
                maxLength={80}
                placeholder="Ex. WiFi Zone Nova"
                value={value.customTitle}
                onChange={(event) => update({ customTitle: event.target.value })}
              />
            </label>
          ) : null}
        </div>
        <div className="ticket-settings-toggles">
          <SettingToggle checked={value.showTicketNumber} label="Afficher le numéro du ticket #01" onChange={(showTicketNumber) => update({ showTicketNumber })} />
          <SettingToggle checked={value.showPlanName} label="Afficher le nom du forfait" onChange={(showPlanName) => update({ showPlanName })} />
        </div>
      </section>

      <section className="ticket-settings-section">
        <div className="ticket-settings-section__heading"><CheckCircle2 aria-hidden="true" /><div><h3>Informations commerciales</h3><p>Durée et validité restent toujours distinctes.</p></div></div>
        <div className="ticket-settings-toggles">
          <SettingToggle checked={value.showPrice} label="Afficher le prix" onChange={(showPrice) => update({ showPrice })} />
          <SettingToggle checked disabled label="Afficher la durée d'utilisation" onChange={() => undefined} />
          <SettingToggle checked disabled label="Afficher la durée de validité" onChange={() => undefined} />
          <SettingToggle
            checked={dataLimitRequired || value.showDataLimit}
            disabled={dataLimitRequired}
            label={dataLimitRequired ? "Volume de données obligatoire pour ce forfait" : "Afficher le volume de données"}
            onChange={(showDataLimit) => update({ showDataLimit })}
          />
        </div>
        <label className="form-field ticket-settings-short-field">
          Devise
          <input
            disabled={Boolean(lockedCurrency)}
            maxLength={12}
            value={lockedCurrency || value.currency}
            onChange={(event) => {
              if (!lockedCurrency) {
                update({ currency: event.target.value });
              }
            }}
          />
          {lockedCurrency ? (
            <small>Devise définie par le plan sélectionné. Modifiez ou dupliquez le plan pour la changer.</small>
          ) : null}
        </label>
      </section>

      <section className="ticket-settings-section">
        <div className="ticket-settings-section__heading"><QrCode aria-hidden="true" /><div><h3>Connexion et modèle</h3><p>Le QR contient uniquement le code du voucher.</p></div></div>
        <div className="ticket-template-grid" role="radiogroup" aria-label="Modèle du voucher">
          <button
            aria-pressed={!value.showQrCode}
            className={`ticket-template-card ${!value.showQrCode ? "ticket-template-card--selected" : ""}`}
            onClick={() => update({ showQrCode: false })}
            type="button"
          >
            <strong>Économique sans QR</strong><span>Modèle par défaut, noir et blanc.</span>
          </button>
          <button
            aria-pressed={value.showQrCode}
            className={`ticket-template-card ${value.showQrCode ? "ticket-template-card--selected" : ""}`}
            onClick={() => update({ showQrCode: true })}
            type="button"
          >
            <strong>Économique avec QR</strong><span>Le QR contient uniquement le numéro.</span>
          </button>
        </div>
        <div className="ticket-settings-toggles">
          <SettingToggle checked disabled label="Afficher le login" onChange={() => undefined} />
          <SettingToggle checked={value.showInstructions} label="Afficher le DNS / portail" onChange={(showInstructions) => update({ showInstructions })} />
        </div>
        <p className="ticket-settings-help">Le mot de passe apparaît automatiquement uniquement lorsqu'il est différent du login.</p>
      </section>

      <section className="ticket-settings-section">
        <div className="ticket-settings-section__heading"><CheckCircle2 aria-hidden="true" /><div><h3>Informations facultatives</h3><p>Ces éléments restent compacts pour conserver 40 tickets par page.</p></div></div>
        <div className="ticket-settings-toggles">
          <SettingToggle checked={value.showCreatedAt} label="Afficher la date et l'heure de création" onChange={(showCreatedAt) => update({ showCreatedAt })} />
          <SettingToggle checked={value.showNote} label="Afficher une note personnalisée" onChange={(showNote) => update({ showNote })} />
          <SettingToggle checked={value.showContact} label="Afficher un numéro de contact" onChange={(showContact) => update({ showContact })} />
          <SettingToggle checked={value.showPoweredBy} label="Afficher Propulsé par TicketPro" onChange={(showPoweredBy) => update({ showPoweredBy })} />
        </div>
        {value.showNote ? (
          <label className="form-field">
            Note
            <input maxLength={140} value={value.noteText} onChange={(event) => update({ noteText: event.target.value })} />
          </label>
        ) : null}
        {value.showContact ? (
          <label className="form-field ticket-settings-short-field">
            Numéro de contact
            <input
              aria-invalid={Boolean(contactError)}
              inputMode="tel"
              maxLength={32}
              placeholder="Ex. +227 88 99 99 00"
              value={value.contactNumber}
              onBlur={() => {
                setContactTouched(true);
                if (contactValidation.ok && contactValidation.value) {
                  update({ contactNumber: formatInternationalPhone(contactValidation.value) });
                }
              }}
              onChange={(event) => {
                setContactTouched(false);
                update({ contactNumber: event.target.value });
              }}
            />
            {contactError ? <small className="form-error">{contactError}</small> : (
              <small>
                Niger : 8 chiffres acceptés. Autres pays : commencez par + et l'indicatif. Laissez vide pour utiliser le numéro de Mon compte.
              </small>
            )}
          </label>
        ) : null}
      </section>
    </div>
  );
}

function SettingToggle({
  checked,
  disabled = false,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`toggle-option ${disabled ? "toggle-option--locked" : ""}`}>
      <input checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <CheckCircle2 aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
