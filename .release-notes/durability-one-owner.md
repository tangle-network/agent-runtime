type: minor
---
Durability now has one owner per job, documented in `docs/durability.md`.

Removed, after an org-wide search found no consumers:
- From the root: the `ConversationJournal` family (`ConversationJournal`, `ConversationJournalEntry`, `FileConversationJournal`, `InMemoryConversationJournal`, `SqlConversationJournal`), the `runConversation({ journal })` option and the `conversation_resumed` event. `runConversation` is now in-process only. Durable chat turns belong to Agent App's turn store; durable supervised work belongs to `supervise` with `runDir` or `createFencedSqlRunContext`.
- From `./kernel`: the single-writer `SqlSpawnJournal`, `SqlResultBlobStore` and `SqlStatements`. Use `createFencedSqlRunContext` for shared SQL.
- From `./kernel`: the run-directory layout helpers `CONTINUATIONS_DIR`, `workerInteractiveBindingFile`, `workerInteractiveBindingsDir`, `workerInteractiveAdmissionFile`, `readWorkerInteractiveAdmissions`, `DEFAULT_WAKE_DEBOUNCE_MS`, `DEFAULT_WAKE_HEARTBEAT_MS` and `composeContinuationNote`.
- From `./durable`: `FAILURE_RECORD_FILE`, `SETTLE_RECORD_FILE`, `RUN_DIRECTORY_LOCK_FILE`, `REVIEW_DIR`, `PURSUIT_OBSERVER_DELIVERY_PATH`, `FORK_PARENT_UNCERTAIN_NODES_KEY`, `pursuitVersionsLedgerPath`, `settleRecordJson`, `deliverPursuitObserver` and `createFileObserverHooks`.

`SqlAdapter` and `d1ToSqlAdapter` keep their root exports.

`recoverRetainedRun`'s `recovered` outcome now carries `via: 'reattached' | 'resumed'`. `reattached` means the provider self-identified the original session. `resumed` means a pre-create intent was replayed through the exact create and dispatch.
