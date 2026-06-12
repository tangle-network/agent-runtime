import { defineStrategy } from '@tangle-network/agent-runtime/loops'

export default defineStrategy('critiqueRefine', async ({ surface, task, budget, shot, critique, listTools }) => {
  let handle = await surface.open(task);
  let progression: number[] = [];
  let bestScore = 0;
  let calls = 0;

  try {
    // --- First attempt: careful persona, no steer -------------------------------------------------
    let shot1 = await shot({
      handle,
      persona: {
        systemPrompt:
          'You are a methodical and thorough agent. Plan your approach, gather all necessary information, verify your solution, and only finalize when you are confident.',
      },
    });
    calls++;

    // Handle infra failure of first shot
    if (shot1 === null) {
      // try one more time with a different persona if budget permits
      if (calls < budget) {
        shot1 = await shot({
          handle,
          persona: {
            systemPrompt:
              'You are a persistent problem‑solver. Attempt the task carefully, step by step.',
          },
        });
        calls++;
      }
    }

    if (shot1 !== null) {
      progression.push(shot1.score);
      bestScore = shot1.score;
    } else {
      // both attempts infra‑failed – push 0 and return
      progression.push(0);
      bestScore = 0;
    }

    // If already perfect, we are done
    if (bestScore === 1) {
      return {
        score: 1,
        resolved: true,
        completions: calls,
        progression,
        shots: progression.length,
      };
    }

    // --- Critique + second shot, only if we have budget left ----------------------------------------
    // We need at least 2 more operations (critique + replacement shot)
    if (calls + 2 <= budget && shot1 && bestScore < 1) {
      const instruction = await critique(shot1.messages);
      calls++;

      if (instruction) {
        const shot2 = await shot({
          handle,
          messages: shot1.messages,
          steer: instruction,
          persona: {
            systemPrompt:
              'You are a diligent engineer. Your task is to fix the issues. Implement the corrective instruction and complete the goal.',
          },
        });
        calls++;

        if (shot2) {
          progression.push(shot2.score);
          bestScore = Math.max(bestScore, shot2.score);
        } else {
          // infra failure – push 0, but we still keep previous best
          progression.push(0);
        }
      }
      // if instruction is null, critic deems it complete – keep bestScore as is
    }

    // If budget still allows one more shot (e.g., first shot null, no critique done, extra chance)
    // We won't over‑engineer here; the above covers the primary refinement path.
  } finally {
    await surface.close(handle);
  }

  return {
    score: bestScore,
    resolved: bestScore === 1,
    completions: calls,
    progression,
    shots: progression.length,
  };
});
