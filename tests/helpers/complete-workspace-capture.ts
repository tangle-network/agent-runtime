import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentCandidateOutputArtifactPort } from '../../src/candidate-execution'
import { sha256Bytes } from '../../src/candidate-execution/digest'

/** Artifact bytes persist independently of either coordinator process. */
export function fileWorkspaceArtifacts(directory: string): AgentCandidateOutputArtifactPort {
  mkdirSync(directory, { recursive: true })
  return {
    async put({ bytes }) {
      const digest = sha256Bytes(bytes)
      writeFileSync(join(directory, digest.slice(7)), bytes)
      return {
        locator: { kind: 's3', bucket: 'retained-capture-test', key: digest.slice(7) },
        sha256: digest,
        byteLength: bytes.byteLength,
      }
    },
    async read(reference) {
      return Uint8Array.from(readFileSync(join(directory, reference.sha256.slice(7))))
    },
  }
}
