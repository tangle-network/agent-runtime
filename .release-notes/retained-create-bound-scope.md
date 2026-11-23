type: patch
---
A retained run's materialization bound now ends when `provider.create` settles. Before, its timeout signal reached providers that keep their create input for the environment's life, such as the CLI Bridge, and aborted every turn still running when the bound passed, 120 s after create by default (#2756).
