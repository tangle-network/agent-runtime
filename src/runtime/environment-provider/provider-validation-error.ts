// Keep this file loadable from the lean `./environment-provider` export without agent-eval installed.
export class ValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ValidationError'
  }
}
