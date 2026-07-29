import {
  decryptLocalSecret,
  encryptLocalSecret,
  isEncryptedLocalSecret
} from "../security/localSecrets";

export type TicketPasswordReference = {
  passwordSecretRef: string;
  username: string;
};

export async function protectTicketPassword(password: string): Promise<string> {
  if (!password.trim()) {
    throw new Error("Le mot de passe du voucher ne peut pas être vide.");
  }
  return encryptLocalSecret(password);
}

export async function resolveTicketPasswordValue(ticket: TicketPasswordReference): Promise<string> {
  if (ticket.passwordSecretRef.endsWith(`/${ticket.username}/password`)) {
    return ticket.username;
  }

  if (isEncryptedLocalSecret(ticket.passwordSecretRef)) {
    return decryptLocalSecret(ticket.passwordSecretRef);
  }

  throw new Error("Le mot de passe de ce voucher n'est pas disponible sur cet appareil.");
}
