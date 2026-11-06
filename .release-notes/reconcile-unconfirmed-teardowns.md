type: patch
---
`reconcileUnconfirmedTeardowns` reads a settled run's unconfirmed environments by id and deletes only the ones the provider still holds. It returns confirmed, deleted, and unknown sets, and it refuses a live directory lock or a run with no settle record.
