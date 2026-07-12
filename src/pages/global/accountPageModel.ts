import type { MainAccountRecord, MainAccountStatus } from "../../domain/auth";

export function accountStatusLabel(status: MainAccountStatus): string {
  const labels: Record<MainAccountStatus, string> = {
    active: "Actif",
    expired: "Expiré",
    suspended: "Suspendu",
    trial: "Essai"
  };

  return labels[status];
}

export function formatAccountDate(value: string | null): string {
  if (!value) {
    return "Non renseignée";
  }

  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

export function validateAccountDetails(input: Pick<MainAccountRecord, "companyName" | "displayName" | "phone">): string | null {
  if (!input.displayName.trim()) {
    return "Entrez le nom affiché.";
  }

  if (!input.companyName.trim()) {
    return "Entrez le nom de l'entreprise.";
  }

  if (input.phone.trim() && input.phone.trim().length < 6) {
    return "Entrez un téléphone valide.";
  }

  return null;
}

export function validatePasswordChange(input: {
  confirmPassword: string;
  newPassword: string;
  oldPassword: string;
}): string | null {
  if (!input.oldPassword.trim()) {
    return "Entrez l'ancien mot de passe.";
  }

  if (input.newPassword.length < 6) {
    return "Le nouveau mot de passe doit contenir au moins 6 caractères.";
  }

  if (input.newPassword !== input.confirmPassword) {
    return "Les deux nouveaux mots de passe ne correspondent pas.";
  }

  return null;
}
