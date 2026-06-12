import { defineStrategy } from '@tangle-network/agent-runtime/loops'

export default defineStrategy('exploreCritiqueEngineer', async ({ surface, task, budget, shot, critique, listTools }) => {
  const handle = await surface.open(task)

  let bestScore = 0
  let resolved = false
  let totalCompletions = 0
  let shotsUsed = 0
  const progression: number[] = []

  try {
    // 1. Research shot – explores without making changes
    const researchShot = await shot({
      handle,
      persona: {
        systemPrompt:
          'You are a thorough researcher. Explore the task, gather information, read files, understand the problem, but do NOT make any modifications. Leave the artifact unchanged.'
      }
    })

    if (researchShot) {
      shotsUsed++
      totalCompletions += researchShot.completions
      bestScore = Math.max(bestScore, researchShot.score)
      progression.push(bestScore)

      if (bestScore >= 1) {
        resolved = true
        return { score: bestScore, resolved, completions: totalCompletions, progression, shots: shotsUsed }
      }

      // 2. Critique – obtain a corrective instruction from the research trace
      const instruction = await critique(researchShot.messages)

      // 3. Engineer shot – executes the solution, optionally guided by the critique
      const engineerShot = await shot({
        handle,
        messages: researchShot.messages,
        steer: instruction ?? undefined,
        persona: {
          systemPrompt:
            'You are an expert implementation engineer. Based on the research above, implement the solution now, making any necessary changes.'
        }
      })

      if (engineerShot) {
        shotsUsed++
        totalCompletions += engineerShot.completions
        bestScore = Math.max(bestScore, engineerShot.score)
        progression.push(bestScore)
        resolved = bestScore >= 1
      }
    }
  } finally {
    await surface.close(handle)
  }

  return { score: bestScore, resolved, completions: totalCompletions, progression, shots: shotsUsed }
})
