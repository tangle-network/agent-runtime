type: minor
---
A child's own time box (`budget.deadlineMs` on a spawn) is now a check-in, not a kill: at the deadline a steerable child is told to record its state and submit what it has, and keeps running while it makes progress; it is stopped only after 30 minutes without progress, by its budgets, by cancellation, or by the run's own deadline. `deadlineCheckIn: { idleMs }` sets the idle bound; `deadlineCheckIn: false` restores the stop at the time box. A child without an inbox is stopped at its time box as before.
