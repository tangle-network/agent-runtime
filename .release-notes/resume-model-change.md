type: minor
---
A resumed run can move its root to another model: `supervise({ ..., modelChange: { model, reasoningEffort?, reason } })` keeps the run id, recorded identity, coordination owner and settled children, and executes the recorded root profile with `model.default` (and `model.reasoningEffort`, when given) replaced. The spawn journal records one `model-changed` event, with the time and reason, whenever the model differs from the one the run last ran. Any other profile change still refuses as a resume identity mismatch, and a fresh run refuses `modelChange`.
