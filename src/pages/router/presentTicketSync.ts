/** Present confirmed local state before waiting for cloud acknowledgement.
 * Publication stays awaited so existing outbox/retry and concurrency guards remain intact.
 */
export async function presentTicketSync<T>(
  persist: () => Promise<T>, present: (value: T) => void, publish: () => Promise<unknown>
): Promise<void> {
  const value = await persist();
  present(value);
  await publish();
}
