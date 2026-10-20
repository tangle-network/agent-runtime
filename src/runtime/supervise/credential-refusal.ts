import { causeChain } from './error-message'

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

/**
 * The message prefix of agent-provider-tangle's generic credential command failure. The provider
 * exports no type or constant for it, so the kernel credential test raises it through the
 * provider's own command resolver and fails when the message drifts.
 */
const CREDENTIAL_COMMAND_FAILURE = 'Tangle credential command failed ('

/**
 * The exit code of agent-provider-tangle's credential command (`acct sandbox resolve`) in the
 * error or its causes, or undefined.
 *
 * The provider reports the command's generic failure as `Tangle credential command failed
 * (exit N)` with the process's `exitCode` and `terminationSignal` as own fields; a refusal it can
 * parse (exit 75 or 78) arrives typed instead and is classified on its code. Before any dispatch
 * this failure ran nothing, and counting it as an unresolved pending invocation stopped 10 nodes
 * and lost 7 runs between 2026-10-12 and 2026-10-19 (test-acceptance-canary-20261015c met 26 in
 * 2.2 minutes). It pauses like a capacity refusal, bounded by the deadline, the budget and
 * cancellation as every pause is.
 */
export function credentialCommandExit(error: unknown): number | undefined {
  for (const link of causeChain(error)) {
    try {
      if (
        !(link instanceof Error) ||
        !link.message.startsWith(CREDENTIAL_COMMAND_FAILURE) ||
        !Object.hasOwn(link, 'terminationSignal')
      )
        continue
      const exitCode: unknown = Reflect.get(link, 'exitCode')
      if (typeof exitCode === 'number' && Number.isInteger(exitCode) && exitCode > 0)
        return exitCode
    } catch {
      // A cause whose fields cannot be read is not the credential command's failure.
    }
  }
  return undefined
}
