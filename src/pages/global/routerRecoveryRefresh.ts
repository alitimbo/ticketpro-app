/** Recovery is best-effort; SQLite remains readable during a cloud outage.
 * Always reread it because recovery can apply retirements before failing.
 */
export async function refreshRouterSnapshot<T, R>(
  recover: () => Promise<R>,
  readLocal: () => Promise<T>,
  onRecoveryError: (error: unknown) => void
): Promise<{ records: T; recovery: R | null; succeeded: boolean }> {
  let recovery: R | null = null;
  let succeeded = false;
  try {
    recovery = await recover();
    succeeded = true;
  } catch (error) {
    onRecoveryError(error);
  }
  return { records: await readLocal(), recovery, succeeded };
}
