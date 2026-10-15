/**
 * The account owner refused an unsupported credential route before dispatch. This is the
 * provider SDK's machine contract, not an HTTP status, class-name guess, or prose match.
 */
export function isCredentialRefusal(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  try {
    return Object.getOwnPropertyDescriptor(error, 'code')?.value === 'model_credential_refused'
  } catch {
    return false
  }
}
