export function assertAccountProfileOwnership(
  accountId: string | null | undefined,
  internalProfileId: string | null | undefined
): { accountId: string; internalProfileId: string } {
  if (!accountId?.trim() || !internalProfileId?.trim()) {
    throw new Error("Le compte principal et le profil interne actifs sont requis.");
  }

  if (!internalProfileId.startsWith(`${accountId}:`)) {
    throw new Error("Le profil interne n'appartient pas au compte principal actif.");
  }

  return { accountId, internalProfileId };
}
