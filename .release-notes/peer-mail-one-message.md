type: minor
---
Peer mail now uses one message shape. Remove `kind` from `send_mail` calls and use optional `replyTo` for threading and optional `evidenceRefs` for supporting material. Removed the published `PeerMailKind` type, `kind` fields from `PeerMailSendInput` and `PeerMailEnvelope`, and the `evidence-required` refusal. Delivery guards and coordination audit events remain in place.
