import { defineStrategy } from '@tangle-network/agent-runtime/loops'

export default defineStrategy('dualPersonaRefine', async ({ surface, task, budget, shot, critique, listTools }) => {
  let bestScore = 0
  let bestMessages = null
  let bestHandle = null
  const progression = []
  let totalCompletions = 0
  let shotsUsed = 0

  const runShot = async (handle, opts = {}) => {
    const result = await shot({ handle, ...opts })
    if (!result) return null
    totalCompletions += result.completions
    progression.push(result.score)
    shotsUsed++
    return result
  }

  // Helper to safely close a handle (idempotent)
  const safeClose = async (h) => {
    try { await surface.close(h) } catch (_) {}
  }

  try {
    // 1. First attempt with default persona (no explicit persona override)
    const handle1 = await surface.open(task)
    let res1 = await runShot(handle1)
    if (!res1) {
      await safeClose(handle1)
      return { score: bestScore, resolved: false, completions: totalCompletions, progression, shots: shotsUsed }
    }
    if (res1.score === 1) {
      await safeClose(handle1)
      return { score: 1, resolved: true, completions: totalCompletions, progression, shots: shotsUsed }
    }
    bestScore = res1.score
    bestMessages = res1.messages
    bestHandle = handle1

    // 2. Second attempt with a different, detail‑oriented persona, if budget permits
    if (shotsUsed < budget) {
      const handle2 = await surface.open(task)
      const res2 = await runShot(handle2, {
        persona: { systemPrompt: "You are a meticulous and thorough software engineer. Double-check every step, verify assumptions, and consider edge cases. Ensure all details are correct before delivering the final answer." }
      })
      if (res2) {
        if (res2.score === 1) {
          await safeClose(handle1)
          await safeClose(handle2)
          return { score: 1, resolved: true, completions: totalCompletions, progression, shots: shotsUsed }
        }
        if (res2.score > bestScore) {
          await safeClose(bestHandle)
          bestScore = res2.score
          bestMessages = res2.messages
          bestHandle = handle2
        } else {
          await safeClose(handle2)
        }
      } else {
        await safeClose(handle2)
      }
    }

    // 3. Refine the best artifact iteratively with critique‑driven steering
    while (shotsUsed < budget && bestScore < 1) {
      const steer = await critique(bestMessages)
      if (!steer) break // analyst declines to propose further improvement

      const res = await runShot(bestHandle, { messages: bestMessages, steer })
      if (!res) break

      bestScore = Math.max(bestScore, res.score)
      bestMessages = res.messages
    }

    await safeClose(bestHandle)
    return {
      score: bestScore,
      resolved: bestScore === 1,
      completions: totalCompletions,
      progression,
      shots: shotsUsed
    }
  } catch (e) {
    // Ensure any open artifact is closed on unexpected errors
    if (bestHandle) await safeClose(bestHandle)
    throw e
  }
})
