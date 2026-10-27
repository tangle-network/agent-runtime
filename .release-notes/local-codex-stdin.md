type: patch
---

Deliver ordinary Codex local-harness prompts through its native stdin channel, avoiding operating-system single-argument limits without clipping profile instructions or task content. Preserve leading BOMs, blank-prompt behavior, stderr, cancellation and process-tree cleanup; report incomplete input delivery after reaping the child. Reproducible Codex retains its literal-argv prompt-evidence path because its native debug renderer has no stdin input surface.
