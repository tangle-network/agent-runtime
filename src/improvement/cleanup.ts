export async function rethrowAfterCleanup(
  cause: unknown,
  cleanup: () => Promise<void>,
  context: string,
): Promise<never> {
  const cleanupErrors: unknown[] = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await cleanup()
    } catch (cleanupCause) {
      cleanupErrors.push(cleanupCause)
      continue
    }
    if (cleanupErrors.length === 0) throw cause
    throw new AggregateError([cause, ...cleanupErrors], `${context}; cleanup retry succeeded`)
  }
  throw new AggregateError([cause, ...cleanupErrors], `${context}; cleanup failed`)
}
