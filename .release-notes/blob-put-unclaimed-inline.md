type: patch
---
An unclaimed result-blob put runs inline again, as before 10.0.4; only a put under a run claim goes to the durable writer. In 10.0.4 every put waited on the writer, which delayed a fresh run's first spawn record.
