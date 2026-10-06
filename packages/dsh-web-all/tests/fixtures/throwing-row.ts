/**
 * Family-row stand-in whose plugin body throws during start, exactly like a
 * real plugin that cannot acquire a resource its row depends on (the task
 * board's ledger lock, issue #1730). The shell must capture the throw, record
 * it, and keep its own fiber active.
 */
export function apply(): void {
  throw new Error('task-board ledger is already owned by process 4242')
}
