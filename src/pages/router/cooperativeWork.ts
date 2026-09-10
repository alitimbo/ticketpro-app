/** Bound IPC bursts and allow browser input/paint between chunks. */
export async function forEachCooperative<T>(items: T[], work: (item: T) => Promise<unknown>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += 8) {
    // Drain the entire chunk even if one item fails; never leave work floating.
    const results = await Promise.allSettled(items.slice(offset, offset + 8).map(work));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    if (offset + 8 < items.length) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}
