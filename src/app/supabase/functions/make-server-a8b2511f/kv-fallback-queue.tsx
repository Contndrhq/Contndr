/**
 * Fallback queue for KV operations when circuit breaker is open
 * 
 * When the database is under memory pressure and the circuit breaker trips,
 * critical operations are queued in-memory and processed once the circuit closes.
 * 
 * Non-critical operations (analytics, tracking) are simply logged and dropped
 * to prevent data loss while maintaining system availability.
 */

interface QueuedOperation {
  type: 'set' | 'mset' | 'del' | 'mdel';
  key?: string;
  keys?: string[];
  value?: any;
  values?: any[];
  timestamp: number;
  priority: 'critical' | 'normal' | 'low';
  category: string; // e.g., 'email_tracking', 'job_queue', 'compliance'
  retries: number;
}

// In-memory queue (will be lost on server restart, which is acceptable)
const _operationQueue: QueuedOperation[] = [];
const MAX_QUEUE_SIZE = 1000; // Prevent memory exhaustion
const MAX_OPERATION_AGE_MS = 5 * 60 * 1000; // 5 minutes
const PROCESSING_INTERVAL_MS = 10000; // Process queue every 10s
let _processingTimer: number | null = null;

// Statistics
let _queuedCount = 0;
let _processedCount = 0;
let _droppedCount = 0;

/**
 * Determine if an operation is critical and should be queued vs. logged and dropped
 */
function isCriticalOperation(category: string): boolean {
  const critical = [
    'job_queue',       // Retry logic is critical
    'compliance',      // Unsubscribes must be recorded
    'campaign_state',  // Campaign status tracking
    'sequence_state',  // Sequence enrollment state
  ];
  return critical.includes(category);
}

/**
 * Queue an operation for later processing when circuit closes
 */
export function queueOperation(
  type: QueuedOperation['type'],
  category: string,
  params: { key?: string; keys?: string[]; value?: any; values?: any[] }
) {
  // Drop non-critical operations immediately
  if (!isCriticalOperation(category)) {
    _droppedCount++;
    if (_droppedCount <= 10) {
      console.log(`[KV-FALLBACK] Dropping non-critical ${category} operation (type: ${type})`);
    }
    return;
  }

  // Check queue size limit
  if (_operationQueue.length >= MAX_QUEUE_SIZE) {
    // Remove oldest low-priority items first
    const lowPriorityIdx = _operationQueue.findIndex(op => op.priority === 'low');
    if (lowPriorityIdx !== -1) {
      _operationQueue.splice(lowPriorityIdx, 1);
      _droppedCount++;
    } else {
      // Queue full with only critical items - drop this one
      _droppedCount++;
      console.warn(`[KV-FALLBACK] Queue full (${MAX_QUEUE_SIZE}), dropping ${category} operation`);
      return;
    }
  }

  const operation: QueuedOperation = {
    type,
    ...params,
    timestamp: Date.now(),
    priority: isCriticalOperation(category) ? 'critical' : 'normal',
    category,
    retries: 0,
  };

  _operationQueue.push(operation);
  _queuedCount++;

  if (_queuedCount <= 5) {
    console.log(`[KV-FALLBACK] Queued ${category} operation (queue size: ${_operationQueue.length})`);
  }

  // Start background processor if not running
  startBackgroundProcessor();
}

/**
 * Process queued operations (called periodically when circuit might be closed)
 */
async function processQueue(kvModule: any) {
  if (_operationQueue.length === 0) return;

  const now = Date.now();
  const opsToProcess = [..._operationQueue];
  _operationQueue.length = 0; // Clear queue

  let successCount = 0;
  let failCount = 0;

  for (const op of opsToProcess) {
    // Drop operations that are too old
    if (now - op.timestamp > MAX_OPERATION_AGE_MS) {
      _droppedCount++;
      console.warn(`[KV-FALLBACK] Dropping stale operation from ${op.category} (age: ${Math.round((now - op.timestamp) / 1000)}s)`);
      continue;
    }

    try {
      // Execute the operation
      switch (op.type) {
        case 'set':
          await kvModule.set(op.key!, op.value);
          break;
        case 'mset':
          await kvModule.mset(op.keys!, op.values!);
          break;
        case 'del':
          await kvModule.del(op.key!);
          break;
        case 'mdel':
          await kvModule.mdel(op.keys!);
          break;
      }
      successCount++;
      _processedCount++;
    } catch (err: any) {
      // If still failing, re-queue with exponential backoff
      if (op.retries < 3) {
        op.retries++;
        _operationQueue.push(op);
      } else {
        failCount++;
        _droppedCount++;
        console.error(`[KV-FALLBACK] Failed to process ${op.category} operation after ${op.retries} retries:`, err.message);
      }
    }
  }

  if (successCount > 0 || failCount > 0) {
    console.log(`[KV-FALLBACK] Processed queue: ${successCount} success, ${failCount} failed, ${_operationQueue.length} remaining`);
  }
}

/**
 * Start background processor that attempts to drain queue periodically
 */
function startBackgroundProcessor() {
  if (_processingTimer !== null) return;

  _processingTimer = setInterval(async () => {
    // Only process if queue has items
    if (_operationQueue.length === 0) return;

    try {
      // Lazy import to avoid circular dependency
      const kvModule = await import('./kv-retry.tsx');
      await processQueue(kvModule);
    } catch (err: any) {
      // Circuit might still be open, will retry on next interval
      if (!err.message?.includes('circuit breaker')) {
        console.error('[KV-FALLBACK] Error processing queue:', err.message);
      }
    }
  }, PROCESSING_INTERVAL_MS) as any;
}

/**
 * Get queue statistics
 */
export function getQueueStats() {
  return {
    queueSize: _operationQueue.length,
    totalQueued: _queuedCount,
    totalProcessed: _processedCount,
    totalDropped: _droppedCount,
    oldestOperation: _operationQueue[0]?.timestamp 
      ? Date.now() - _operationQueue[0].timestamp 
      : 0,
  };
}

/**
 * Clear the queue (for testing or manual intervention)
 */
export function clearQueue() {
  const cleared = _operationQueue.length;
  _operationQueue.length = 0;
  console.log(`[KV-FALLBACK] Manually cleared ${cleared} queued operations`);
  return cleared;
}
