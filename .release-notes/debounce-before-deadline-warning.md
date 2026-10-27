type: patch
---
A manager's wake debounce now ends by its deadline warning, and a wake that falls due at the warning carries both its events and the deadline notice in one turn. Before, a worker that settled within the debounce of the warning pushed the manager's next turn past the deadline, so the run ended without that turn.
