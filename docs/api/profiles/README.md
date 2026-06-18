[**@tangle-network/agent-runtime**](../README.md)

***

[@tangle-network/agent-runtime](../README.md) / profiles

# profiles

## Interfaces

- [CoderTask](interfaces/CoderTask.md)
- [InProcessUiAuditClientOptions](interfaces/InProcessUiAuditClientOptions.md)
- [BrowserHandle](interfaces/BrowserHandle.md)
- [BrowserContextHandle](interfaces/BrowserContextHandle.md)
- [PageHandle](interfaces/PageHandle.md)
- [UiJudgeTokenUsage](interfaces/UiJudgeTokenUsage.md)
- [UiJudgeInput](interfaces/UiJudgeInput.md)
- [UiJudgeOutput](interfaces/UiJudgeOutput.md)
- [UiAuditorProfileOptions](interfaces/UiAuditorProfileOptions.md)
- [UiFindingScreenshot](interfaces/UiFindingScreenshot.md)
- [UiFinding](interfaces/UiFinding.md)
- [UiAuditViewport](interfaces/UiAuditViewport.md)
- [UiAuditCaptureRequest](interfaces/UiAuditCaptureRequest.md)
- [UiAuditTask](interfaces/UiAuditTask.md)
- [UiAuditCapture](interfaces/UiAuditCapture.md)
- [UiAuditOutput](interfaces/UiAuditOutput.md)

## Type Aliases

- [UiJudge](type-aliases/UiJudge.md)
- [UiLens](type-aliases/UiLens.md)
- [UiFindingSeverity](type-aliases/UiFindingSeverity.md)

## Variables

- [DEFAULT\_CODER\_SYSTEM\_PROMPT](variables/DEFAULT_CODER_SYSTEM_PROMPT.md)
- [coderProfile](variables/coderProfile.md)
- [SHARED\_AUDITOR\_RULES](variables/SHARED_AUDITOR_RULES.md)
- [LENS\_BRIEFS](variables/LENS_BRIEFS.md)
- [UI\_LENSES](variables/UI_LENSES.md)
- [UI\_FINDING\_SEVERITIES](variables/UI_FINDING_SEVERITIES.md)

## Functions

- [coderTaskToPrompt](functions/coderTaskToPrompt.md)
- [createInProcessUiAuditClient](functions/createInProcessUiAuditClient.md)
- [buildAuditorSystemPrompt](functions/buildAuditorSystemPrompt.md)
- [parseAuditorEvents](functions/parseAuditorEvents.md)
- [uiAuditorProfile](functions/uiAuditorProfile.md)
- [encodeAuditTaskEnvelope](functions/encodeAuditTaskEnvelope.md)
- [decodeAuditTaskEnvelope](functions/decodeAuditTaskEnvelope.md)
- [formatAuditorPrompt](functions/formatAuditorPrompt.md)
- [createUiAuditorValidator](functions/createUiAuditorValidator.md)
