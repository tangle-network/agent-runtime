type: patch
---
A native session copy no longer waits for an admitted reference or a session id. A one-shot provider turn on the default turn mapping has neither, so every copy of such a turn was skipped and an aborted turn could still lose its whole session. The provider attributes the copy by the execution id it recorded when the stream started. A copy that finds no session file, because it was taken before attribution or after the box stopped answering, never replaces a copy that holds the session.
