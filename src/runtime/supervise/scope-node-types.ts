/** Lifecycle states shared by scope and live-progress contracts. */
export type NodeStatus =
  | 'pending'
  | 'acquiring'
  | 'running'
  | 'waiting'
  | 'done'
  | 'failed'
  | 'cancelled'
