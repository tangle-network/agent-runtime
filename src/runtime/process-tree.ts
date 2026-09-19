import type { ChildProcess } from 'node:child_process'

const processKillGraceMs = 250
const processGroupExitConfirmMs = 1_000
const processGroupExitPollMs = 10

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return
    }
  }
  try {
    child.kill(signal)
  } catch {
    // The process may have exited between the timer and signal delivery.
  }
}

/** Terminate one owned process group and confirm its disappearance; detached sessions are outside it. */
export async function terminateProcessTreeAndConfirm(
  child: ChildProcess,
  leaderClosed: () => boolean,
  context = 'runLocalHarness',
): Promise<void> {
  signalProcessTree(child, 'SIGTERM')
  if (process.platform === 'win32' || typeof child.pid !== 'number') {
    const graceDeadline = Date.now() + processKillGraceMs
    while (!leaderClosed() && Date.now() < graceDeadline) {
      await delayUntilNextProcessCheck(graceDeadline)
    }
    if (!leaderClosed()) signalProcessTree(child, 'SIGKILL')
    return
  }
  const processGroupId = child.pid
  const graceDeadline = Date.now() + processKillGraceMs
  if (await waitForProcessGroupExit(processGroupId, graceDeadline)) return

  signalProcessTree(child, 'SIGKILL')
  const killDeadline = Date.now() + processGroupExitConfirmMs
  if (await waitForProcessGroupExit(processGroupId, killDeadline)) return
  throw new Error(`${context}: process group ${processGroupId} survived SIGKILL`)
}

async function waitForProcessGroupExit(processGroupId: number, deadline: number): Promise<boolean> {
  while (processGroupExists(processGroupId)) {
    if (Date.now() >= deadline) return false
    await delayUntilNextProcessCheck(deadline)
  }
  return true
}

async function delayUntilNextProcessCheck(deadline: number): Promise<void> {
  const delayMs = Math.min(processGroupExitPollMs, Math.max(0, deadline - Date.now()))
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return false
    return true
  }
}
