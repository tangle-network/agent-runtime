type: patch
---
Keep the OTLP exporter usable after an empty idle flush and continue awaiting an existing in-flight batch when the waiting queue is empty. Treat an interrupted response body as unconfirmed delivery through the existing dropped-span accounting instead of substituting a successful empty acknowledgement. Public APIs, bounded queue behavior and retry policy are unchanged.
