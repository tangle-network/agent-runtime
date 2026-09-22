import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export function commandAuthorization(capabilityToken: string, digest: string): string {
  return createHmac('sha256', capabilityToken).update(digest).digest('hex')
}

function commandKeyMaterial(capabilityToken: string): Buffer {
  return createHash('sha256')
    .update('agent-runtime-supervisor-control\u0000')
    .update(capabilityToken)
    .digest()
}

export function encryptCommandPayload(
  payload: Record<string, unknown>,
  capabilityToken: string,
): string {
  let plaintext: string
  try {
    plaintext = JSON.stringify(payload)
  } catch (error) {
    throw new Error('supervisor control payload must be JSON-serializable', { cause: error })
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', commandKeyMaterial(capabilityToken), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, ciphertext, tag].map((part) => part.toString('base64url')).join('.')
}

export function decryptCommandPayload(value: string, capabilityToken: string): unknown {
  const parts = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return undefined
  const [iv, ciphertext, tag] = parts
  if (iv === undefined || ciphertext === undefined || tag === undefined) return undefined
  try {
    const decipher = createDecipheriv('aes-256-gcm', commandKeyMaterial(capabilityToken), iv)
    decipher.setAuthTag(tag)
    return JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
    )
  } catch {
    return undefined
  }
}

export function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export function capabilityDigest(capabilityToken: string): string {
  return createHash('sha256')
    .update('agent-runtime-supervisor-control-capability\u0000')
    .update(capabilityToken)
    .digest('base64url')
}
