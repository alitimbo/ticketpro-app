import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordFieldProps = {
  autoComplete?: string;
  disabled?: boolean;
  label: string;
  name?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
};

export function PasswordField({
  autoComplete = "current-password",
  disabled = false,
  label,
  name,
  onChange,
  placeholder,
  value
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const Icon = isVisible ? EyeOff : Eye;

  return (
    <label className="form-field">
      {label}
      <span className="password-field">
        <input
          autoComplete={autoComplete}
          disabled={disabled}
          name={name}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={isVisible ? "text" : "password"}
          value={value}
        />
        <button
          aria-label={isVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          disabled={disabled}
          onClick={() => setIsVisible((current) => !current)}
          type="button"
        >
          <Icon aria-hidden="true" />
        </button>
      </span>
    </label>
  );
}
