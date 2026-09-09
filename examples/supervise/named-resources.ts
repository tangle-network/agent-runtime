import {
  type Budget,
  createBudgetPool,
  spendFromUsageEvents,
} from '@tangle-network/agent-runtime/kernel'

// The executor supplies measured increments in caller-defined safe-integer units.
// Select fine units instead of reporting fractional seconds.
const budget: Budget = {
  maxTokens: 100,
  maxIterations: 2,
  resources: {
    accelerator: { unit: 'GPU-millisecond', limit: 10_000 },
    transfer: { unit: 'byte', limit: 1_000 },
  },
}
const pool = createBudgetPool(budget, 0)
const reservation = pool.reserve({
  ...budget,
  resources: {
    accelerator: { unit: 'GPU-millisecond', limit: 6_000 },
    transfer: { unit: 'byte', limit: 600 },
  },
})
if (!reservation.ok) throw new Error(reservation.reason)

pool.reconcile(
  reservation.ticket,
  spendFromUsageEvents([
    { kind: 'resource', name: 'accelerator', unit: 'GPU-millisecond', amount: 2_000, known: true },
    { kind: 'resource', name: 'transfer', unit: 'byte', amount: 400, known: true },
  ]),
)
console.log(pool.readout().resources)
// accelerator: remaining 8_000, committed 2_000; transfer: remaining 600, committed 400.
// Scope performs this reservation and reconciliation around each child automatically.
