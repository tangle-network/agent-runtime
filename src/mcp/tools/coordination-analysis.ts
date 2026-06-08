import type { LoopFindingInput } from '../../runtime'
import type { LoopPacketAnalyzer, LoopPacketMessage, LoopQuestionInput } from './coordination-types'

export function composeLoopPacketAnalyzers(
  ...analyzers: ReadonlyArray<LoopPacketAnalyzer | undefined>
): LoopPacketAnalyzer {
  return async (input) => {
    const findings: LoopFindingInput[] = []
    const questions: LoopQuestionInput[] = []
    const messages: LoopPacketMessage[] = []
    for (const analyzer of analyzers) {
      const next = await analyzer?.(input)
      if (!next) continue
      findings.push(...(next.findings ?? []))
      questions.push(...(next.questions ?? []))
      messages.push(...(next.messages ?? []))
    }
    return findings.length || questions.length || messages.length
      ? { findings, questions, messages }
      : undefined
  }
}
