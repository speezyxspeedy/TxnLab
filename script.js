/* ==========================================================================
   TxnLab — Database Transaction & Concurrency Simulator
   Vanilla ES6+ JavaScript | Zero External Dependencies

   Architecture:
     1. Domain Constants, Isolation Specs, Built-in Scenarios, Documentation
     2. Concurrency Controller (LockManager, WaitForGraph)
     3. Simulation Engine (DatabaseState, SimulationEngine)
     4. Analysis Engine (SerializabilityAnalyzer, AnomalyDetector)
     5. Built-In Self-Test Runner (SelfTestRunner)
     6. Persistence Layer (StorageManager via localStorage)
     7. SVG Visualization Renderers (Timeline, Wait-For, Precedence Graphs)
     8. UI Controller (TxnLabUI)
   ========================================================================== */

'use strict';

/* ==========================================================================
   1. DOMAIN CONSTANTS, ISOLATION SPECS, BUILT-IN SCENARIOS & DOCUMENTATION
   ========================================================================== */

const ISOLATION_SPECS = {
  READ_UNCOMMITTED: {
    id: 'READ_UNCOMMITTED',
    label: 'READ UNCOMMITTED',
    shortDesc: 'Reads may see uncommitted writes; no shared read locks.',
    readsAllowed: 'Reads return the latest uncommitted write from any active transaction (or the committed value if no uncommitted write exists).',
    readsPrevented: 'None for ordinary reads. Concurrent writes to the same key are still serialized via Exclusive (X) locks.',
    lockBehavior: 'READ acquires no Shared (S) lock. WRITE acquires an Exclusive (X) lock and holds it until COMMIT or ROLLBACK.',
    anomaliesPossible: ['Dirty Read', 'Non-Repeatable Read', 'Lost Update', 'Serialization Conflict', 'Phantom Read (real DBMS)'],
    limitations: 'In this teaching model, writers still take X locks to prevent simultaneous corrupted writes. Real engines (e.g., PostgreSQL) treat READ UNCOMMITTED identically to READ COMMITTED.',
    matrix: {
      dirtyRead: 'Possible',
      nonRepeatableRead: 'Possible',
      lostUpdate: 'Possible',
      phantomRead: 'Possible',
      locking: 'No S locks on read; X locks held until end of txn',
      concurrency: 'Highest (reads never block)'
    },
    recommendedScenario: 'dirty-read'
  },
  READ_COMMITTED: {
    id: 'READ_COMMITTED',
    label: 'READ COMMITTED',
    shortDesc: 'Reads only committed data; short-lived shared read locks.',
    readsAllowed: 'Reads access only committed values (plus the transaction\'s own uncommitted writes).',
    readsPrevented: 'Prevents dirty reads by requiring a Shared (S) lock before reading, which waits if another transaction holds an Exclusive (X) lock.',
    lockBehavior: 'READ acquires a Shared (S) lock and releases it immediately after that individual read completes. WRITE acquires an Exclusive (X) lock until COMMIT or ROLLBACK.',
    anomaliesPossible: ['Non-Repeatable Read', 'Lost Update', 'Serialization Conflict', 'Phantom Read (real DBMS)'],
    limitations: 'Many modern DBMS engines (PostgreSQL, MySQL InnoDB, Oracle) implement READ COMMITTED using MVCC statement snapshots so readers do not block writers. TxnLab models the classic lock-based variant.',
    matrix: {
      dirtyRead: 'Prevented',
      nonRepeatableRead: 'Possible',
      lostUpdate: 'Possible',
      phantomRead: 'Possible',
      locking: 'Short S lock per read (released immediately); X locks held until commit/abort',
      concurrency: 'High (reads block only active writers)'
    },
    recommendedScenario: 'non-repeatable-read'
  },
  REPEATABLE_READ: {
    id: 'REPEATABLE_READ',
    label: 'REPEATABLE READ',
    shortDesc: 'Shared and exclusive locks held until transaction completion.',
    readsAllowed: 'Reads access committed values (plus own uncommitted writes) and lock read keys against concurrent updates.',
    readsPrevented: 'Prevents dirty reads and non-repeatable reads on already-read keys by retaining S locks until transaction completion.',
    lockBehavior: 'READ acquires a Shared (S) lock retained until COMMIT or ROLLBACK. WRITE acquires an Exclusive (X) lock (upgrading an own S lock if no other transaction shares it) retained until completion.',
    anomaliesPossible: ['Phantom Read (not modeled in key-value scope)', 'Lock-Upgrade Deadlocks'],
    limitations: 'Phantom reads (range queries seeing newly inserted rows) vary significantly across real engines (InnoDB uses next-key gap locks; PostgreSQL uses MVCC snapshot isolation) and are not modeled in this single-key simulator.',
    matrix: {
      dirtyRead: 'Prevented',
      nonRepeatableRead: 'Prevented',
      lostUpdate: 'Prevented (blocks or deadlocks on upgrade)',
      phantomRead: 'Possible (varies by DBMS)',
      locking: 'S and X locks both held until commit/abort',
      concurrency: 'Moderate (long-lived read locks increase contention)'
    },
    recommendedScenario: 'shared-vs-exclusive'
  },
  SERIALIZABLE: {
    id: 'SERIALIZABLE',
    label: 'SERIALIZABLE',
    shortDesc: 'Strict Two-Phase Locking (Strict 2PL) teaching semantics.',
    readsAllowed: 'Reads access committed values (plus own uncommitted writes) while holding Shared (S) locks until transaction completion.',
    readsPrevented: 'Prevents dirty reads, non-repeatable reads, lost updates, and non-conflict-serializable interleavings among committed transactions.',
    lockBehavior: 'Strict Two-Phase Locking: all S and X locks are acquired prior to accessing a key and released only upon COMMIT or ROLLBACK. Conflicting operations wait (and may form deadlocks resolved by aborting a victim).',
    anomaliesPossible: ['None in committed schedule (deadlocks may force transaction aborts)'],
    limitations: 'Strict 2PL is one way to enforce serializability. Real DBMS engines may use Serializable Snapshot Isolation (SSI in PostgreSQL), predicate locking, or optimistic concurrency control instead.',
    matrix: {
      dirtyRead: 'Prevented',
      nonRepeatableRead: 'Prevented',
      lostUpdate: 'Prevented',
      phantomRead: 'Prevented (conceptual; key-level in TxnLab)',
      locking: 'Strict 2PL: all S and X locks retained until commit/abort',
      concurrency: 'Lowest (strictest blocking and higher deadlock risk)'
    },
    recommendedScenario: 'non-serializable'
  }
};

const BUILTIN_SCENARIOS = [
  {
    id: 'dirty-read',
    name: 'Dirty Read Demonstration',
    category: 'Anomaly',
    isolationLevel: 'READ_UNCOMMITTED',
    description: 'T1 updates key A without committing, T2 reads that uncommitted value under READ UNCOMMITTED, and then T1 rolls back.',
    initialDb: { A: 100, B: 200 },
    transactions: [
      {
        id: 'T1',
        operations: [
          { type: 'WRITE', key: 'A', value: 150 },
          { type: 'ROLLBACK' }
        ]
      },
      {
        id: 'T2',
        operations: [
          { type: 'READ', key: 'A' },
          { type: 'COMMIT' }
        ]
      }
    ]
  },
  {
    id: 'non-repeatable-read',
    name: 'Non-Repeatable Read',
    category: 'Anomaly',
    isolationLevel: 'READ_COMMITTED',
    description: 'Under READ COMMITTED, T1 reads A twice while T2 commits a new value for A between the two reads, causing T1 to observe two different committed values.',
    initialDb: { A: 100, B: 200 },
    transactions: [
      {
        id: 'T1',
        operations: [
          { type: 'READ', key: 'A' },
          { type: 'READ', key: 'A' },
          { type: 'COMMIT' }
        ]
      },
      {
        id: 'T2',
        operations: [
          { type: 'WRITE', key: 'A', value: 250 },
          { type: 'COMMIT' }
        ]
      }
    ]
  },
  {
    id: 'lost-update',
    name: 'Lost Update',
    category: 'Anomaly',
    isolationLevel: 'READ_COMMITTED',
    description: 'Both T1 and T2 read the same initial balance A=100 under READ COMMITTED. T1 writes 150 and commits, then T2 writes 200 based on the stale read, overwriting T1\'s update.',
    initialDb: { A: 100, B: 200 },
    transactions: [
      {
        id: 'T1',
        operations: [
          { type: 'READ', key: 'A' },
          { type: 'WRITE', key: 'A', value: 150 },
          { type: 'COMMIT' }
        ]
      },
      {
        id: 'T2',
        operations: [
          { type: 'READ', key: 'A' },
          { type: 'WRITE', key: 'A', value: 200 },
          { type: 'COMMIT' }
        ]
      }
    ]
  },
  {
    id: 'shared-vs-exclusive',
    name: 'Shared Lock vs Exclusive Lock',
    category: 'Locking',
    isolationLevel: 'REPEATABLE_READ',
    description: 'T1 and T2 concurrently acquire compatible Shared (S) locks on A, blocking T3\'s Exclusive (X) write request until both readers release their locks.',
    initialDb: { A: 100, B: 200 },
    transactions: [
      {
        id: 'T1',
        operations: [
          { type: 'READ', key: 'A' },
          { type: 'READ', key: 'B' },
          { type: 'COMMIT' }
        ]
      },
      {
        id: 'T2',
        operations: [
          { type: 'READ', key: 'A' },
          { type: 'COMMIT' }
        ]
      },
      {
        id: 'T3',
        operations: [
          { type: 'WRITE', key: 'A', value: 300 },
          { type: 'COMMIT' }
        ]
      }
    ]
  },
  {
    id: 'deadlock-demo',
    name: 'Deadlock Demonstration',
    category: 'Deadlock',
    isolationLevel: 'REPEATABLE_READ',
    description: 'T1 locks A then requests B, while T2 locks B then requests A. The Wait-For Graph detects the T1 → T2 → T1 cycle and allows manual victim recovery.',
    initialDb: { A: 100, B: 200 },
    transactions: [
      {
        id: 'T1',
        operations: [
          { type: 'WRITE', key: 'A', value: 120 },
          { type: 'WRITE', key: 'B', value: 220 },
          { type: 'COMMIT' }
        ]
      },
      {
        id: 'T2',
        operations: [
          { type: 'WRITE', key: 'B', value: 280 },
          { type: 'WRITE', key: 'A', value: 180 },
          { type: 'COMMIT' }
        ]
      }
    ]
  },
  {
    id: 'non-serializable',
    name: 'Serializable vs Non-Serializable Schedule',
    category: 'Serializability',
    isolationLevel: 'READ_COMMITTED',
    description: 'Under READ COMMITTED, T1 and T2 interleave reads and writes across A and B, forming a conflict cycle T1 → T2 → T1. Switch to SERIALIZABLE and re-run to observe Strict 2PL blocking.',
    initialDb: { A: 100, B: 200 },
    transactions: [
      {
        id: 'T1',
        operations: [
          { type: 'READ', key: 'A' },
          { type: 'WRITE', key: 'B', value: 210 },
          { type: 'COMMIT' }
        ]
      },
      {
        id: 'T2',
        operations: [
          { type: 'READ', key: 'B' },
          { type: 'WRITE', key: 'A', value: 110 },
          { type: 'COMMIT' }
        ]
      }
    ]
  },
  {
    id: 'serializable-acyclic',
    name: 'Conflict-Serializable Pipeline (Acyclic)',
    category: 'Serializability',
    isolationLevel: 'REPEATABLE_READ',
    description: 'Three transactions transfer data across A, B, and C without cycles, producing an acyclic precedence graph with a valid topological serial order.',
    initialDb: { A: 100, B: 200, C: 50 },
    transactions: [
      {
        id: 'T1',
        operations: [
          { type: 'READ', key: 'A' },
          { type: 'WRITE', key: 'A', value: 125 },
          { type: 'COMMIT' }
        ]
      },
      {
        id: 'T2',
        operations: [
          { type: 'READ', key: 'B' },
          { type: 'WRITE', key: 'A', value: 140 },
          { type: 'COMMIT' }
        ]
      },
      {
        id: 'T3',
        operations: [
          { type: 'READ', key: 'C' },
          { type: 'WRITE', key: 'B', value: 260 },
          { type: 'COMMIT' }
        ]
      }
    ]
  }
];

const DOCUMENTATION_TOPICS = [
  {
    id: 'transactions',
    title: 'Database Transactions',
    keywords: 'transaction begin commit rollback atomic unit work',
    body: 'A database transaction is a logical unit of work consisting of one or more read and write operations. A transaction ends either by committing (making all of its writes visible and durable) or by rolling back / aborting (discarding all of its uncommitted writes).',
    example: 'T1: READ(A) -> WRITE(A, 150) -> WRITE(B, 250) -> COMMIT\nIf any step fails before COMMIT, ROLLBACK leaves both A and B unchanged.',
    scenarioId: null
  },
  {
    id: 'acid',
    title: 'ACID Properties',
    keywords: 'atomicity consistency isolation durability acid',
    body: 'ACID defines four classic guarantees for reliable transactions: Atomicity (all operations succeed or none take effect), Consistency (valid database state transitions), Isolation (concurrent transactions behave as though isolated according to the chosen isolation level), and Durability (committed writes survive failures). TxnLab focuses primarily on Atomicity and Isolation.',
    example: 'Atomicity: ROLLBACK removes T1\'s uncommitted write buffer.\nIsolation: Locks and read visibility rules govern what T2 can observe while T1 is active.',
    scenarioId: null
  },
  {
    id: 'concurrency-control',
    title: 'Concurrency Control',
    keywords: 'concurrency scheduler interleaving throughput correctness',
    body: 'Running transactions strictly one after another guarantees correctness but wastes I/O and CPU capacity. Concurrency control protocols interleave operations from multiple transactions while preventing data corruption and anomalies through locking (pessimistic), timestamps, or validation (optimistic).',
    example: 'Interleaved schedule:\nStep 1: T1 READ(A) | Step 2: T2 READ(B) | Step 3: T1 WRITE(A, 120) | Step 4: T2 WRITE(B, 220)',
    scenarioId: 'serializable-acyclic'
  },
  {
    id: 'locks',
    title: 'Shared (S) and Exclusive (X) Locks',
    keywords: 'shared exclusive lock compatibility matrix s-lock x-lock blocking',
    body: 'A Shared (S) lock allows multiple transactions to read the same resource simultaneously. An Exclusive (X) lock grants sole access for writing and conflicts with both S and X locks held by other transactions. When a requested lock conflicts with an existing holder, the requester waits in a queue until conflicting locks are released.',
    example: 'S + S -> Compatible (T1 and T2 read A concurrently)\nS + X -> Conflict (T3 waits until T1 and T2 release S(A))\nX + X -> Conflict (only one writer on A at a time)',
    scenarioId: 'shared-vs-exclusive'
  },
  {
    id: 'isolation-levels',
    title: 'Isolation Levels',
    keywords: 'read uncommitted read committed repeatable read serializable sql standard mvcc',
    body: 'SQL defines four isolation levels trading concurrency against protection from anomalies: READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, and SERIALIZABLE. Note that real database engines implement these using different mechanisms (such as MVCC snapshots in PostgreSQL/InnoDB vs. lock-based 2PL modeled in TxnLab).',
    example: 'Weakest -> Strongest:\nREAD UNCOMMITTED < READ COMMITTED < REPEATABLE READ < SERIALIZABLE',
    scenarioId: 'non-repeatable-read'
  },
  {
    id: 'dirty-reads',
    title: 'Dirty Reads',
    keywords: 'dirty read uncommitted rollback anomaly',
    body: 'A dirty read occurs when transaction T2 reads a value modified by transaction T1 before T1 commits. If T1 subsequently rolls back, T2 has acted on data that never officially existed in the committed database state.',
    example: 'Step 1: T1 WRITE(A, 150) [uncommitted]\nStep 2: T2 READ(A) -> observes 150 (Dirty Read)\nStep 3: T1 ROLLBACK -> A remains 100',
    scenarioId: 'dirty-read'
  },
  {
    id: 'non-repeatable-reads',
    title: 'Non-Repeatable Reads',
    keywords: 'non repeatable read fuzzy read committed update',
    body: 'A non-repeatable read occurs when the same transaction reads the same key twice and receives two different committed values because another transaction updated and committed that key between the two reads.',
    example: 'Step 1: T1 READ(A) -> 100\nStep 2: T2 WRITE(A, 250) & COMMIT\nStep 3: T1 READ(A) -> 250 (differs from first read)',
    scenarioId: 'non-repeatable-read'
  },
  {
    id: 'lost-updates',
    title: 'Lost Updates',
    keywords: 'lost update stale read overwrite write skew',
    body: 'A lost update happens when two transactions read the same initial value and then both write new values computed from that stale read. The second write blindly overwrites the first transaction\'s committed update.',
    example: 'Step 1: T1 READ(A) -> 100  |  Step 2: T2 READ(A) -> 100\nStep 3: T1 WRITE(A, 150) & COMMIT\nStep 4: T2 WRITE(A, 200) & COMMIT (T1\'s update is lost)',
    scenarioId: 'lost-update'
  },
  {
    id: 'deadlocks',
    title: 'Deadlocks & Wait-For Graphs',
    keywords: 'deadlock cycle wait-for graph dfs victim abort recovery',
    body: 'A deadlock occurs when two or more transactions wait indefinitely for locks held by one another in a circular dependency. A Wait-For Graph represents transactions as nodes and waiting dependencies as directed edges (Ti -> Tj). Detecting a cycle via DFS confirms a deadlock, which is resolved by aborting a victim transaction to release its locks.',
    example: 'T1 holds X(A), waits for X(B) held by T2 (T1 -> T2)\nT2 holds X(B), waits for X(A) held by T1 (T2 -> T1)\nCycle: T1 -> T2 -> T1',
    scenarioId: 'deadlock-demo'
  },
  {
    id: 'conflict-serializability',
    title: 'Conflict Serializability',
    keywords: 'conflict serializability precedence graph rw wr ww cycle topological sort',
    body: 'Two operations from different transactions conflict if they access the same resource and at least one is a WRITE (RW, WR, or WW). Drawing a directed edge Ti -> Tj whenever Ti executes an earlier conflicting operation than Tj creates a Precedence Graph. A schedule is Conflict Serializable if and only if this graph is acyclic; any topological ordering gives an equivalent serial schedule.',
    example: 'T1 READ(A) before T2 WRITE(A) => edge T1 -> T2 (RW on A)\nT2 READ(B) before T1 WRITE(B) => edge T2 -> T1 (RW on B)\nCycle T1 -> T2 -> T1 => Not Conflict Serializable',
    scenarioId: 'non-serializable'
  },
  {
    id: 'strict-2pl',
    title: 'Strict Two-Phase Locking (Strict 2PL)',
    keywords: 'strict 2pl two phase locking growing shrinking cascading abort',
    body: 'Under Two-Phase Locking (2PL), a transaction acquires all needed locks during a growing phase and releases them during a shrinking phase. Strict 2PL holds all exclusive locks (and in TxnLab\'s SERIALIZABLE mode, shared locks as well) until COMMIT or ROLLBACK, preventing cascading aborts and guaranteeing conflict-serializable committed schedules.',
    example: 'Growing phase: acquire S(A), X(B) as operations execute.\nCommit/Abort point: release all locks atomically and wake waiting transactions.',
    scenarioId: 'non-serializable'
  }
];

/* ==========================================================================
   2. CONCURRENCY CONTROLLER (LockManager & WaitForGraph)
   Pure logic — zero DOM dependencies.
   ========================================================================== */

class LockManager {
  constructor() {
    this.reset();
  }

  reset() {
    /** @type {Map<string, { holders: Map<string, 'S'|'X'>, waitQueue: Array<object> }>} */
    this.resources = new Map();
    /** @type {Array<object>} */
    this.lockEvents = [];
  }

  static isCompatible(heldMode, requestedMode) {
    return heldMode === 'S' && requestedMode === 'S';
  }

  _ensureResource(key) {
    if (!this.resources.has(key)) {
      this.resources.set(key, {
        holders: new Map(),
        waitQueue: []
      });
    }
    return this.resources.get(key);
  }

  _logEvent(event) {
    this.lockEvents.push(event);
  }

  getHeldLocksForTx(txId) {
    const held = [];
    for (const [resource, state] of this.resources.entries()) {
      if (state.holders.has(txId)) {
        held.push({ resource, mode: state.holders.get(txId) });
      }
    }
    return held;
  }

  /**
   * Request a Shared ('S') or Exclusive ('X') lock on resource `key` for `txId`.
   */
  requestLock(txId, key, mode, step, opLabel) {
    const res = this._ensureResource(key);
    const existingOwnMode = res.holders.get(txId);

    // Already holds sufficient lock
    if (existingOwnMode === 'X' || (existingOwnMode === 'S' && mode === 'S')) {
      return { granted: true, alreadyHeld: true, upgraded: false, blockedBy: [] };
    }

    // Find conflicting locks held by OTHER transactions
    const conflicts = [];
    for (const [holderId, holderMode] of res.holders.entries()) {
      if (holderId === txId) continue;
      if (!LockManager.isCompatible(holderMode, mode)) {
        conflicts.push({ txId: holderId, mode: holderMode });
      }
    }

    if (conflicts.length === 0) {
      const upgraded = existingOwnMode === 'S' && mode === 'X';
      res.holders.set(txId, mode);
      res.waitQueue = res.waitQueue.filter((w) => w.txId !== txId);
      this._logEvent({
        step,
        txId,
        resource: key,
        action: upgraded ? 'UPGRADE' : 'ACQUIRE',
        mode,
        detail: upgraded
          ? `${txId} upgraded S(${key}) to X(${key})`
          : `${txId} acquired ${mode}(${key})`
      });
      return { granted: true, alreadyHeld: false, upgraded, blockedBy: [] };
    }

    // Conflict detected — add to waiting queue if not already present
    const existingWait = res.waitQueue.find((w) => w.txId === txId);
    if (!existingWait) {
      res.waitQueue.push({
        txId,
        mode,
        opLabel,
        requestedAtStep: step
      });
    } else {
      existingWait.mode = mode;
      existingWait.opLabel = opLabel;
    }

    const holderDesc = conflicts.map((c) => `${c.txId} (${c.mode})`).join(', ');
    const reason =
      existingOwnMode === 'S' && mode === 'X'
        ? `${txId} cannot upgrade S(${key}) to X(${key}) because ${holderDesc} also holds a conflicting lock on ${key}.`
        : `${txId} requested ${mode}(${key}) but is blocked by ${holderDesc} on ${key}.`;

    this._logEvent({
      step,
      txId,
      resource: key,
      action: 'BLOCKED',
      mode,
      detail: reason
    });

    return {
      granted: false,
      alreadyHeld: false,
      upgraded: false,
      blockedBy: conflicts,
      reason
    };
  }

  /**
   * Release a short-lived S lock on a single resource (used by READ COMMITTED).
   * Does not release if the transaction holds an X lock on that key.
   */
  releaseSharedLock(txId, key, step) {
    const res = this.resources.get(key);
    if (!res) return [];
    if (res.holders.get(txId) !== 'S') return [];

    res.holders.delete(txId);
    this._logEvent({
      step,
      txId,
      resource: key,
      action: 'RELEASE',
      mode: 'S',
      detail: `${txId} released short-lived S(${key}) after read`
    });
    return this._processWaitQueueForKey(key, step);
  }

  /**
   * Release all locks held by `txId` and remove `txId` from any waiting queues.
   * Retries eligible waiting transactions and returns newly unblocked tx details.
   */
  releaseAllLocks(txId, step, reasonLabel = 'completion') {
    const touchedKeys = new Set();

    for (const [key, res] of this.resources.entries()) {
      if (res.holders.has(txId)) {
        const mode = res.holders.get(txId);
        res.holders.delete(txId);
        touchedKeys.add(key);
        this._logEvent({
          step,
          txId,
          resource: key,
          action: 'RELEASE',
          mode,
          detail: `${txId} released ${mode}(${key}) on ${reasonLabel}`
        });
      }
      const prevLen = res.waitQueue.length;
      res.waitQueue = res.waitQueue.filter((w) => w.txId !== txId);
      if (res.waitQueue.length !== prevLen) {
        touchedKeys.add(key);
      }
    }

    const unblocked = [];
    for (const key of touchedKeys) {
      const woke = this._processWaitQueueForKey(key, step);
      unblocked.push(...woke);
    }
    return unblocked;
  }

  /**
   * Evaluates queued lock requests for `key` in FIFO order.
   * Grants compatible locks immediately so waiting transactions resume without starvation.
   */
  _processWaitQueueForKey(key, step) {
    const res = this.resources.get(key);
    if (!res || res.waitQueue.length === 0) return [];

    const unblocked = [];
    const remaining = [];

    for (const req of res.waitQueue) {
      const conflicts = [];
      for (const [holderId, holderMode] of res.holders.entries()) {
        if (holderId === req.txId) continue;
        if (!LockManager.isCompatible(holderMode, req.mode)) {
          conflicts.push({ txId: holderId, mode: holderMode });
        }
      }

      if (conflicts.length === 0) {
        const prevMode = res.holders.get(req.txId);
        const upgraded = prevMode === 'S' && req.mode === 'X';
        res.holders.set(req.txId, req.mode);
        const detail = upgraded
          ? `${req.txId} unblocked and upgraded S(${key}) to X(${key})`
          : `${req.txId} unblocked and granted ${req.mode}(${key})`;

        this._logEvent({
          step,
          txId: req.txId,
          resource: key,
          action: 'UNBLOCK',
          mode: req.mode,
          detail
        });
        unblocked.push({
          txId: req.txId,
          resource: key,
          mode: req.mode,
          upgraded,
          detail
        });
      } else {
        remaining.push(req);
      }
    }

    res.waitQueue = remaining;
    return unblocked;
  }

  /**
   * Returns current conflicting holders for a waiting transaction on a resource.
   */
  getCurrentBlockersFor(txId, key, requestedMode) {
    const res = this.resources.get(key);
    if (!res) return [];
    const blockers = [];
    for (const [holderId, holderMode] of res.holders.entries()) {
      if (holderId === txId) continue;
      if (!LockManager.isCompatible(holderMode, requestedMode)) {
        blockers.push({ txId: holderId, mode: holderMode });
      }
    }
    return blockers;
  }

  getLockTableRows() {
    const rows = [];
    const sortedKeys = [...this.resources.keys()].sort();
    for (const key of sortedKeys) {
      const res = this.resources.get(key);
      if (res.holders.size === 0 && res.waitQueue.length === 0) continue;

      const owners = [...res.holders.entries()].map(([txId, mode]) => ({ txId, mode }));
      const lockTypes = [...new Set(owners.map((o) => o.mode))];
      const waiting = res.waitQueue.map((w) => ({
        txId: w.txId,
        mode: w.mode,
        opLabel: w.opLabel,
        requestedAtStep: w.requestedAtStep
      }));

      rows.push({
        resource: key,
        lockType: lockTypes.length > 0 ? lockTypes.join(' / ') : 'NONE',
        owners,
        waiting
      });
    }
    return rows;
  }

  getActiveLockCount() {
    let count = 0;
    for (const res of this.resources.values()) {
      count += res.holders.size;
    }
    return count;
  }
}

class WaitForGraph {
  /**
   * Build Wait-For Graph directly from active lock manager wait queues and holders,
   * and run deterministic DFS cycle detection.
   */
  static analyze(lockManager, transactions) {
    const nodes = transactions
      .filter((t) => t.state === 'ACTIVE' || t.state === 'BLOCKED')
      .map((t) => t.id);

    const edges = [];
    const edgeKeySet = new Set();

    for (const [resource, resState] of lockManager.resources.entries()) {
      for (const waitReq of resState.waitQueue) {
        for (const [holderId, holderMode] of resState.holders.entries()) {
          if (holderId === waitReq.txId) continue;
          if (!LockManager.isCompatible(holderMode, waitReq.mode)) {
            const dedupKey = `${waitReq.txId}->${holderId}:${resource}:${waitReq.mode}`;
            if (!edgeKeySet.has(dedupKey)) {
              edgeKeySet.add(dedupKey);
              edges.push({
                from: waitReq.txId,
                to: holderId,
                resource,
                requestedMode: waitReq.mode,
                heldMode: holderMode,
                opLabel: waitReq.opLabel
              });
            }
          }
        }
      }
    }

    // Build adjacency list
    const adj = new Map();
    for (const n of nodes) adj.set(n, []);
    for (const e of edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      if (!adj.has(e.to)) adj.set(e.to, []);
      adj.get(e.from).push(e);
    }

    const allNodes = [...adj.keys()].sort();
    const color = new Map(); // 0 = WHITE, 1 = GRAY, 2 = BLACK
    for (const n of allNodes) color.set(n, 0);

    const stack = [];
    const edgeStack = [];
    const cycles = [];
    const seenCycleSignatures = new Set();

    const dfs = (u) => {
      color.set(u, 1);
      stack.push(u);

      const outgoing = adj.get(u) || [];
      for (const edge of outgoing) {
        const v = edge.to;
        const c = color.get(v) || 0;
        if (c === 1) {
          const idx = stack.indexOf(v);
          if (idx !== -1) {
            const cycleNodes = [...stack.slice(idx), v];
            const cycleEdges = [...edgeStack.slice(idx), edge];
            const canonical = [...cycleNodes.slice(0, -1)].sort().join(',');
            if (!seenCycleSignatures.has(canonical)) {
              seenCycleSignatures.add(canonical);
              cycles.push({ nodes: cycleNodes, edges: cycleEdges });
            }
          }
        } else if (c === 0) {
          edgeStack.push(edge);
          dfs(v);
          edgeStack.pop();
        }
      }

      stack.pop();
      color.set(u, 2);
    };

    for (const n of allNodes) {
      if (color.get(n) === 0) {
        dfs(n);
      }
    }

    const cycleNodeSet = new Set();
    const cycleEdgeSet = new Set();
    for (const cyc of cycles) {
      cyc.nodes.forEach((n) => cycleNodeSet.add(n));
      cyc.edges.forEach((e) => cycleEdgeSet.add(`${e.from}->${e.to}`));
    }

    return {
      hasDeadlock: cycles.length > 0,
      nodes: allNodes,
      edges,
      cycles,
      cycleNodeSet,
      cycleEdgeSet
    };
  }
}

/* ==========================================================================
   3. SIMULATION ENGINE (DatabaseState & SimulationEngine)
   Pure logic — completely decoupled from DOM rendering.
   ========================================================================== */

class DatabaseState {
  constructor(initialValues = { A: 100, B: 200 }) {
    this.initialValues = { ...initialValues };
    this.reset();
  }

  reset(newInitialValues = null) {
    if (newInitialValues) {
      this.initialValues = { ...newInitialValues };
    }
    /** @type {Map<string, object>} */
    this.records = new Map();
    for (const [key, val] of Object.entries(this.initialValues)) {
      this.records.set(key, {
        key,
        committedValue: val,
        lastCommittedBy: 'INIT',
        lastCommittedStep: 0,
        uncommittedWrites: [],
        versionHistory: [
          {
            version: 0,
            value: val,
            txId: 'INIT',
            status: 'INITIAL',
            step: 0
          }
        ]
      });
    }
  }

  getKeys() {
    return [...this.records.keys()].sort();
  }

  hasKey(key) {
    return this.records.has(key);
  }

  addKey(key, initialValue) {
    const cleanKey = String(key).trim().toUpperCase();
    if (!cleanKey || !/^[A-Z0-9_]{1,16}$/.test(cleanKey)) {
      throw new Error('Key name must be 1–16 uppercase letters, digits, or underscores.');
    }
    this.initialValues[cleanKey] = initialValue;
    this.reset();
    return cleanKey;
  }

  setInitialValue(key, value) {
    if (!(key in this.initialValues)) {
      throw new Error(`Database key "${key}" does not exist.`);
    }
    this.initialValues[key] = value;
    this.reset();
  }

  /**
   * Read a key according to read visibility rules.
   * - Own uncommitted write is always visible to the writing transaction.
   * - If `allowDirty` is true (READ UNCOMMITTED), another transaction's latest uncommitted write is visible.
   * - Otherwise, returns the committed value.
   */
  read(key, txId, allowDirty) {
    const rec = this.records.get(key);
    if (!rec) {
      throw new Error(`Key "${key}" does not exist in database.`);
    }

    // Check transaction's own uncommitted write first
    for (let i = rec.uncommittedWrites.length - 1; i >= 0; i--) {
      if (rec.uncommittedWrites[i].txId === txId) {
        const own = rec.uncommittedWrites[i];
        return {
          value: own.value,
          sourceTx: txId,
          isDirty: false,
          isOwnWrite: true,
          sourceStep: own.step
        };
      }
    }

    // If READ UNCOMMITTED, check latest uncommitted write from any other transaction
    if (allowDirty && rec.uncommittedWrites.length > 0) {
      const latest = rec.uncommittedWrites[rec.uncommittedWrites.length - 1];
      return {
        value: latest.value,
        sourceTx: latest.txId,
        isDirty: true,
        isOwnWrite: false,
        sourceStep: latest.step
      };
    }

    return {
      value: rec.committedValue,
      sourceTx: rec.lastCommittedBy,
      isDirty: false,
      isOwnWrite: false,
      sourceStep: rec.lastCommittedStep
    };
  }

  /**
   * Stage an uncommitted write owned by `txId`. Does not mutate committedValue.
   */
  write(key, value, txId, step) {
    const rec = this.records.get(key);
    if (!rec) {
      throw new Error(`Key "${key}" does not exist in database.`);
    }
    const prevValue = rec.committedValue;
    // Update existing uncommitted entry for txId or push new one
    const existingIdx = rec.uncommittedWrites.findIndex((u) => u.txId === txId);
    const entry = { txId, value, step, prevValue };
    if (existingIdx >= 0) {
      rec.uncommittedWrites[existingIdx] = entry;
    } else {
      rec.uncommittedWrites.push(entry);
    }

    rec.versionHistory.push({
      version: rec.versionHistory.length,
      value,
      txId,
      status: 'UNCOMMITTED',
      step
    });
    return { key, value, prevValue };
  }

  /**
   * Publish all uncommitted writes owned by `txId` to committed state.
   */
  commit(txId, step) {
    const published = [];
    for (const rec of this.records.values()) {
      const ownEntries = rec.uncommittedWrites.filter((u) => u.txId === txId);
      if (ownEntries.length > 0) {
        const latest = ownEntries[ownEntries.length - 1];
        rec.committedValue = latest.value;
        rec.lastCommittedBy = txId;
        rec.lastCommittedStep = step;
        rec.uncommittedWrites = rec.uncommittedWrites.filter((u) => u.txId !== txId);
        rec.versionHistory.push({
          version: rec.versionHistory.length,
          value: latest.value,
          txId,
          status: 'COMMITTED',
          step
        });
        published.push({ key: rec.key, value: latest.value });
      }
    }
    return published;
  }

  /**
   * Discard all uncommitted writes owned by `txId`, keeping committed values intact.
   */
  rollback(txId, step) {
    const discarded = [];
    for (const rec of this.records.values()) {
      const ownEntries = rec.uncommittedWrites.filter((u) => u.txId === txId);
      if (ownEntries.length > 0) {
        const latest = ownEntries[ownEntries.length - 1];
        rec.uncommittedWrites = rec.uncommittedWrites.filter((u) => u.txId !== txId);
        rec.versionHistory.push({
          version: rec.versionHistory.length,
          value: rec.committedValue,
          txId,
          status: 'ROLLED_BACK',
          step,
          discardedValue: latest.value
        });
        discarded.push({ key: rec.key, discardedValue: latest.value, restoredValue: rec.committedValue });
      }
    }
    return discarded;
  }

  getSnapshot() {
    return this.getKeys().map((key) => {
      const r = this.records.get(key);
      return {
        key: r.key,
        initialValue: this.initialValues[r.key],
        committedValue: r.committedValue,
        lastCommittedBy: r.lastCommittedBy,
        lastCommittedStep: r.lastCommittedStep,
        uncommittedWrites: r.uncommittedWrites.map((u) => ({ ...u })),
        versionHistory: r.versionHistory.map((v) => ({ ...v }))
      };
    });
  }
}

class SimulationEngine {
  constructor() {
    this.isolationLevel = 'READ_COMMITTED';
    this.schedulingMode = 'round-robin'; // 'round-robin' | 'manual'
    this.activeScenarioName = 'Custom Schedule';
    this.db = new DatabaseState({ A: 100, B: 200 });
    this.lockManager = new LockManager();

    /** @type {Array<object>} */
    this.transactionDefs = [];
    /** @type {Array<object>} */
    this.transactions = [];
    /** @type {Array<object>} */
    this.executionHistory = [];

    this.stepCount = 0;
    this.rrPointer = 0;
    this._opIdCounter = 1;
  }

  static formatOp(op) {
    if (!op) return '';
    if (op.type === 'READ') return `READ(${op.key})`;
    if (op.type === 'WRITE') return `WRITE(${op.key}, ${op.value})`;
    return op.type;
  }

  static parseValue(raw) {
    const trimmed = String(raw).trim();
    if (trimmed === '') {
      throw new Error('Write value cannot be empty.');
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
    return trimmed;
  }

  _nextOpId() {
    return `op_${this._opIdCounter++}`;
  }

  /**
   * Load a full scenario (initialDb, isolationLevel, transaction definitions) and cleanly reset state.
   */
  loadScenario(scenario) {
    if (!scenario || !Array.isArray(scenario.transactions)) {
      throw new Error('Invalid scenario definition.');
    }
    this.activeScenarioName = scenario.name || 'Custom Scenario';
    this.isolationLevel = ISOLATION_SPECS[scenario.isolationLevel]
      ? scenario.isolationLevel
      : 'READ_COMMITTED';
    this.db = new DatabaseState(scenario.initialDb || { A: 100, B: 200 });

    this.transactionDefs = scenario.transactions.map((t) => ({
      id: t.id,
      operations: (t.operations || []).map((op) => ({
        id: this._nextOpId(),
        type: op.type,
        key: op.key,
        value: op.value
      }))
    }));

    this.reset();
  }

  /**
   * Restore engine to step 0 using current transactionDefs and initialDb.
   */
  reset() {
    this.db.reset();
    this.lockManager.reset();
    this.stepCount = 0;
    this.rrPointer = 0;
    this.executionHistory = [];

    this.transactions = this.transactionDefs.map((def) => ({
      id: def.id,
      operations: def.operations.map((op) => ({ ...op })),
      pc: 0,
      state: 'ACTIVE', // 'ACTIVE' | 'BLOCKED' | 'COMMITTED' | 'ABORTED'
      readSet: [],
      writeSet: [],
      startStep: null,
      endStep: null,
      blockedInfo: null
    }));
  }

  setIsolationLevel(level) {
    if (!ISOLATION_SPECS[level]) {
      throw new Error(`Unsupported isolation level: ${level}`);
    }
    this.isolationLevel = level;
    this.reset();
  }

  setSchedulingMode(mode) {
    if (mode !== 'round-robin' && mode !== 'manual') {
      throw new Error(`Invalid scheduling mode: ${mode}`);
    }
    this.schedulingMode = mode;
  }

  addTransaction() {
    if (this.stepCount > 0) {
      throw new Error('Reset the simulation before adding a new transaction.');
    }
    const existingNums = this.transactionDefs
      .map((t) => parseInt(t.id.replace(/^T/, ''), 10))
      .filter((n) => !Number.isNaN(n));
    const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    const newId = `T${nextNum}`;
    const firstKey = this.db.getKeys()[0] || 'A';

    this.transactionDefs.push({
      id: newId,
      operations: [
        { id: this._nextOpId(), type: 'READ', key: firstKey },
        { id: this._nextOpId(), type: 'COMMIT' }
      ]
    });
    this.activeScenarioName = 'Custom Schedule';
    this.reset();
    return newId;
  }

  removeTransaction(txId) {
    if (this.stepCount > 0) {
      throw new Error('Reset the simulation before removing a transaction.');
    }
    this.transactionDefs = this.transactionDefs.filter((t) => t.id !== txId);
    this.activeScenarioName = 'Custom Schedule';
    this.reset();
  }

  addOperation(txId, opInput) {
    if (this.stepCount > 0) {
      throw new Error('Reset the simulation before editing transaction operations.');
    }
    const def = this.transactionDefs.find((t) => t.id === txId);
    if (!def) throw new Error(`Transaction ${txId} not found.`);

    const type = opInput.type;
    if (!['READ', 'WRITE', 'COMMIT', 'ROLLBACK'].includes(type)) {
      throw new Error(`Invalid operation type: ${type}`);
    }

    const op = { id: this._nextOpId(), type };
    if (type === 'READ' || type === 'WRITE') {
      if (!opInput.key || !this.db.hasKey(opInput.key)) {
        throw new Error(`Select a valid database key for ${type}.`);
      }
      op.key = opInput.key;
    }
    if (type === 'WRITE') {
      op.value = SimulationEngine.parseValue(opInput.value);
    }

    const terminalIdx = def.operations.findIndex(
      (o) => o.type === 'COMMIT' || o.type === 'ROLLBACK'
    );

    if (type === 'COMMIT' || type === 'ROLLBACK') {
      if (terminalIdx !== -1) {
        // Replace existing terminal operation
        def.operations[terminalIdx] = op;
      } else {
        def.operations.push(op);
      }
    } else if (terminalIdx !== -1) {
      // Insert READ/WRITE right before terminal COMMIT/ROLLBACK
      def.operations.splice(terminalIdx, 0, op);
    } else {
      def.operations.push(op);
    }

    this.activeScenarioName = 'Custom Schedule';
    this.reset();
    return op;
  }

  updateOperation(txId, opIndex, updated) {
    if (this.stepCount > 0) {
      throw new Error('Reset the simulation before editing operations.');
    }
    const def = this.transactionDefs.find((t) => t.id === txId);
    if (!def || !def.operations[opIndex]) throw new Error('Operation not found.');

    const nextOp = { ...def.operations[opIndex] };
    if (updated.type) nextOp.type = updated.type;
    if (nextOp.type === 'READ' || nextOp.type === 'WRITE') {
      if (!updated.key || !this.db.hasKey(updated.key)) {
        throw new Error('Select a valid database key.');
      }
      nextOp.key = updated.key;
    } else {
      delete nextOp.key;
    }

    if (nextOp.type === 'WRITE') {
      nextOp.value = SimulationEngine.parseValue(updated.value);
    } else {
      delete nextOp.value;
    }

    // Prevent placing COMMIT/ROLLBACK before remaining ops
    if ((nextOp.type === 'COMMIT' || nextOp.type === 'ROLLBACK') && opIndex < def.operations.length - 1) {
      throw new Error('COMMIT or ROLLBACK must be the final operation in a transaction.');
    }

    def.operations[opIndex] = nextOp;
    this.activeScenarioName = 'Custom Schedule';
    this.reset();
  }

  removeOperation(txId, opIndex) {
    if (this.stepCount > 0) {
      throw new Error('Reset the simulation before removing operations.');
    }
    const def = this.transactionDefs.find((t) => t.id === txId);
    if (!def) throw new Error(`Transaction ${txId} not found.`);
    def.operations.splice(opIndex, 1);
    this.activeScenarioName = 'Custom Schedule';
    this.reset();
  }

  reorderOperation(txId, opIndex, direction) {
    if (this.stepCount > 0) {
      throw new Error('Reorder operations before starting a simulation.');
    }
    const def = this.transactionDefs.find((t) => t.id === txId);
    if (!def) throw new Error(`Transaction ${txId} not found.`);
    const targetIdx = opIndex + direction;
    if (targetIdx < 0 || targetIdx >= def.operations.length) return;

    const movingOp = def.operations[opIndex];
    const swapOp = def.operations[targetIdx];
    if (
      movingOp.type === 'COMMIT' ||
      movingOp.type === 'ROLLBACK' ||
      swapOp.type === 'COMMIT' ||
      swapOp.type === 'ROLLBACK'
    ) {
      throw new Error('COMMIT and ROLLBACK must remain at the end of the transaction.');
    }

    [def.operations[opIndex], def.operations[targetIdx]] = [swapOp, movingOp];
    this.activeScenarioName = 'Custom Schedule';
    this.reset();
  }

  addDatabaseKey(key, initialValue) {
    const parsedVal = SimulationEngine.parseValue(initialValue);
    const createdKey = this.db.addKey(key, parsedVal);
    this.activeScenarioName = 'Custom Schedule';
    this.reset();
    return createdKey;
  }

  updateDatabaseInitialValue(key, rawValue) {
    if (this.stepCount > 0) {
      throw new Error('Reset the simulation before editing initial database values.');
    }
    const parsedVal = SimulationEngine.parseValue(rawValue);
    this.db.setInitialValue(key, parsedVal);
    this.reset();
  }

  getEligibleTransactions() {
    return this.transactions.filter(
      (t) => t.state === 'ACTIVE' && t.pc < t.operations.length
    );
  }

  isCompleted() {
    if (this.transactions.length === 0) return false;
    return this.transactions.every(
      (t) => t.state === 'COMMITTED' || t.state === 'ABORTED' || t.pc >= t.operations.length
    );
  }

  getDeadlockState() {
    return WaitForGraph.analyze(this.lockManager, this.transactions);
  }

  getStatusSummary() {
    if (this.transactions.length === 0) return { code: 'READY', label: 'No Transactions' };
    const deadlock = this.getDeadlockState();
    if (deadlock.hasDeadlock) return { code: 'DEADLOCK', label: 'Deadlock' };
    if (this.isCompleted()) return { code: 'COMPLETED', label: 'Completed' };
    const eligible = this.getEligibleTransactions();
    const blockedCount = this.transactions.filter((t) => t.state === 'BLOCKED').length;
    if (eligible.length === 0 && blockedCount > 0) return { code: 'BLOCKED', label: 'All Blocked' };
    if (this.stepCount === 0) return { code: 'READY', label: 'Ready' };
    if (blockedCount > 0) return { code: 'BLOCKED', label: `Active (${blockedCount} Blocked)` };
    return { code: 'RUNNING', label: 'In Progress' };
  }

  /**
   * Synchronize blocked transaction metadata after lock releases.
   */
  _applyUnblockedTransactions(unblockedList, step) {
    for (const item of unblockedList) {
      const tx = this.transactions.find((t) => t.id === item.txId);
      if (tx && tx.state === 'BLOCKED') {
        tx.state = 'ACTIVE';
        tx.blockedInfo = null;
      }
    }
    // Refresh blocker lists for any still-blocked transactions
    for (const tx of this.transactions) {
      if (tx.state === 'BLOCKED' && tx.blockedInfo) {
        const currentBlockers = this.lockManager.getCurrentBlockersFor(
          tx.id,
          tx.blockedInfo.resource,
          tx.blockedInfo.requestedMode
        );
        if (currentBlockers.length > 0) {
          tx.blockedInfo.blockedBy = currentBlockers;
          const desc = currentBlockers.map((b) => `${b.txId} (${b.mode})`).join(', ');
          tx.blockedInfo.reason = `${tx.id} waiting for ${tx.blockedInfo.requestedMode}(${tx.blockedInfo.resource}) held by ${desc}.`;
        }
      }
    }
    return unblockedList;
  }

  /**
   * Execute the next operation for the next eligible transaction in round-robin order.
   */
  stepNext() {
    const eligible = this.getEligibleTransactions();
    if (eligible.length === 0) {
      const deadlock = this.getDeadlockState();
      if (deadlock.hasDeadlock) {
        return {
          ok: false,
          deadlock: true,
          message: 'Simulation halted: Deadlock detected. Abort a victim transaction to recover.'
        };
      }
      if (this.isCompleted()) {
        return {
          ok: false,
          completed: true,
          message: 'All transactions have completed.'
        };
      }
      return {
        ok: false,
        message: 'No eligible transaction available to step.'
      };
    }

    const total = this.transactions.length;
    for (let offset = 0; offset < total; offset++) {
      const idx = (this.rrPointer + offset) % total;
      const candidate = this.transactions[idx];
      if (candidate.state === 'ACTIVE' && candidate.pc < candidate.operations.length) {
        this.rrPointer = (idx + 1) % total;
        return this.stepTransaction(candidate.id);
      }
    }
    return { ok: false, message: 'No eligible transaction found.' };
  }

  /**
   * Execute the next operation of a specific transaction `txId`.
   */
  stepTransaction(txId) {
    const tx = this.transactions.find((t) => t.id === txId);
    if (!tx) {
      return { ok: false, message: `Transaction ${txId} does not exist.` };
    }
    if (tx.state === 'COMMITTED') {
      return { ok: false, message: `${txId} has already committed.` };
    }
    if (tx.state === 'ABORTED') {
      return { ok: false, message: `${txId} has already aborted.` };
    }
    if (tx.state === 'BLOCKED') {
      return {
        ok: false,
        blocked: true,
        message: tx.blockedInfo
          ? tx.blockedInfo.reason
          : `${txId} is currently blocked waiting for a lock.`
      };
    }
    if (tx.pc >= tx.operations.length) {
      return { ok: false, message: `${txId} has no remaining operations.` };
    }

    const op = tx.operations[tx.pc];
    const opLabel = SimulationEngine.formatOp(op);

    // Enforce: cannot COMMIT if unfinished operations remain after COMMIT
    if (op.type === 'COMMIT' && tx.pc < tx.operations.length - 1) {
      return {
        ok: false,
        message: `${txId} cannot COMMIT while unfinished operations remain after COMMIT.`
      };
    }

    this.stepCount += 1;
    const step = this.stepCount;
    if (tx.startStep === null) {
      tx.startStep = step;
    }

    // ---- READ OPERATION ----
    if (op.type === 'READ') {
      const needsSharedLock = this.isolationLevel !== 'READ_UNCOMMITTED';
      if (needsSharedLock) {
        const lockRes = this.lockManager.requestLock(tx.id, op.key, 'S', step, opLabel);
        if (!lockRes.granted) {
          tx.state = 'BLOCKED';
          tx.blockedInfo = {
            resource: op.key,
            requestedMode: 'S',
            blockedBy: lockRes.blockedBy,
            reason: lockRes.reason,
            opIndex: tx.pc,
            opLabel
          };
          const event = {
            step,
            txId: tx.id,
            opIndex: tx.pc,
            opType: 'READ',
            key: op.key,
            opLabel,
            status: 'BLOCKED',
            detail: lockRes.reason,
            blockedBy: lockRes.blockedBy
          };
          this.executionHistory.push(event);
          return {
            ok: true,
            blocked: true,
            event,
            deadlock: this.getDeadlockState()
          };
        }
      }

      const allowDirty = this.isolationLevel === 'READ_UNCOMMITTED';
      const readRes = this.db.read(op.key, tx.id, allowDirty);
      tx.readSet.push({
        key: op.key,
        value: readRes.value,
        step,
        sourceTx: readRes.sourceTx,
        isDirty: readRes.isDirty,
        isOwnWrite: readRes.isOwnWrite,
        opIndex: tx.pc
      });
      tx.pc += 1;

      let unblocked = [];
      let lockDetail = needsSharedLock ? `Held S(${op.key})` : 'No S lock (READ UNCOMMITTED)';
      if (this.isolationLevel === 'READ_COMMITTED') {
        unblocked = this.lockManager.releaseSharedLock(tx.id, op.key, step);
        this._applyUnblockedTransactions(unblocked, step);
        lockDetail = `Acquired & released S(${op.key})`;
      }

      const dirtyNote = readRes.isDirty
        ? ` [DIRTY READ from uncommitted ${readRes.sourceTx}]`
        : readRes.isOwnWrite
          ? ' (own uncommitted write)'
          : ` (committed by ${readRes.sourceTx})`;

      const event = {
        step,
        txId: tx.id,
        opIndex: tx.pc - 1,
        opType: 'READ',
        key: op.key,
        value: readRes.value,
        sourceTx: readRes.sourceTx,
        isDirty: readRes.isDirty,
        isOwnWrite: readRes.isOwnWrite,
        opLabel,
        status: 'EXECUTED',
        lockDetail,
        unblocked,
        detail: `Read ${op.key} = ${readRes.value}${dirtyNote}. ${lockDetail}.`
      };
      this.executionHistory.push(event);
      return { ok: true, blocked: false, event, deadlock: this.getDeadlockState() };
    }

    // ---- WRITE OPERATION ----
    if (op.type === 'WRITE') {
      const lockRes = this.lockManager.requestLock(tx.id, op.key, 'X', step, opLabel);
      if (!lockRes.granted) {
        tx.state = 'BLOCKED';
        tx.blockedInfo = {
          resource: op.key,
          requestedMode: 'X',
          blockedBy: lockRes.blockedBy,
          reason: lockRes.reason,
          opIndex: tx.pc,
          opLabel
        };
        const event = {
          step,
          txId: tx.id,
          opIndex: tx.pc,
          opType: 'WRITE',
          key: op.key,
          value: op.value,
          opLabel,
          status: 'BLOCKED',
          detail: lockRes.reason,
          blockedBy: lockRes.blockedBy
        };
        this.executionHistory.push(event);
        return {
          ok: true,
          blocked: true,
          event,
          deadlock: this.getDeadlockState()
        };
      }

      const writeRes = this.db.write(op.key, op.value, tx.id, step);
      tx.writeSet.push({
        key: op.key,
        value: op.value,
        step,
        opIndex: tx.pc,
        committed: false,
        rolledBack: false
      });
      tx.pc += 1;

      const lockDetail = lockRes.upgraded
        ? `Upgraded S(${op.key}) -> X(${op.key})`
        : lockRes.alreadyHeld
          ? `Reused X(${op.key})`
          : `Acquired X(${op.key})`;

      const event = {
        step,
        txId: tx.id,
        opIndex: tx.pc - 1,
        opType: 'WRITE',
        key: op.key,
        value: op.value,
        prevValue: writeRes.prevValue,
        opLabel,
        status: 'EXECUTED',
        lockDetail,
        detail: `Staged uncommitted ${op.key} = ${op.value} (committed remains ${writeRes.prevValue}). ${lockDetail}.`
      };
      this.executionHistory.push(event);
      return { ok: true, blocked: false, event, deadlock: this.getDeadlockState() };
    }

    // ---- COMMIT OPERATION ----
    if (op.type === 'COMMIT') {
      const published = this.db.commit(tx.id, step);
      tx.writeSet.forEach((w) => {
        w.committed = true;
      });
      tx.state = 'COMMITTED';
      tx.endStep = step;
      tx.pc += 1;

      const unblocked = this.lockManager.releaseAllLocks(tx.id, step, 'COMMIT');
      this._applyUnblockedTransactions(unblocked, step);

      const pubSummary =
        published.length > 0
          ? `Published ${published.map((p) => `${p.key}=${p.value}`).join(', ')}.`
          : 'No pending writes to publish.';
      const wakeSummary =
        unblocked.length > 0
          ? ` Unblocked ${unblocked.map((u) => u.txId).join(', ')}.`
          : '';

      const event = {
        step,
        txId: tx.id,
        opIndex: tx.pc - 1,
        opType: 'COMMIT',
        opLabel: 'COMMIT',
        status: 'EXECUTED',
        published,
        unblocked,
        detail: `Committed ${tx.id}. ${pubSummary} Released all locks.${wakeSummary}`
      };
      this.executionHistory.push(event);
      return { ok: true, blocked: false, event, deadlock: this.getDeadlockState() };
    }

    // ---- ROLLBACK OPERATION ----
    if (op.type === 'ROLLBACK') {
      return this._executeAbort(tx, step, tx.pc, 'ROLLBACK');
    }

    return { ok: false, message: `Unsupported operation: ${op.type}` };
  }

  /**
   * Manually abort a transaction (e.g., deadlock victim recovery).
   */
  abortTransaction(txId, reason = 'DEADLOCK_VICTIM') {
    const tx = this.transactions.find((t) => t.id === txId);
    if (!tx) {
      return { ok: false, message: `Transaction ${txId} not found.` };
    }
    if (tx.state === 'COMMITTED' || tx.state === 'ABORTED') {
      return { ok: false, message: `${txId} is already ${tx.state}.` };
    }
    this.stepCount += 1;
    return this._executeAbort(tx, this.stepCount, tx.pc, reason);
  }

  _executeAbort(tx, step, opIndex, reason) {
    const discarded = this.db.rollback(tx.id, step);
    tx.writeSet.forEach((w) => {
      w.rolledBack = true;
    });
    tx.state = 'ABORTED';
    tx.endStep = step;
    tx.blockedInfo = null;
    if (reason === 'ROLLBACK') {
      tx.pc += 1;
    }

    const unblocked = this.lockManager.releaseAllLocks(tx.id, step, reason);
    this._applyUnblockedTransactions(unblocked, step);

    const discSummary =
      discarded.length > 0
        ? `Discarded uncommitted ${discarded.map((d) => `${d.key}=${d.discardedValue}`).join(', ')}.`
        : 'No uncommitted writes to discard.';
    const wakeSummary =
      unblocked.length > 0
        ? ` Unblocked ${unblocked.map((u) => u.txId).join(', ')}.`
        : '';

    const isVictim = reason === 'DEADLOCK_VICTIM';
    const event = {
      step,
      txId: tx.id,
      opIndex,
      opType: 'ROLLBACK',
      opLabel: isVictim ? 'ABORT (VICTIM)' : 'ROLLBACK',
      status: 'EXECUTED',
      isVictimAbort: isVictim,
      discarded,
      unblocked,
      detail: `${isVictim ? 'Aborted deadlock victim' : 'Rolled back'} ${tx.id}. ${discSummary} Released all locks.${wakeSummary}`
    };
    this.executionHistory.push(event);
    return { ok: true, blocked: false, event, deadlock: this.getDeadlockState() };
  }
}

/* ==========================================================================
   4. ANALYSIS ENGINE (SerializabilityAnalyzer & AnomalyDetector)
   Operates strictly on actual executed history — zero fake results.
   ========================================================================== */

class SerializabilityAnalyzer {
  /**
   * Conflict rules on the same resource across distinct transactions (earlier -> later):
   *   READ-READ: no conflict
   *   READ-WRITE: conflict (RW)
   *   WRITE-READ: conflict (WR)
   *   WRITE-WRITE: conflict (WW)
   */
  static analyze(executionHistory, transactions, includeAborted = false) {
    const abortedIds = new Set(
      transactions.filter((t) => t.state === 'ABORTED').map((t) => t.id)
    );

    const dataOps = executionHistory.filter(
      (ev) =>
        ev.status === 'EXECUTED' &&
        (ev.opType === 'READ' || ev.opType === 'WRITE') &&
        (includeAborted || !abortedIds.has(ev.txId))
    );

    const participatingNodesSet = new Set();
    for (const ev of executionHistory) {
      if (ev.status === 'EXECUTED' && (includeAborted || !abortedIds.has(ev.txId))) {
        participatingNodesSet.add(ev.txId);
      }
    }
    const nodes = [...participatingNodesSet].sort();

    if (dataOps.length === 0) {
      return {
        status: 'NO_SCHEDULE',
        label: 'No Schedule Analyzed',
        nodes,
        edges: [],
        conflicts: [],
        hasCycle: false,
        cycles: [],
        cycleNodeSet: new Set(),
        cycleEdgeSet: new Set(),
        serialOrder: [],
        excludedAbortedCount: includeAborted ? 0 : abortedIds.size
      };
    }

    const conflicts = [];
    const edgeMap = new Map();

    for (let i = 0; i < dataOps.length; i++) {
      for (let j = i + 1; j < dataOps.length; j++) {
        const op1 = dataOps[i];
        const op2 = dataOps[j];
        if (op1.txId === op2.txId) continue;
        if (op1.key !== op2.key) continue;
        if (op1.opType === 'READ' && op2.opType === 'READ') continue;

        const conflictType =
          op1.opType === 'READ' && op2.opType === 'WRITE'
            ? 'RW'
            : op1.opType === 'WRITE' && op2.opType === 'READ'
              ? 'WR'
              : 'WW';

        const conflictRecord = {
          from: op1.txId,
          to: op2.txId,
          key: op1.key,
          conflictType,
          op1,
          op2
        };
        conflicts.push(conflictRecord);

        const edgeKey = `${op1.txId}->${op2.txId}`;
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, {
            from: op1.txId,
            to: op2.txId,
            labels: new Set(),
            conflicts: []
          });
        }
        const edgeObj = edgeMap.get(edgeKey);
        edgeObj.labels.add(`${op1.key}:${conflictType}`);
        edgeObj.conflicts.push(conflictRecord);
      }
    }

    const edges = [...edgeMap.values()].map((e) => ({
      from: e.from,
      to: e.to,
      label: [...e.labels].join(', '),
      conflicts: e.conflicts
    }));

    // Adjacency map
    const adj = new Map();
    const inDegree = new Map();
    for (const n of nodes) {
      adj.set(n, []);
      inDegree.set(n, 0);
    }
    for (const e of edges) {
      adj.get(e.from).push(e);
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    }

    // DFS Cycle Detection
    const color = new Map();
    for (const n of nodes) color.set(n, 0);
    const stack = [];
    const edgeStack = [];
    const cycles = [];
    const seenCycles = new Set();

    const dfs = (u) => {
      color.set(u, 1);
      stack.push(u);
      for (const edge of adj.get(u)) {
        const v = edge.to;
        const c = color.get(v);
        if (c === 1) {
          const idx = stack.indexOf(v);
          const cycleNodes = [...stack.slice(idx), v];
          const cycleEdges = [...edgeStack.slice(idx), edge];
          const sig = [...cycleNodes.slice(0, -1)].sort().join(',');
          if (!seenCycles.has(sig)) {
            seenCycles.add(sig);
            cycles.push({ nodes: cycleNodes, edges: cycleEdges });
          }
        } else if (c === 0) {
          edgeStack.push(edge);
          dfs(v);
          edgeStack.pop();
        }
      }
      stack.pop();
      color.set(u, 2);
    };

    for (const n of nodes) {
      if (color.get(n) === 0) dfs(n);
    }

    const hasCycle = cycles.length > 0;
    const cycleNodeSet = new Set();
    const cycleEdgeSet = new Set();
    for (const cyc of cycles) {
      cyc.nodes.forEach((n) => cycleNodeSet.add(n));
      cyc.edges.forEach((e) => cycleEdgeSet.add(`${e.from}->${e.to}`));
    }

    // Kahn's Topological Sort (deterministic lexicographical tie-breaking)
    let serialOrder = [];
    if (!hasCycle) {
      const queue = nodes.filter((n) => inDegree.get(n) === 0).sort();
      const degCopy = new Map(inDegree);
      while (queue.length > 0) {
        queue.sort();
        const curr = queue.shift();
        serialOrder.push(curr);
        for (const edge of adj.get(curr)) {
          const nextDeg = degCopy.get(edge.to) - 1;
          degCopy.set(edge.to, nextDeg);
          if (nextDeg === 0) {
            queue.push(edge.to);
          }
        }
      }
    }

    return {
      status: hasCycle ? 'NOT_CONFLICT_SERIALIZABLE' : 'CONFLICT_SERIALIZABLE',
      label: hasCycle ? 'Not Conflict Serializable' : 'Conflict Serializable',
      nodes,
      edges,
      conflicts,
      hasCycle,
      cycles,
      cycleNodeSet,
      cycleEdgeSet,
      serialOrder,
      excludedAbortedCount: includeAborted ? 0 : abortedIds.size
    };
  }
}

class AnomalyDetector {
  /**
   * Detect Dirty Reads, Non-Repeatable Reads, Lost Updates, and Serialization Conflicts
   * strictly from executed simulation history.
   */
  static analyze(engine) {
    const history = engine.executionHistory;
    const txMap = new Map(engine.transactions.map((t) => [t.id, t]));
    const anomalies = [];

    // 1. DIRTY READ DETECTION
    const dirtyReads = history.filter(
      (ev) => ev.status === 'EXECUTED' && ev.opType === 'READ' && ev.isDirty === true
    );
    for (const dr of dirtyReads) {
      const writerTx = txMap.get(dr.sourceTx);
      const writerOutcome =
        writerTx && writerTx.state === 'ABORTED'
          ? `${dr.sourceTx} subsequently rolled back, so ${dr.txId} read data that never committed.`
          : `${dr.sourceTx} had not committed when ${dr.txId} read ${dr.key}.`;

      const writerOp = [...history]
        .reverse()
        .find(
          (e) =>
            e.step < dr.step &&
            e.status === 'EXECUTED' &&
            e.opType === 'WRITE' &&
            e.txId === dr.sourceTx &&
            e.key === dr.key
        );

      anomalies.push({
        id: `dirty-${dr.step}-${dr.txId}`,
        name: 'Dirty Read',
        severity: 'HIGH',
        transactions: [dr.sourceTx, dr.txId],
        operations: [
          writerOp ? `Step ${writerOp.step}: ${writerOp.txId} ${writerOp.opLabel}` : `${dr.sourceTx} WRITE(${dr.key})`,
          `Step ${dr.step}: ${dr.txId} ${dr.opLabel} -> ${dr.value}`
        ],
        explanation: `${dr.txId} read uncommitted value ${dr.key} = ${dr.value} written by ${dr.sourceTx}. ${writerOutcome}`,
        prevention: 'Use READ COMMITTED or higher so reads acquire a Shared (S) lock and wait until writers commit or roll back.'
      });
    }

    // 2. NON-REPEATABLE READ DETECTION
    const executedByTx = new Map();
    for (const ev of history) {
      if (ev.status !== 'EXECUTED') continue;
      if (!executedByTx.has(ev.txId)) executedByTx.set(ev.txId, []);
      executedByTx.get(ev.txId).push(ev);
    }

    const commitStepsByTx = new Map();
    for (const ev of history) {
      if (ev.status === 'EXECUTED' && ev.opType === 'COMMIT') {
        commitStepsByTx.set(ev.txId, ev.step);
      }
    }

    const seenNonRepeatable = new Set();
    for (const [txId, events] of executedByTx.entries()) {
      const readsByKey = new Map();
      for (const ev of events) {
        if (ev.opType === 'READ') {
          if (!readsByKey.has(ev.key)) readsByKey.set(ev.key, []);
          readsByKey.get(ev.key).push(ev);
        }
      }

      for (const [key, reads] of readsByKey.entries()) {
        for (let i = 1; i < reads.length; i++) {
          const prev = reads[i - 1];
          const curr = reads[i];
          if (prev.isDirty || curr.isDirty || prev.isOwnWrite || curr.isOwnWrite) continue;
          if (prev.value === curr.value) continue;

          // Ensure same transaction didn't write `key` between prev and curr
          const ownWriteBetween = events.some(
            (e) =>
              e.opType === 'WRITE' &&
              e.key === key &&
              e.step > prev.step &&
              e.step < curr.step
          );
          if (ownWriteBetween) continue;

          // Find another transaction that committed a write on `key` between prev and curr
          const interveningWriter = history.find(
            (e) =>
              e.status === 'EXECUTED' &&
              e.opType === 'COMMIT' &&
              e.txId !== txId &&
              e.step > prev.step &&
              e.step < curr.step &&
              (e.published || []).some((p) => p.key === key)
          );

          if (interveningWriter) {
            const sig = `${txId}:${key}:${prev.step}:${curr.step}`;
            if (seenNonRepeatable.has(sig)) continue;
            seenNonRepeatable.add(sig);

            anomalies.push({
              id: `nrr-${sig}`,
              name: 'Non-Repeatable Read',
              severity: 'MEDIUM',
              transactions: [txId, interveningWriter.txId],
              operations: [
                `Step ${prev.step}: ${txId} READ(${key}) -> ${prev.value}`,
                `Step ${interveningWriter.step}: ${interveningWriter.txId} COMMIT (${key}=${curr.value})`,
                `Step ${curr.step}: ${txId} READ(${key}) -> ${curr.value}`
              ],
              explanation: `${txId} read ${key} twice and observed committed value ${prev.value} at step ${prev.step}, then ${curr.value} at step ${curr.step} after ${interveningWriter.txId} committed an update in between.`,
              prevention: 'Use REPEATABLE READ or SERIALIZABLE so Shared (S) locks on read keys are retained until transaction completion.'
            });
          }
        }
      }
    }

    // 3. LOST UPDATE DETECTION
    const executedDataOps = history.filter(
      (ev) => ev.status === 'EXECUTED' && (ev.opType === 'READ' || ev.opType === 'WRITE')
    );
    const writes = executedDataOps.filter((ev) => {
      if (ev.opType !== 'WRITE') return false;
      const t = txMap.get(ev.txId);
      return !t || t.state !== 'ABORTED';
    });

    const seenLostUpdate = new Set();
    for (let i = 0; i < writes.length; i++) {
      for (let j = i + 1; j < writes.length; j++) {
        const w1 = writes[i];
        const w2 = writes[j];
        if (w1.txId === w2.txId || w1.key !== w2.key) continue;

        // Find last read by w1.txId before w1, and last read by w2.txId before w2
        const r1 = [...executedDataOps]
          .reverse()
          .find((e) => e.opType === 'READ' && e.txId === w1.txId && e.key === w1.key && e.step < w1.step);
        const r2 = [...executedDataOps]
          .reverse()
          .find((e) => e.opType === 'READ' && e.txId === w2.txId && e.key === w2.key && e.step < w2.step);

        if (!r1 || !r2) continue;

        // Lost update condition: T2 read stale initial value before T1's write/commit took effect,
        // observed the same pre-update value as T1, and then wrote without re-reading T1's update.
        const w1CommitStep = commitStepsByTx.get(w1.txId) ?? Infinity;
        const r2SawStale = r2.step < w1.step || (r2.step < w1CommitStep && r2.value === r1.value);
        if (r2SawStale && !r2.isDirty && r2.value === r1.value) {
          const sig = `${w1.key}:${w1.txId}:${w2.txId}`;
          if (seenLostUpdate.has(sig)) continue;
          seenLostUpdate.add(sig);

          anomalies.push({
            id: `lost-${sig}`,
            name: 'Lost Update',
            severity: 'HIGH',
            transactions: [w1.txId, w2.txId],
            operations: [
              `Step ${r1.step}: ${w1.txId} READ(${w1.key}) -> ${r1.value}`,
              `Step ${r2.step}: ${w2.txId} READ(${w2.key}) -> ${r2.value}`,
              `Step ${w1.step}: ${w1.txId} WRITE(${w1.key}, ${w1.value})`,
              `Step ${w2.step}: ${w2.txId} WRITE(${w2.key}, ${w2.value})`
            ],
            explanation: `Both ${w1.txId} and ${w2.txId} read the same initial value ${w1.key} = ${r1.value}. ${w1.txId} wrote ${w1.value}, and then ${w2.txId} overwrote ${w1.key} with ${w2.value} based on the stale read, causing ${w1.txId}'s update to be lost.`,
            prevention: 'Use REPEATABLE READ or SERIALIZABLE (retaining S locks before upgrade), explicit SELECT ... FOR UPDATE locks, or optimistic version checks.'
          });
        }
      }
    }

    // 4. SERIALIZATION CONFLICT DETECTION
    const serialAnalysis = SerializabilityAnalyzer.analyze(
      engine.executionHistory,
      engine.transactions,
      false
    );
    if (serialAnalysis.hasCycle) {
      for (let idx = 0; idx < serialAnalysis.cycles.length; idx++) {
        const cyc = serialAnalysis.cycles[idx];
        const chain = cyc.nodes.join(' → ');
        const opPairs = cyc.edges.flatMap((e) =>
          e.conflicts.slice(0, 1).map(
            (c) =>
              `${c.from} ${c.op1.opLabel} (S${c.op1.step}) → ${c.to} ${c.op2.opLabel} (S${c.op2.step}) [${c.conflictType} on ${c.key}]`
          )
        );
        anomalies.push({
          id: `serial-cycle-${idx}-${chain}`,
          name: 'Serialization Conflict',
          severity: 'HIGH',
          transactions: [...new Set(cyc.nodes)],
          operations: opPairs,
          explanation: `The executed schedule contains a precedence graph cycle (${chain}), proving it is not conflict-serializable — no serial ordering of these transactions produces the same conflict order.`,
          prevention: 'Run under SERIALIZABLE isolation (Strict 2PL or Serializable Snapshot Isolation) to prevent cyclic conflict dependencies.'
        });
      }
    }

    return anomalies;
  }
}

/* ==========================================================================
   5. BUILT-IN SELF-TEST RUNNER
   Executes real engine classes deterministically — zero hardcoded PASS flags.
   ========================================================================== */

class SelfTestRunner {
  static runAll() {
    const tests = [
      {
        id: 'read-write',
        name: 'READ / WRITE Execution',
        fn: () => {
          const eng = new SimulationEngine();
          eng.loadScenario({
            name: 'Test RW',
            isolationLevel: 'READ_COMMITTED',
            initialDb: { A: 50 },
            transactions: [
              {
                id: 'T1',
                operations: [
                  { type: 'READ', key: 'A' },
                  { type: 'WRITE', key: 'A', value: 120 },
                  { type: 'COMMIT' }
                ]
              }
            ]
          });
          const s1 = eng.stepTransaction('T1');
          const s2 = eng.stepTransaction('T1');
          const snap = eng.db.getSnapshot()[0];
          const passed =
            s1.ok &&
            s1.event.value === 50 &&
            s2.ok &&
            snap.committedValue === 50 &&
            snap.uncommittedWrites.length === 1 &&
            snap.uncommittedWrites[0].value === 120;
          return {
            passed,
            detail: passed
              ? 'Read returned 50; write staged uncommitted 120 while committed remained 50.'
              : `Unexpected state: committed=${snap.committedValue}, uncommitted=${JSON.stringify(snap.uncommittedWrites)}`
          };
        }
      },
      {
        id: 'commit-publish',
        name: 'COMMIT Publishing Values',
        fn: () => {
          const eng = new SimulationEngine();
          eng.loadScenario({
            name: 'Test Commit',
            isolationLevel: 'READ_COMMITTED',
            initialDb: { A: 10 },
            transactions: [
              {
                id: 'T1',
                operations: [
                  { type: 'WRITE', key: 'A', value: 99 },
                  { type: 'COMMIT' }
                ]
              }
            ]
          });
          eng.stepTransaction('T1');
          eng.stepTransaction('T1');
          const snap = eng.db.getSnapshot()[0];
          const passed =
            eng.transactions[0].state === 'COMMITTED' &&
            snap.committedValue === 99 &&
            snap.lastCommittedBy === 'T1' &&
            snap.uncommittedWrites.length === 0 &&
            eng.lockManager.getActiveLockCount() === 0;
          return {
            passed,
            detail: passed
              ? 'COMMIT published A=99, cleared uncommitted buffer, and released locks.'
              : `Failed: state=${eng.transactions[0].state}, committed=${snap.committedValue}`
          };
        }
      },
      {
        id: 'rollback-discard',
        name: 'ROLLBACK Discarding Values',
        fn: () => {
          const eng = new SimulationEngine();
          eng.loadScenario({
            name: 'Test Rollback',
            isolationLevel: 'READ_COMMITTED',
            initialDb: { A: 42 },
            transactions: [
              {
                id: 'T1',
                operations: [
                  { type: 'WRITE', key: 'A', value: 999 },
                  { type: 'ROLLBACK' }
                ]
              }
            ]
          });
          eng.stepTransaction('T1');
          eng.stepTransaction('T1');
          const snap = eng.db.getSnapshot()[0];
          const passed =
            eng.transactions[0].state === 'ABORTED' &&
            snap.committedValue === 42 &&
            snap.uncommittedWrites.length === 0 &&
            eng.lockManager.getActiveLockCount() === 0;
          return {
            passed,
            detail: passed
              ? 'ROLLBACK discarded uncommitted 999, preserved committed A=42, and released X(A).'
              : `Failed: committed=${snap.committedValue}, state=${eng.transactions[0].state}`
          };
        }
      },
      {
        id: 'dirty-read-detect',
        name: 'Dirty-Read Detection',
        fn: () => {
          const eng = new SimulationEngine();
          eng.loadScenario(BUILTIN_SCENARIOS.find((s) => s.id === 'dirty-read'));
          eng.stepTransaction('T1'); // WRITE(A, 150)
          eng.stepTransaction('T2'); // READ(A) -> 150 (dirty)
          eng.stepTransaction('T1'); // ROLLBACK
          const anomalies = AnomalyDetector.analyze(eng);
          const found = anomalies.find((a) => a.name === 'Dirty Read');
          return {
            passed: Boolean(found),
            detail: found
              ? `Detected Dirty Read involving ${found.transactions.join(', ')}.`
              : 'Dirty Read anomaly was not detected.'
          };
        }
      },
      {
        id: 'non-repeatable-detect',
        name: 'Non-Repeatable-Read Detection',
        fn: () => {
          const eng = new SimulationEngine();
          eng.loadScenario(BUILTIN_SCENARIOS.find((s) => s.id === 'non-repeatable-read'));
          for (let i = 0; i < 8; i++) eng.stepNext();
          const anomalies = AnomalyDetector.analyze(eng);
          const found = anomalies.find((a) => a.name === 'Non-Repeatable Read');
          return {
            passed: Boolean(found),
            detail: found
              ? `Detected Non-Repeatable Read across ${found.transactions.join(', ')}.`
              : 'Non-Repeatable Read anomaly was not detected.'
          };
        }
      },
      {
        id: 'shared-lock-compat',
        name: 'Shared Lock Compatibility (S + S)',
        fn: () => {
          const lm = new LockManager();
          const r1 = lm.requestLock('T1', 'A', 'S', 1, 'READ(A)');
          const r2 = lm.requestLock('T2', 'A', 'S', 2, 'READ(A)');
          const rows = lm.getLockTableRows();
          const passed =
            r1.granted &&
            r2.granted &&
            rows.length === 1 &&
            rows[0].owners.length === 2;
          return {
            passed,
            detail: passed
              ? 'T1 and T2 concurrently acquired Shared (S) locks on A without blocking.'
              : 'Shared locks failed to share compatibility.'
          };
        }
      },
      {
        id: 'exclusive-lock-block',
        name: 'Exclusive Lock Blocking & Wake-Up',
        fn: () => {
          const eng = new SimulationEngine();
          eng.loadScenario({
            name: 'Test X Block',
            isolationLevel: 'REPEATABLE_READ',
            initialDb: { A: 100 },
            transactions: [
              { id: 'T1', operations: [{ type: 'WRITE', key: 'A', value: 150 }, { type: 'COMMIT' }] },
              { id: 'T2', operations: [{ type: 'READ', key: 'A' }, { type: 'COMMIT' }] }
            ]
          });
          eng.stepTransaction('T1'); // acquires X(A)
          const blk = eng.stepTransaction('T2'); // blocked by T1
          const blockedState = eng.transactions[1].state === 'BLOCKED';
          const blockedRetry = eng.stepTransaction('T2'); // must refuse while blocked
          eng.stepTransaction('T1'); // COMMIT -> releases X(A) -> unblocks T2
          const resumedState = eng.transactions[1].state === 'ACTIVE';
          const r2 = eng.stepTransaction('T2'); // now reads 150
          const passed =
            blk.blocked === true &&
            blockedState &&
            blockedRetry.ok === false &&
            resumedState &&
            r2.ok &&
            r2.event.value === 150;
          return {
            passed,
            detail: passed
              ? 'T2 blocked on X(A), refused premature execution, unblocked on T1 commit, then read 150.'
              : 'Exclusive lock blocking/unblocking sequence did not satisfy assertions.'
          };
        }
      },
      {
        id: 'wfg-cycle',
        name: 'Wait-For Graph Cycle Detection',
        fn: () => {
          const eng = new SimulationEngine();
          eng.loadScenario(BUILTIN_SCENARIOS.find((s) => s.id === 'deadlock-demo'));
          eng.stepTransaction('T1'); // X(A)
          eng.stepTransaction('T2'); // X(B)
          eng.stepTransaction('T1'); // blocked on B (T1->T2)
          eng.stepTransaction('T2'); // blocked on A (T2->T1)
          const dl = eng.getDeadlockState();
          const passed =
            dl.hasDeadlock &&
            dl.cycles.length === 1 &&
            dl.cycleNodeSet.has('T1') &&
            dl.cycleNodeSet.has('T2');
          return {
            passed,
            detail: passed
              ? `Detected Wait-For cycle: ${dl.cycles[0].nodes.join(' → ')}.`
              : 'Expected deadlock cycle was not detected.'
          };
        }
      },
      {
        id: 'conflict-cycle',
        name: 'Conflict Graph Cycle Detection',
        fn: () => {
          const eng = new SimulationEngine();
          eng.loadScenario(BUILTIN_SCENARIOS.find((s) => s.id === 'non-serializable'));
          for (let i = 0; i < 8; i++) eng.stepNext();
          const analysis = SerializabilityAnalyzer.analyze(
            eng.executionHistory,
            eng.transactions,
            false
          );
          const passed =
            analysis.hasCycle === true &&
            analysis.status === 'NOT_CONFLICT_SERIALIZABLE' &&
            analysis.cycles.length >= 1;
          return {
            passed,
            detail: passed
              ? `Flagged Not Conflict Serializable with cycle ${analysis.cycles[0].nodes.join(' → ')}.`
              : `Unexpected serializability verdict: ${analysis.status}`
          };
        }
      },
      {
        id: 'topological-order',
        name: 'Topological Ordering (Acyclic Graph)',
        fn: () => {
          const eng = new SimulationEngine();
          eng.loadScenario({
            name: 'Acyclic Chain',
            isolationLevel: 'READ_COMMITTED',
            initialDb: { A: 10, B: 20 },
            transactions: [
              { id: 'T1', operations: [{ type: 'WRITE', key: 'A', value: 11 }, { type: 'COMMIT' }] },
              { id: 'T2', operations: [{ type: 'READ', key: 'A' }, { type: 'WRITE', key: 'B', value: 22 }, { type: 'COMMIT' }] },
              { id: 'T3', operations: [{ type: 'READ', key: 'B' }, { type: 'COMMIT' }] }
            ]
          });
          eng.stepTransaction('T1'); // W(A)
          eng.stepTransaction('T1'); // COMMIT
          eng.stepTransaction('T2'); // R(A) -> T1->T2
          eng.stepTransaction('T2'); // W(B)
          eng.stepTransaction('T2'); // COMMIT
          eng.stepTransaction('T3'); // R(B) -> T2->T3
          eng.stepTransaction('T3'); // COMMIT
          const analysis = SerializabilityAnalyzer.analyze(
            eng.executionHistory,
            eng.transactions,
            false
          );
          const orderStr = analysis.serialOrder.join(' -> ');
          const passed =
            analysis.hasCycle === false &&
            analysis.status === 'CONFLICT_SERIALIZABLE' &&
            orderStr === 'T1 -> T2 -> T3';
          return {
            passed,
            detail: passed
              ? `Conflict Serializable with valid topological order: ${orderStr}.`
              : `Unexpected result: status=${analysis.status}, order=${orderStr}`
          };
        }
      }
    ];

    return tests.map((t) => {
      const start = performance.now();
      try {
        const res = t.fn();
        const ms = (performance.now() - start).toFixed(2);
        return {
          id: t.id,
          name: t.name,
          passed: Boolean(res.passed),
          detail: res.detail,
          durationMs: ms
        };
      } catch (err) {
        const ms = (performance.now() - start).toFixed(2);
        return {
          id: t.id,
          name: t.name,
          passed: false,
          detail: `Exception: ${err.message}`,
          durationMs: ms
        };
      }
    });
  }
}

/* ==========================================================================
   6. PERSISTENCE MANAGER (localStorage)
   ========================================================================== */

const StorageManager = {
  SCENARIOS_KEY: 'txnlab_custom_scenarios_v1',
  PREFS_KEY: 'txnlab_prefs_v1',

  getCustomScenarios() {
    try {
      const raw = localStorage.getItem(this.SCENARIOS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveCustomScenario(scenario) {
    const existing = this.getCustomScenarios();
    const record = {
      ...scenario,
      id: `custom-${Date.now()}`,
      savedAt: new Date().toISOString()
    };
    existing.unshift(record);
    localStorage.setItem(this.SCENARIOS_KEY, JSON.stringify(existing));
    return record;
  },

  deleteCustomScenario(id) {
    const filtered = this.getCustomScenarios().filter((s) => s.id !== id);
    localStorage.setItem(this.SCENARIOS_KEY, JSON.stringify(filtered));
  },

  getPrefs() {
    try {
      const raw = localStorage.getItem(this.PREFS_KEY);
      return raw ? JSON.parse(raw) : { theme: 'dark', speed: 850 };
    } catch {
      return { theme: 'dark', speed: 850 };
    }
  },

  savePrefs(patch) {
    try {
      const next = { ...this.getPrefs(), ...patch };
      localStorage.setItem(this.PREFS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors cleanly
    }
  }
};

/* ==========================================================================
   7. SVG VISUALIZATION RENDERERS
   ========================================================================== */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TXN_PALETTE = ['#4c86f7', '#38bdf8', '#f59e0b', '#22c55e', '#a78bfa', '#f472b6'];

function getTxnAccentColor(txId) {
  const num = parseInt(String(txId).replace(/\D/g, ''), 10);
  const idx = Number.isNaN(num) ? 0 : Math.max(0, num - 1) % TXN_PALETTE.length;
  return TXN_PALETTE[idx];
}

function renderDirectedGraphSVG({ nodes, edges, cycleNodeSet, cycleEdgeSet, emptyMessage, markerPrefix }) {
  if (!nodes || nodes.length === 0) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }

  const width = 540;
  const height = 304;
  const cx = width / 2;
  const cy = height / 2;
  const radius = nodes.length === 1 ? 0 : Math.min(116, 78 + nodes.length * 10);
  const nodeR = 25;

  const positions = new Map();
  if (nodes.length === 1) {
    positions.set(nodes[0], { x: cx, y: cy });
  } else if (nodes.length === 2) {
    positions.set(nodes[0], { x: cx - 132, y: cy });
    positions.set(nodes[1], { x: cx + 132, y: cy });
  } else {
    nodes.forEach((n, idx) => {
      const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / nodes.length;
      positions.set(n, {
        x: cx + Math.cos(angle) * radius * 1.32,
        y: cy + Math.sin(angle) * radius * 0.92
      });
    });
  }

  const pairCount = new Set(edges.map((e) => `${e.from}->${e.to}`));

  const edgeMarkup = edges
    .map((e) => {
      const p1 = positions.get(e.from);
      const p2 = positions.get(e.to);
      if (!p1 || !p2) return '';

      const isCycle = cycleEdgeSet.has(`${e.from}->${e.to}`);
      const hasReverse = pairCount.has(`${e.to}->${e.from}`);

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;

      const px = -uy;
      const py = ux;
      const curveOffset = hasReverse ? 38 : 0;

      const startX = p1.x + ux * (nodeR + 3);
      const startY = p1.y + uy * (nodeR + 3);
      const endX = p2.x - ux * (nodeR + 9);
      const endY = p2.y - uy * (nodeR + 9);

      const ctrlX = (startX + endX) / 2 + px * curveOffset;
      const ctrlY = (startY + endY) / 2 + py * curveOffset;

      const labelX = 0.25 * startX + 0.5 * ctrlX + 0.25 * endX + px * (hasReverse ? 12 : -14);
      const labelY = 0.25 * startY + 0.5 * ctrlY + 0.25 * endY + py * (hasReverse ? 12 : -14);

      const stroke = isCycle ? 'var(--danger)' : 'var(--accent)';
      const markerId = isCycle ? `${markerPrefix}-arrow-danger` : `${markerPrefix}-arrow-normal`;
      const pathD = `M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
      const edgeLabel = e.label || `${e.resource} (${e.requestedMode}/${e.heldMode})`;
      const labelW = edgeLabel.length * 6.5 + 12;

      return `
        <g>
          <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="${isCycle ? 2.25 : 1.65}" stroke-linecap="round" marker-end="url(#${markerId})" />
          <rect x="${(labelX - labelW / 2).toFixed(1)}" y="${(labelY - 10).toFixed(1)}" width="${labelW.toFixed(1)}" height="18" rx="4" fill="var(--bg-surface)" stroke="${isCycle ? 'var(--danger)' : 'var(--border-strong)'}" stroke-opacity="${isCycle ? '0.55' : '0.85'}" stroke-width="1" />
          <text x="${labelX.toFixed(1)}" y="${(labelY + 2.5).toFixed(1)}" text-anchor="middle" font-family="var(--font-mono)" font-size="10" font-weight="600" fill="${isCycle ? 'var(--danger)' : 'var(--text-secondary)'}">${escapeHtml(edgeLabel)}</text>
        </g>
      `;
    })
    .join('');

  const nodeMarkup = nodes
    .map((n) => {
      const pos = positions.get(n);
      const isCycle = cycleNodeSet.has(n);
      const accent = isCycle ? 'var(--danger)' : getTxnAccentColor(n);
      return `
        <g>
          ${isCycle ? `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${nodeR + 7}" fill="var(--danger-bg)" stroke="var(--danger)" stroke-opacity="0.3" stroke-width="1" />` : `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${nodeR + 4}" fill="none" stroke="${accent}" stroke-opacity="0.18" stroke-width="1" />`}
          <circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${nodeR}" fill="var(--bg-surface)" stroke="${isCycle ? 'var(--danger)' : accent}" stroke-width="${isCycle ? 2.2 : 1.75}" />
          <text x="${pos.x.toFixed(1)}" y="${(pos.y + 4).toFixed(1)}" text-anchor="middle" font-family="var(--font-mono)" font-size="12.5" font-weight="700" fill="${isCycle ? 'var(--danger)' : 'var(--text-primary)'}">${escapeHtml(n)}</text>
        </g>
      `;
    })
    .join('');

  return `
    <svg class="graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Directed transaction dependency graph">
      <defs>
        <marker id="${markerPrefix}-arrow-normal" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="var(--accent)" />
        </marker>
        <marker id="${markerPrefix}-arrow-danger" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="var(--danger)" />
        </marker>
      </defs>
      ${edgeMarkup}
      ${nodeMarkup}
    </svg>
  `;
}

function renderTimelineSVG(transactions, history, selectedStep) {
  if (transactions.length === 0) {
    return '<div class="empty-state">Add transactions to visualize the execution timeline.</div>';
  }

  const leftPad = 82;
  const topPad = 32;
  const colWidth = 102;
  const laneHeight = 46;
  const cols = Math.max(history.length, 6);
  const svgWidth = leftPad + cols * colWidth + 24;
  const svgHeight = topPad + transactions.length * laneHeight + 12;

  const laneIndex = new Map(transactions.map((t, i) => [t.id, i]));

  // Subtle alternating lane backdrops
  let laneBgSvg = '';
  transactions.forEach((tx, idx) => {
    const yTop = topPad + idx * laneHeight;
    if (idx % 2 === 1) {
      laneBgSvg += `<rect x="0" y="${yTop}" width="${svgWidth}" height="${laneHeight}" fill="var(--bg-surface)" fill-opacity="0.45" />`;
    }
  });

  // Grid headers & vertical step guides
  let gridSvg = `<line x1="0" y1="${topPad - 4}" x2="${svgWidth}" y2="${topPad - 4}" stroke="var(--border-subtle)" stroke-width="1" />`;
  for (let c = 0; c < cols; c++) {
    const x = leftPad + c * colWidth + colWidth / 2;
    gridSvg += `
      <line x1="${x}" y1="${topPad - 4}" x2="${x}" y2="${svgHeight - 6}" stroke="var(--border-subtle)" stroke-opacity="0.65" stroke-dasharray="2 3" stroke-width="1" />
      <text x="${x}" y="18" text-anchor="middle" font-family="var(--font-mono)" font-size="10" font-weight="500" fill="var(--text-muted)">Step ${c + 1}</text>
    `;
  }

  // Horizontal swimlanes with per-transaction identity swatch & active lifespan line
  let lanesSvg = '';
  transactions.forEach((tx, idx) => {
    const y = topPad + idx * laneHeight + laneHeight / 2;
    const swatchColor = getTxnAccentColor(tx.id);

    // Find first and last event indices for this txn to draw a crisp lifespan connector
    const txIndices = [];
    history.forEach((ev, eIdx) => {
      if (ev.txId === tx.id) txIndices.push(eIdx);
    });
    let spanLine = '';
    if (txIndices.length >= 2) {
      const x1 = leftPad + txIndices[0] * colWidth + colWidth / 2;
      const x2 = leftPad + txIndices[txIndices.length - 1] * colWidth + colWidth / 2;
      spanLine = `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${swatchColor}" stroke-opacity="0.4" stroke-width="2" />`;
    }

    lanesSvg += `
      <line x1="${leftPad - 8}" y1="${y}" x2="${svgWidth - 10}" y2="${y}" stroke="var(--border-subtle)" stroke-opacity="0.55" stroke-width="1" />
      ${spanLine}
      <rect x="10" y="${y - 4}" width="8" height="8" rx="2" fill="${swatchColor}" />
      <text x="24" y="${y + 4}" font-family="var(--font-mono)" font-size="12" font-weight="700" fill="var(--text-primary)">${escapeHtml(tx.id)}</text>
    `;
  });

  // Precision trace event chips with internal left accent edge
  const eventsSvg = history
    .map((ev, idx) => {
      const row = laneIndex.get(ev.txId);
      if (row === undefined) return '';
      const cx = leftPad + idx * colWidth + colWidth / 2;
      const cy = topPad + row * laneHeight + laneHeight / 2;

      let fill = 'var(--op-read-bg)';
      let stroke = 'var(--op-read)';
      let textColor = 'var(--op-read)';
      let dash = '';
      let shortLabel = '';

      if (ev.status === 'BLOCKED') {
        fill = 'var(--op-blocked-bg)';
        stroke = 'var(--op-blocked)';
        textColor = 'var(--op-blocked)';
        dash = 'stroke-dasharray="4 2"';
        shortLabel = `BLK ${ev.opType === 'READ' ? 'R' : 'W'}(${ev.key})`;
      } else if (ev.opType === 'READ') {
        shortLabel = `R(${ev.key})=${ev.value}`;
      } else if (ev.opType === 'WRITE') {
        fill = 'var(--op-write-bg)';
        stroke = 'var(--op-write)';
        textColor = 'var(--op-write)';
        shortLabel = `W(${ev.key})=${ev.value}`;
      } else if (ev.opType === 'COMMIT') {
        fill = 'var(--op-commit-bg)';
        stroke = 'var(--op-commit)';
        textColor = 'var(--op-commit)';
        shortLabel = 'COMMIT';
      } else if (ev.opType === 'ROLLBACK') {
        fill = 'var(--op-rollback-bg)';
        stroke = 'var(--op-rollback)';
        textColor = 'var(--op-rollback)';
        shortLabel = ev.isVictimAbort ? 'ABORT' : 'ROLLBACK';
      }

      const isSelected = selectedStep === ev.step;
      const boxW = 90;
      const boxH = 26;
      const x0 = cx - boxW / 2;
      const y0 = cy - boxH / 2;

      return `
        <g class="timeline-node" data-timeline-step="${ev.step}" tabindex="0" role="button" aria-label="Step ${ev.step}: ${escapeHtml(ev.txId)} ${escapeHtml(ev.opLabel)}">
          ${isSelected ? `<rect x="${x0 - 3}" y="${y0 - 3}" width="${boxW + 6}" height="${boxH + 6}" rx="6" fill="none" stroke="var(--accent)" stroke-width="1.6" />` : ''}
          <rect class="chip-bg" x="${x0}" y="${y0}" width="${boxW}" height="${boxH}" rx="4" fill="${fill}" stroke="${stroke}" stroke-opacity="0.55" stroke-width="1.15" ${dash} />
          ${ev.status !== 'BLOCKED' ? `<rect x="${x0}" y="${y0 + 1}" width="3" height="${boxH - 2}" rx="1.5" fill="${stroke}" />` : ''}
          <text x="${cx + (ev.status !== 'BLOCKED' ? 1.5 : 0)}" y="${cy + 3.8}" text-anchor="middle" font-family="var(--font-mono)" font-size="10" font-weight="600" fill="${textColor}">${escapeHtml(shortLabel.slice(0, 12))}</text>
          ${ev.isDirty ? `<circle cx="${x0 + boxW - 5}" cy="${y0 + 5}" r="3" fill="var(--danger)"><title>Dirty Read</title></circle>` : ''}
        </g>
      `;
    })
    .join('');

  return `
    <svg class="timeline-svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-label="Transaction execution timeline">
      ${laneBgSvg}
      ${gridSvg}
      ${lanesSvg}
      ${eventsSvg}
    </svg>
  `;
}

/* ==========================================================================
   8. UI CONTROLLER (TxnLabUI)
   Manages navigation, state rendering, timers, modals, and event delegation.
   ========================================================================== */

class TxnLabUI {
  constructor() {
    this.engine = new SimulationEngine();
    this.currentView = 'overview';
    this.activeWorkbenchTab = 'schedule';
    this.selectedTimelineStep = null;
    this.expandedDbKeys = new Set();
    this.includeAbortedInSerial = false;
    this.editingOp = null; // { txId, opIndex }
    this.docSearchQuery = '';
    this.lastTestResults = null;

    this.playTimer = null;
    this.isPlaying = false;

    const prefs = StorageManager.getPrefs();
    this.playSpeedMs = Number(prefs.speed) || 850;
    this.theme = prefs.theme === 'light' ? 'light' : 'dark';

    // Load an informative default scenario on boot so the workspace is immediately interactive
    this.engine.loadScenario(BUILTIN_SCENARIOS[1]); // Non-Repeatable Read

    this.applyTheme(this.theme);
    this.bindEvents();
    this.syncControls();
    this.renderAll();
  }

  /* ---- Theme & Playback Lifecycle ---- */

  applyTheme(theme) {
    this.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    const sun = document.getElementById('theme-icon-sun');
    const moon = document.getElementById('theme-icon-moon');
    if (sun && moon) {
      sun.hidden = theme !== 'dark';
      moon.hidden = theme === 'dark';
    }
    StorageManager.savePrefs({ theme });
  }

  stopPlayback() {
    if (this.playTimer !== null) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    this.isPlaying = false;
    this.updatePlayButton();
  }

  startPlayback() {
    if (this.isPlaying) return;
    if (this.engine.isCompleted()) {
      this.showToast('Simulation already completed. Reset to run again.', 'warn');
      return;
    }
    if (this.engine.getDeadlockState().hasDeadlock) {
      this.showToast('Cannot play while deadlocked. Resolve the deadlock first.', 'error');
      return;
    }

    this.isPlaying = true;
    this.updatePlayButton();
    this.renderHeaderAndSidebar();

    this.playTimer = setInterval(() => {
      const res = this.engine.stepNext();
      if (!res.ok) {
        this.stopPlayback();
        this.showToast(res.message, res.deadlock ? 'error' : 'warn');
        this.renderAll();
        return;
      }
      if (res.event) {
        this.selectedTimelineStep = res.event.step;
      }
      if (res.deadlock && res.deadlock.hasDeadlock) {
        this.stopPlayback();
        this.showToast('Deadlock detected! Playback paused for recovery.', 'error');
      } else if (this.engine.isCompleted()) {
        this.stopPlayback();
        this.showToast('Simulation completed.', 'success');
      }
      this.renderAll();
    }, this.playSpeedMs);
  }

  updatePlayButton() {
    const label = document.getElementById('play-pause-label');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    if (label) label.textContent = this.isPlaying ? 'Pause' : 'Play';
    if (iconPlay) iconPlay.hidden = this.isPlaying;
    if (iconPause) iconPause.hidden = !this.isPlaying;
  }

  showToast(message, variant = 'info') {
    const region = document.getElementById('toast-region');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${variant}`;
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3600);
  }

  /* ---- Navigation ---- */

  navigateTo(viewId) {
    const validViews = [
      'overview',
      'workbench',
      'isolation',
      'locks',
      'deadlock',
      'serializability',
      'scenarios',
      'docs',
      'tests'
    ];
    if (!validViews.includes(viewId)) return;

    // Cleanly pause timers when leaving active simulation views
    if (this.isPlaying && !['workbench', 'locks', 'deadlock', 'serializability'].includes(viewId)) {
      this.stopPlayback();
    }

    this.currentView = viewId;
    document.querySelectorAll('.view-section').forEach((sec) => {
      const match = sec.id === `view-${viewId}`;
      sec.hidden = !match;
      sec.classList.toggle('is-active', match);
    });

    document.querySelectorAll('.nav-item[data-nav]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.nav === viewId);
    });

    const titles = {
      overview: 'Overview',
      workbench: 'Transaction Workbench',
      isolation: 'Isolation Lab',
      locks: 'Lock Manager',
      deadlock: 'Deadlock Detector',
      serializability: 'Serializability Analyzer',
      scenarios: 'Scenario Library',
      docs: 'Documentation',
      tests: 'Engine Self-Tests'
    };
    const titleEl = document.getElementById('workspace-title');
    if (titleEl) titleEl.textContent = titles[viewId] || 'TxnLab';

    this.closeMobileSidebar();
    this.renderCurrentView();
  }

  openMobileSidebar() {
    document.getElementById('sidebar')?.classList.add('is-open');
    const bd = document.getElementById('sidebar-backdrop');
    if (bd) bd.hidden = false;
  }

  closeMobileSidebar() {
    document.getElementById('sidebar')?.classList.remove('is-open');
    const bd = document.getElementById('sidebar-backdrop');
    if (bd) bd.hidden = true;
  }

  openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) {
      el.hidden = false;
      const firstInput = el.querySelector('input, textarea, button');
      if (firstInput) firstInput.focus();
    }
  }

  closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.hidden = true;
  }

  closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach((m) => {
      m.hidden = true;
    });
  }

  syncControls() {
    const speedEl = document.getElementById('select-speed');
    if (speedEl) speedEl.value = String(this.playSpeedMs);
    document.querySelectorAll('[data-schedule-mode]').forEach((btn) => {
      const active = btn.dataset.scheduleMode === this.engine.schedulingMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    const isoEl = document.getElementById('select-wb-isolation');
    if (isoEl) isoEl.value = this.engine.isolationLevel;
  }

  /* ---- Actions ---- */

  handleReset() {
    this.stopPlayback();
    this.engine.reset();
    this.selectedTimelineStep = null;
    this.editingOp = null;
    this.renderAll();
    this.showToast('Simulation reset to initial state.', 'info');
  }

  handleStepNext() {
    this.stopPlayback();
    const res = this.engine.stepNext();
    if (!res.ok) {
      this.showToast(res.message, res.deadlock ? 'error' : 'warn');
    } else {
      if (res.event) this.selectedTimelineStep = res.event.step;
      if (res.deadlock && res.deadlock.hasDeadlock) {
        this.showToast('Deadlock detected! Inspect the Wait-For Graph to recover.', 'error');
      } else if (res.blocked) {
        this.showToast(res.event.detail, 'warn');
      }
    }
    this.renderAll();
  }

  handleStepTransaction(txId) {
    this.stopPlayback();
    const res = this.engine.stepTransaction(txId);
    if (!res.ok) {
      this.showToast(res.message, 'warn');
    } else {
      if (res.event) this.selectedTimelineStep = res.event.step;
      if (res.deadlock && res.deadlock.hasDeadlock) {
        this.showToast('Deadlock detected! Inspect the Wait-For Graph to recover.', 'error');
      } else if (res.blocked) {
        this.showToast(res.event.detail, 'warn');
      }
    }
    this.renderAll();
  }

  handleChangeIsolation(level) {
    if (level === this.engine.isolationLevel) return;
    this.stopPlayback();
    const hadProgress = this.engine.stepCount > 0;
    this.engine.setIsolationLevel(level);
    this.selectedTimelineStep = null;
    this.syncControls();
    this.renderAll();
    this.showToast(
      hadProgress
        ? `Isolation changed to ${ISOLATION_SPECS[level].label}. Simulation was reset.`
        : `Isolation set to ${ISOLATION_SPECS[level].label}.`,
      'info'
    );
  }

  handleLoadScenario(scenario, goToWorkbench = true) {
    this.stopPlayback();
    this.engine.loadScenario(scenario);
    this.selectedTimelineStep = null;
    this.editingOp = null;
    this.syncControls();
    if (goToWorkbench) {
      this.navigateTo('workbench');
    }
    this.renderAll();
    this.showToast(`Loaded scenario: ${scenario.name}`, 'success');
  }

  /* ---- Event Binding (Single Initialization, Clean Delegation) ---- */

  bindEvents() {
    // Global click delegation
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      // Navigation buttons
      const navBtn = target.closest('[data-nav]');
      if (navBtn) {
        this.navigateTo(navBtn.dataset.nav);
        return;
      }

      // Close modal buttons or backdrop click
      const closeModalBtn = target.closest('[data-close-modal]');
      if (closeModalBtn) {
        this.closeModal(closeModalBtn.dataset.closeModal);
        return;
      }
      if (target.classList.contains('modal-overlay')) {
        target.hidden = true;
        return;
      }

      // Simulation quick actions (used in Locks / Deadlock / Serializability headers)
      const simActionBtn = target.closest('[data-sim-action]');
      if (simActionBtn) {
        const act = simActionBtn.dataset.simAction;
        if (act === 'step') this.handleStepNext();
        if (act === 'reset') this.handleReset();
        return;
      }

      // Workbench Inspector Tabs
      const wbTab = target.closest('[data-wb-tab]');
      if (wbTab) {
        this.activeWorkbenchTab = wbTab.dataset.wbTab;
        this.renderWorkbenchInspectorTabs();
        return;
      }

      // Segmented scheduling mode toggle
      const schedModeBtn = target.closest('[data-schedule-mode]');
      if (schedModeBtn) {
        const mode = schedModeBtn.dataset.scheduleMode;
        if (mode !== this.engine.schedulingMode) {
          this.engine.setSchedulingMode(mode);
          this.syncControls();
          this.renderWorkbenchTransactions();
          this.showToast(
            mode === 'manual'
              ? 'Manual scheduling active: click Step on individual transactions.'
              : 'Auto Round-Robin scheduling active.',
            'info'
          );
        }
        return;
      }

      // Load scenario button
      const loadScenBtn = target.closest('[data-load-scenario]');
      if (loadScenBtn) {
        const id = loadScenBtn.dataset.loadScenario;
        const found =
          BUILTIN_SCENARIOS.find((s) => s.id === id) ||
          StorageManager.getCustomScenarios().find((s) => s.id === id);
        if (found) this.handleLoadScenario(found, true);
        return;
      }

      // Delete custom scenario button
      const delScenBtn = target.closest('[data-delete-scenario]');
      if (delScenBtn) {
        StorageManager.deleteCustomScenario(delScenBtn.dataset.deleteScenario);
        this.showToast('Custom scenario deleted.', 'info');
        this.renderScenariosView();
        return;
      }

      // Step specific transaction
      const stepTxBtn = target.closest('[data-step-tx]');
      if (stepTxBtn) {
        this.handleStepTransaction(stepTxBtn.dataset.stepTx);
        return;
      }

      // Remove transaction
      const remTxBtn = target.closest('[data-remove-tx]');
      if (remTxBtn) {
        try {
          this.engine.removeTransaction(remTxBtn.dataset.removeTx);
          this.renderAll();
        } catch (err) {
          this.showToast(err.message, 'warn');
        }
        return;
      }

      // Reorder operation
      const moveOpBtn = target.closest('[data-move-op]');
      if (moveOpBtn) {
        const [txId, idxStr, dirStr] = moveOpBtn.dataset.moveOp.split(':');
        try {
          this.engine.reorderOperation(txId, Number(idxStr), Number(dirStr));
          this.renderAll();
        } catch (err) {
          this.showToast(err.message, 'warn');
        }
        return;
      }

      // Remove operation
      const delOpBtn = target.closest('[data-delete-op]');
      if (delOpBtn) {
        const [txId, idxStr] = delOpBtn.dataset.deleteOp.split(':');
        try {
          this.engine.removeOperation(txId, Number(idxStr));
          this.renderAll();
        } catch (err) {
          this.showToast(err.message, 'warn');
        }
        return;
      }

      // Start inline edit operation
      const editOpBtn = target.closest('[data-edit-op]');
      if (editOpBtn) {
        if (this.engine.stepCount > 0) {
          this.showToast('Reset the simulation before editing operations.', 'warn');
          return;
        }
        const [txId, idxStr] = editOpBtn.dataset.editOp.split(':');
        this.editingOp = { txId, opIndex: Number(idxStr) };
        this.renderWorkbenchTransactions();
        return;
      }

      // Cancel inline edit operation
      if (target.closest('[data-cancel-edit-op]')) {
        this.editingOp = null;
        this.renderWorkbenchTransactions();
        return;
      }

      // Toggle DB version history
      const verBtn = target.closest('[data-toggle-versions]');
      if (verBtn) {
        const key = verBtn.dataset.toggleVersions;
        if (this.expandedDbKeys.has(key)) {
          this.expandedDbKeys.delete(key);
        } else {
          this.expandedDbKeys.add(key);
        }
        this.renderDatabaseState();
        return;
      }

      // Timeline event node click
      const timelineNode = target.closest('[data-timeline-step]');
      if (timelineNode) {
        this.selectedTimelineStep = Number(timelineNode.dataset.timelineStep);
        this.renderTimeline();
        return;
      }

      // Isolation selector card click
      const isoBtn = target.closest('[data-select-isolation]');
      if (isoBtn) {
        this.handleChangeIsolation(isoBtn.dataset.selectIsolation);
        return;
      }

      // Deadlock victim recovery button
      const abortVictimBtn = target.closest('#btn-abort-victim');
      if (abortVictimBtn) {
        const checked = document.querySelector('input[name="deadlock-victim"]:checked');
        if (!checked) {
          this.showToast('Select a transaction to abort as the deadlock victim.', 'warn');
          return;
        }
        const victimId = checked.value;
        const res = this.engine.abortTransaction(victimId, 'DEADLOCK_VICTIM');
        if (res.ok) {
          this.selectedTimelineStep = res.event.step;
          this.showToast(`Aborted ${victimId}, rolled back writes, and released its locks.`, 'success');
          this.renderAll();
        } else {
          this.showToast(res.message, 'error');
        }
        return;
      }

      // Documentation TOC jump
      const docJump = target.closest('[data-doc-jump]');
      if (docJump) {
        const article = document.getElementById(`doc-article-${docJump.dataset.docJump}`);
        if (article) article.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    });

    // Hover on timeline event updates event inspector without rebuilding SVG
    document.addEventListener('mouseover', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const node = target.closest('[data-timeline-step]');
      if (node) {
        const step = Number(node.dataset.timelineStep);
        this.renderEventInspector(step);
      }
    });

    // Delegated form submissions (inline add/edit op forms)
    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      if (form.matches('[data-add-op-form]')) {
        e.preventDefault();
        const txId = form.dataset.addOpForm;
        const type = form.querySelector('[name="opType"]').value;
        const key = form.querySelector('[name="opKey"]')?.value;
        const value = form.querySelector('[name="opValue"]')?.value;
        try {
          this.engine.addOperation(txId, { type, key, value });
          this.renderAll();
        } catch (err) {
          this.showToast(err.message, 'error');
        }
        return;
      }

      if (form.matches('[data-edit-op-form]')) {
        e.preventDefault();
        const [txId, idxStr] = form.dataset.editOpForm.split(':');
        const type = form.querySelector('[name="editType"]').value;
        const key = form.querySelector('[name="editKey"]')?.value;
        const value = form.querySelector('[name="editValue"]')?.value;
        try {
          this.engine.updateOperation(txId, Number(idxStr), { type, key, value });
          this.editingOp = null;
          this.renderAll();
        } catch (err) {
          this.showToast(err.message, 'error');
        }
      }
    });

    // Delegated change events for dynamic operation type selects & initial DB inputs
    document.addEventListener('change', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.matches('[data-op-type-select]')) {
        const form = target.closest('form');
        if (!form) return;
        const type = target.value;
        const keyEl = form.querySelector('[name="opKey"], [name="editKey"]');
        const valEl = form.querySelector('[name="opValue"], [name="editValue"]');
        if (keyEl) keyEl.disabled = type === 'COMMIT' || type === 'ROLLBACK';
        if (valEl) valEl.disabled = type !== 'WRITE';
        return;
      }

      if (target.matches('[data-db-init-key]')) {
        const key = target.dataset.dbInitKey;
        try {
          this.engine.updateDatabaseInitialValue(key, target.value);
          this.renderAll();
          this.showToast(`Updated initial value of ${key}.`, 'info');
        } catch (err) {
          this.showToast(err.message, 'error');
          this.renderDatabaseState();
        }
      }
    });

    // Static element listeners
    document.getElementById('btn-open-sidebar')?.addEventListener('click', () => this.openMobileSidebar());
    document.getElementById('btn-close-sidebar')?.addEventListener('click', () => this.closeMobileSidebar());
    document.getElementById('sidebar-backdrop')?.addEventListener('click', () => this.closeMobileSidebar());

    document.getElementById('btn-header-reset')?.addEventListener('click', () => this.handleReset());
    document.getElementById('btn-wb-reset')?.addEventListener('click', () => this.handleReset());
    document.getElementById('header-isolation-btn')?.addEventListener('click', () => this.navigateTo('isolation'));
    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
      this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');
    });
    document.getElementById('btn-help-open')?.addEventListener('click', () => this.openModal('modal-help'));

    document.getElementById('btn-step')?.addEventListener('click', () => this.handleStepNext());
    document.getElementById('btn-play-pause')?.addEventListener('click', () => {
      if (this.isPlaying) this.stopPlayback();
      else this.startPlayback();
    });

    document.getElementById('select-speed')?.addEventListener('change', (e) => {
      this.playSpeedMs = Number(e.target.value);
      StorageManager.savePrefs({ speed: this.playSpeedMs });
      if (this.isPlaying) {
        this.stopPlayback();
        this.startPlayback();
      }
    });

    document.getElementById('select-wb-isolation')?.addEventListener('change', (e) => {
      this.handleChangeIsolation(e.target.value);
    });

    document.getElementById('btn-add-txn')?.addEventListener('click', () => {
      try {
        const id = this.engine.addTransaction();
        this.renderAll();
        this.showToast(`Added transaction ${id}.`, 'info');
      } catch (err) {
        this.showToast(err.message, 'warn');
      }
    });

    document.getElementById('btn-save-scenario-open')?.addEventListener('click', () => {
      this.openModal('modal-save-scenario');
    });
    document.getElementById('btn-save-current-from-lib')?.addEventListener('click', () => {
      this.openModal('modal-save-scenario');
    });

    document.getElementById('form-save-scenario')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('input-scenario-name');
      const descInput = document.getElementById('input-scenario-desc');
      const name = nameInput.value.trim();
      if (!name) return;

      const scenarioObj = {
        name,
        category: 'Custom',
        isolationLevel: this.engine.isolationLevel,
        description: descInput.value.trim() || 'User-created transaction schedule.',
        initialDb: { ...this.engine.db.initialValues },
        transactions: this.engine.transactionDefs.map((t) => ({
          id: t.id,
          operations: t.operations.map((o) => ({
            type: o.type,
            ...(o.key !== undefined ? { key: o.key } : {}),
            ...(o.value !== undefined ? { value: o.value } : {})
          }))
        }))
      };

      StorageManager.saveCustomScenario(scenarioObj);
      this.engine.activeScenarioName = name;
      nameInput.value = '';
      descInput.value = '';
      this.closeModal('modal-save-scenario');
      this.renderAll();
      this.showToast(`Saved "${name}" to localStorage.`, 'success');
    });

    document.getElementById('btn-add-key-open')?.addEventListener('click', () => {
      this.openModal('modal-add-key');
    });

    document.getElementById('form-add-key')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const keyInput = document.getElementById('input-key-name');
      const valInput = document.getElementById('input-key-value');
      try {
        this.stopPlayback();
        const created = this.engine.addDatabaseKey(keyInput.value, valInput.value);
        keyInput.value = '';
        valInput.value = '';
        this.closeModal('modal-add-key');
        this.renderAll();
        this.showToast(`Added database key ${created}. Simulation reset.`, 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    document.getElementById('btn-load-deadlock-demo')?.addEventListener('click', () => {
      const demo = BUILTIN_SCENARIOS.find((s) => s.id === 'deadlock-demo');
      if (demo) this.handleLoadScenario(demo, false);
    });

    document.getElementById('btn-load-nonserial-demo')?.addEventListener('click', () => {
      const demo = BUILTIN_SCENARIOS.find((s) => s.id === 'non-serializable');
      if (demo) this.handleLoadScenario(demo, false);
    });

    document.getElementById('toggle-include-aborted')?.addEventListener('change', (e) => {
      this.includeAbortedInSerial = e.target.checked;
      this.renderSerializabilityView();
    });

    document.getElementById('docs-search-input')?.addEventListener('input', (e) => {
      this.docSearchQuery = e.target.value.trim().toLowerCase();
      this.renderDocsView();
    });

    document.getElementById('btn-run-tests')?.addEventListener('click', () => {
      this.lastTestResults = SelfTestRunner.runAll();
      this.renderTestsView();
      this.renderHeaderAndSidebar();
      const passedCount = this.lastTestResults.filter((r) => r.passed).length;
      this.showToast(
        `Self-tests finished: ${passedCount}/${this.lastTestResults.length} passed.`,
        passedCount === this.lastTestResults.length ? 'success' : 'error'
      );
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeAllModals();
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (this.currentView === 'workbench') {
        if (e.code === 'Space') {
          e.preventDefault();
          this.handleStepNext();
        } else if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          if (this.isPlaying) this.stopPlayback();
          else this.startPlayback();
        } else if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          this.handleReset();
        }
      }
    });
  }

  /* ---- Master Renderers ---- */

  renderAll() {
    this.renderHeaderAndSidebar();
    this.renderCurrentView();
  }

  renderCurrentView() {
    switch (this.currentView) {
      case 'overview':
        this.renderOverviewView();
        break;
      case 'workbench':
        this.renderWorkbenchView();
        break;
      case 'isolation':
        this.renderIsolationView();
        break;
      case 'locks':
        this.renderLockManagerView();
        break;
      case 'deadlock':
        this.renderDeadlockView();
        break;
      case 'serializability':
        this.renderSerializabilityView();
        break;
      case 'scenarios':
        this.renderScenariosView();
        break;
      case 'docs':
        this.renderDocsView();
        break;
      case 'tests':
        this.renderTestsView();
        break;
    }
  }

  renderHeaderAndSidebar() {
    const status = this.engine.getStatusSummary();
    const statusEl = document.getElementById('header-sim-status');
    if (statusEl) {
      const displayLabel = this.isPlaying ? 'Running' : status.label;
      statusEl.textContent = displayLabel;
      statusEl.className = `header-metric-value status-${
        this.isPlaying ? 'running' : status.code.toLowerCase()
      }`;
    }

    const isoBtn = document.getElementById('header-isolation-btn');
    if (isoBtn) {
      isoBtn.textContent = ISOLATION_SPECS[this.engine.isolationLevel].label;
    }

    const lockCount = this.engine.lockManager.getActiveLockCount();
    const lockCounterEl = document.getElementById('nav-lock-count');
    if (lockCounterEl) lockCounterEl.textContent = String(lockCount);

    const dl = this.engine.getDeadlockState();
    const dlFlag = document.getElementById('nav-deadlock-flag');
    if (dlFlag) dlFlag.hidden = !dl.hasDeadlock;

    const scenName = document.getElementById('sidebar-scenario-name');
    if (scenName) scenName.textContent = this.engine.activeScenarioName;

    const stepEl = document.getElementById('sidebar-step-count');
    if (stepEl) stepEl.textContent = `Step ${this.engine.stepCount}`;

    if (this.lastTestResults) {
      const passed = this.lastTestResults.filter((r) => r.passed).length;
      const testBadge = document.getElementById('nav-test-summary');
      if (testBadge) testBadge.textContent = `${passed}/${this.lastTestResults.length}`;
    }
  }

  /* ---- 1. Overview Renderer ---- */

  renderOverviewView() {
    const anomalies = AnomalyDetector.analyze(this.engine);
    const dl = this.engine.getDeadlockState();
    const lockCount = this.engine.lockManager.getActiveLockCount();
    const committed = this.engine.transactions.filter((t) => t.state === 'COMMITTED').length;

    const metricsEl = document.getElementById('overview-metrics');
    if (metricsEl) {
      metricsEl.innerHTML = `
        <div class="metric-block">
          <div class="metric-label">Active Scenario</div>
          <div class="metric-value truncate" title="${escapeHtml(this.engine.activeScenarioName)}">${escapeHtml(this.engine.activeScenarioName)}</div>
          <div class="metric-sub mono">${ISOLATION_SPECS[this.engine.isolationLevel].label}</div>
        </div>
        <div class="metric-block">
          <div class="metric-label">Executed Steps</div>
          <div class="metric-value mono">${this.engine.stepCount}</div>
          <div class="metric-sub">${this.engine.transactions.length} transactions · ${committed} committed</div>
        </div>
        <div class="metric-block">
          <div class="metric-label">Active Locks</div>
          <div class="metric-value mono">${lockCount}</div>
          <div class="metric-sub">${this.engine.lockManager.getLockTableRows().length} locked resources</div>
        </div>
        <div class="metric-block">
          <div class="metric-label">Detected Anomalies</div>
          <div class="metric-value mono">${anomalies.length}</div>
          <div class="metric-sub">${anomalies.length > 0 ? escapeHtml(anomalies[0].name) : 'None observed yet'}</div>
        </div>
        <div class="metric-block">
          <div class="metric-label">Deadlock Monitor</div>
          <div class="metric-value">${dl.hasDeadlock ? 'Cycle Found' : 'Clear'}</div>
          <div class="metric-sub">${dl.hasDeadlock ? escapeHtml(dl.cycles[0].nodes.join(' → ')) : 'No circular wait'}</div>
        </div>
      `;
    }

    const listEl = document.getElementById('overview-scenario-list');
    if (listEl) {
      listEl.innerHTML = BUILTIN_SCENARIOS.slice(0, 6)
        .map(
          (s) => `
          <div class="scenario-quick-row">
            <div class="scenario-quick-info">
              <div class="scenario-quick-title">${escapeHtml(s.name)}</div>
              <div class="scenario-quick-meta">
                <span>${escapeHtml(s.category)}</span>
                <span aria-hidden="true"> &middot; </span>
                <span class="mono">${escapeHtml(ISOLATION_SPECS[s.isolationLevel].label)}</span>
                <span aria-hidden="true"> &middot; </span>
                <span>${s.transactions.length} transactions</span>
              </div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" data-load-scenario="${escapeHtml(s.id)}">Load</button>
          </div>
        `
        )
        .join('');
    }
  }

  /* ---- 2. Transaction Workbench Renderer ---- */

  renderWorkbenchView() {
    this.syncControls();

    const dl = this.engine.getDeadlockState();
    const dlBanner = document.getElementById('wb-deadlock-banner');
    const dlText = document.getElementById('wb-deadlock-text');
    if (dlBanner && dlText) {
      dlBanner.hidden = !dl.hasDeadlock;
      if (dl.hasDeadlock) {
        const chain = dl.cycles.map((c) => c.nodes.join(' → ')).join('; ');
        dlText.textContent = `Circular lock wait detected (${chain}). Open Deadlock Detector to select a victim transaction.`;
      }
    }

    this.renderWorkbenchTransactions();
    this.renderTimeline();
    this.renderDatabaseState();
    this.renderWorkbenchInspectorTabs();
  }

  renderWorkbenchTransactions() {
    const container = document.getElementById('wb-transactions-container');
    const summaryEl = document.getElementById('wb-txn-summary');
    const hintEl = document.getElementById('wb-txn-hint');
    if (!container) return;

    const lockedForEdits = this.engine.stepCount > 0;
    const keys = this.engine.db.getKeys();
    const keyOptionsHtml = keys
      .map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`)
      .join('');

    if (summaryEl) {
      const blocked = this.engine.transactions.filter((t) => t.state === 'BLOCKED').length;
      summaryEl.textContent = `${this.engine.transactions.length} txns${blocked ? ` · ${blocked} blocked` : ''}`;
    }
    if (hintEl) {
      hintEl.textContent = lockedForEdits
        ? 'Simulation in progress. Reset to reorder, edit, or remove operations.'
        : this.engine.schedulingMode === 'manual'
          ? 'Manual mode: click Step on any eligible transaction card to control exact interleaving.'
          : 'Edit or reorder operations before stepping, or click Step / Play to run round-robin.';
    }

    if (this.engine.transactions.length === 0) {
      container.innerHTML =
        '<div class="empty-state">No transactions defined. Click "+ Transaction" to create one.</div>';
      return;
    }

    container.innerHTML = this.engine.transactions
      .map((tx) => {
        const stateClass =
          tx.state === 'COMMITTED'
            ? 'state-ok'
            : tx.state === 'ABORTED'
              ? 'state-danger'
              : tx.state === 'BLOCKED'
                ? 'state-blocked'
                : 'state-info';

        const canStep = tx.state === 'ACTIVE' && tx.pc < tx.operations.length;

        const opsHtml =
          tx.operations.length === 0
            ? '<div class="empty-state">No operations yet.</div>'
            : tx.operations
                .map((op, idx) => {
                  const isEditing =
                    this.editingOp &&
                    this.editingOp.txId === tx.id &&
                    this.editingOp.opIndex === idx;

                  if (isEditing && !lockedForEdits) {
                    const isTerm = op.type === 'COMMIT' || op.type === 'ROLLBACK';
                    return `
                      <form class="txn-add-op-form" data-edit-op-form="${escapeHtml(tx.id)}:${idx}">
                        <select name="editType" class="select-input mono" data-op-type-select>
                          <option value="READ" ${op.type === 'READ' ? 'selected' : ''}>READ</option>
                          <option value="WRITE" ${op.type === 'WRITE' ? 'selected' : ''}>WRITE</option>
                          <option value="COMMIT" ${op.type === 'COMMIT' ? 'selected' : ''}>COMMIT</option>
                          <option value="ROLLBACK" ${op.type === 'ROLLBACK' ? 'selected' : ''}>ROLLBACK</option>
                        </select>
                        <select name="editKey" class="select-input mono" ${isTerm ? 'disabled' : ''}>
                          ${keys.map((k) => `<option value="${escapeHtml(k)}" ${op.key === k ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('')}
                        </select>
                        <input name="editValue" type="text" class="text-input mono" value="${op.value !== undefined ? escapeHtml(op.value) : ''}" placeholder="val" ${op.type !== 'WRITE' ? 'disabled' : ''} />
                        <div style="display:flex;gap:3px;">
                          <button type="submit" class="btn btn-primary btn-xs">Save</button>
                          <button type="button" class="btn btn-ghost btn-xs" data-cancel-edit-op>Esc</button>
                        </div>
                      </form>
                    `;
                  }

                  const isExecuted = idx < tx.pc;
                  const isCurrent = idx === tx.pc && (tx.state === 'ACTIVE' || tx.state === 'BLOCKED');
                  const isBlockedOp = isCurrent && tx.state === 'BLOCKED';
                  const rowClasses = [
                    'txn-op-row',
                    isExecuted ? 'is-executed' : '',
                    isCurrent && !isBlockedOp ? 'is-current' : '',
                    isBlockedOp ? 'is-blocked' : ''
                  ]
                    .filter(Boolean)
                    .join(' ');

                  const pointer = isBlockedOp
                    ? '!'
                    : isCurrent
                      ? '&#9654;'
                      : isExecuted
                        ? '&#10003;'
                        : '';

                  const isTerm = op.type === 'COMMIT' || op.type === 'ROLLBACK';
                  const controlsHtml = lockedForEdits
                    ? ''
                    : `
                      <div class="txn-op-controls">
                        <button type="button" class="op-mini-btn" data-move-op="${escapeHtml(tx.id)}:${idx}:-1" title="Move up" ${idx === 0 || isTerm ? 'disabled' : ''}>&#8593;</button>
                        <button type="button" class="op-mini-btn" data-move-op="${escapeHtml(tx.id)}:${idx}:1" title="Move down" ${idx === tx.operations.length - 1 || isTerm ? 'disabled' : ''}>&#8595;</button>
                        <button type="button" class="op-mini-btn" data-edit-op="${escapeHtml(tx.id)}:${idx}" title="Edit operation">Edit</button>
                        <button type="button" class="op-mini-btn" data-delete-op="${escapeHtml(tx.id)}:${idx}" title="Remove operation">&times;</button>
                      </div>
                    `;

                  const lineNum = String(idx + 1).padStart(2, '0');
                  const opArgs =
                    op.type === 'READ'
                      ? `(${op.key})`
                      : op.type === 'WRITE'
                        ? `(${op.key}, ${op.value})`
                        : '';

                  return `
                    <div class="${rowClasses}">
                      <div class="txn-op-main">
                        <span class="op-line-num">${lineNum}</span>
                        <span class="op-pointer" aria-hidden="true">${pointer}</span>
                        <span class="op-code"><span class="op-verb op-type-${op.type}">${escapeHtml(op.type)}</span><span class="op-args">${escapeHtml(opArgs)}</span></span>
                      </div>
                      ${controlsHtml}
                    </div>
                  `;
                })
                .join('');

        const blockedCallout =
          tx.state === 'BLOCKED' && tx.blockedInfo
            ? `<div class="txn-blocked-note"><strong>Blocked:</strong> ${escapeHtml(tx.blockedInfo.reason)}</div>`
            : '';

        const addOpForm = lockedForEdits
          ? ''
          : `
            <form class="txn-add-op-form" data-add-op-form="${escapeHtml(tx.id)}">
              <select name="opType" class="select-input mono" data-op-type-select aria-label="Operation type for ${escapeHtml(tx.id)}">
                <option value="READ">READ</option>
                <option value="WRITE">WRITE</option>
                <option value="COMMIT">COMMIT</option>
                <option value="ROLLBACK">ROLLBACK</option>
              </select>
              <select name="opKey" class="select-input mono" aria-label="Key for ${escapeHtml(tx.id)}">
                ${keyOptionsHtml}
              </select>
              <input name="opValue" type="text" class="text-input mono" placeholder="Value" disabled aria-label="Write value for ${escapeHtml(tx.id)}" />
              <button type="submit" class="btn btn-secondary btn-xs">+ Add</button>
            </form>
          `;

        const readSummary =
          tx.readSet.length > 0
            ? tx.readSet.map((r) => `${r.key}=${r.value}${r.isDirty ? '*' : ''}`).join(', ')
            : '—';
        const writeSummary =
          tx.writeSet.length > 0
            ? tx.writeSet.map((w) => `${w.key}=${w.value}`).join(', ')
            : '—';
        const heldLocks = this.engine.lockManager.getHeldLocksForTx(tx.id);
        const lockSummary =
          heldLocks.length > 0
            ? heldLocks.map((l) => `${l.mode}(${l.resource})`).join(', ')
            : 'None';

        const stepRange =
          tx.startStep !== null
            ? `S${tx.startStep}${tx.endStep !== null ? `–S${tx.endStep}` : '–...'}`
            : 'Idle';
        const swatchColor = getTxnAccentColor(tx.id);

        return `
          <article class="txn-card txn-state-${tx.state.toLowerCase()}">
            <div class="txn-card-head">
              <div class="txn-head-left">
                <span class="txn-swatch" style="background-color:${swatchColor};" aria-hidden="true"></span>
                <span class="txn-id mono">${escapeHtml(tx.id)}</span>
                <span class="state-tag ${stateClass}">${escapeHtml(tx.state)}</span>
              </div>
              <div class="txn-head-actions">
                <button
                  type="button"
                  class="btn ${this.engine.schedulingMode === 'manual' && canStep ? 'btn-primary' : 'btn-secondary'} btn-xs"
                  data-step-tx="${escapeHtml(tx.id)}"
                  ${canStep ? '' : 'disabled'}
                  title="Execute next operation in ${escapeHtml(tx.id)}"
                >
                  Step ${escapeHtml(tx.id)}
                </button>
                ${
                  !lockedForEdits
                    ? `<button type="button" class="op-mini-btn" data-remove-tx="${escapeHtml(tx.id)}" title="Remove ${escapeHtml(tx.id)}" aria-label="Remove ${escapeHtml(tx.id)}">&times;</button>`
                    : ''
                }
              </div>
            </div>
            <div class="txn-ops-list">${opsHtml}</div>
            ${blockedCallout}
            ${addOpForm}
            <div class="txn-meta-footer">
              <div class="txn-meta-cell">
                <span class="txn-meta-k">Read Set</span>
                <span class="txn-meta-v mono" title="${escapeHtml(readSummary)}">${escapeHtml(readSummary)}</span>
              </div>
              <div class="txn-meta-cell">
                <span class="txn-meta-k">Write Set</span>
                <span class="txn-meta-v mono" title="${escapeHtml(writeSummary)}">${escapeHtml(writeSummary)}</span>
              </div>
              <div class="txn-meta-cell">
                <span class="txn-meta-k">Held Locks</span>
                <span class="txn-meta-v mono" title="${escapeHtml(lockSummary)}">${escapeHtml(lockSummary)}</span>
              </div>
              <div class="txn-meta-cell">
                <span class="txn-meta-k">Execution Window</span>
                <span class="txn-meta-v mono">${escapeHtml(stepRange)}</span>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  renderTimeline() {
    const container = document.getElementById('wb-timeline-container');
    if (container) {
      container.innerHTML = renderTimelineSVG(
        this.engine.transactions,
        this.engine.executionHistory,
        this.selectedTimelineStep
      );
    }
    this.renderEventInspector(this.selectedTimelineStep);
  }

  renderEventInspector(step) {
    const el = document.getElementById('wb-event-inspector');
    if (!el) return;
    if (!step) {
      el.innerHTML =
        '<span class="muted">Click or hover an event in the timeline to inspect values, lock changes, and blocking details.</span>';
      return;
    }
    const ev = this.engine.executionHistory.find((e) => e.step === step);
    if (!ev) {
      el.innerHTML = '<span class="muted">Select an operation in the timeline to inspect details.</span>';
      return;
    }

    const badgeClass =
      ev.status === 'BLOCKED'
        ? 'state-blocked'
        : ev.opType === 'COMMIT'
          ? 'state-ok'
          : ev.opType === 'ROLLBACK'
            ? 'state-danger'
            : 'state-info';

    el.innerHTML = `
      <div>
        <span class="mono"><strong>Step ${ev.step}</strong> &middot; ${escapeHtml(ev.txId)} &middot; ${escapeHtml(ev.opLabel)}</span>
        <div class="muted" style="margin-top:2px;">${escapeHtml(ev.detail)}</div>
      </div>
      <span class="state-tag ${badgeClass}">${escapeHtml(ev.status)}</span>
    `;
  }

  renderDatabaseState() {
    const container = document.getElementById('wb-db-state-container');
    if (!container) return;

    const rows = this.engine.db.getSnapshot();
    const canEditInitial = this.engine.stepCount === 0;

    if (rows.length === 0) {
      container.innerHTML = '<div class="empty-state">No database keys configured.</div>';
      return;
    }

    container.innerHTML = `
      <div class="db-key-list">
        ${rows
          .map((row) => {
            const hasUncommitted = row.uncommittedWrites.length > 0;
            const expanded = this.expandedDbKeys.has(row.key);
            const uncommittedHtml = hasUncommitted
              ? row.uncommittedWrites
                  .map(
                    (u) =>
                      `<span class="db-uncommitted-val mono">${escapeHtml(String(u.value))} <span class="muted">(${escapeHtml(u.txId)} uncommitted)</span></span>`
                  )
                  .join(', ')
              : '<span class="muted">None</span>';

            const versionsHtml = expanded
              ? `
                <div class="db-version-history">
                  ${row.versionHistory
                    .slice()
                    .reverse()
                    .map(
                      (v) => `
                        <div class="db-version-entry mono">
                          <span>v${v.version} · S${v.step} · ${escapeHtml(v.txId)}</span>
                          <span>${escapeHtml(String(v.value))} (${escapeHtml(v.status)})</span>
                        </div>
                      `
                    )
                    .join('')}
                </div>
              `
              : '';

            return `
              <div class="db-key-row">
                <div class="db-key-top">
                  <span class="db-key-name mono">${escapeHtml(row.key)}</span>
                  <div style="display:flex;align-items:center;gap:8px;">
                    ${
                      canEditInitial
                        ? `<label class="inline-control"><span class="muted" style="font-size:11px;">Init</span><input type="text" class="text-input mono db-init-input" data-db-init-key="${escapeHtml(row.key)}" value="${escapeHtml(String(row.initialValue))}" aria-label="Initial value for ${escapeHtml(row.key)}" /></label>`
                        : `<span class="muted mono" style="font-size:11px;">Last committed by ${escapeHtml(row.lastCommittedBy)}</span>`
                    }
                    <button type="button" class="db-version-toggle" data-toggle-versions="${escapeHtml(row.key)}">
                      ${expanded ? 'Hide history' : `History (${row.versionHistory.length})`}
                    </button>
                  </div>
                </div>
                <div class="db-values-row">
                  <span>Committed: <span class="db-committed-val mono">${escapeHtml(String(row.committedValue))}</span></span>
                  <span>Pending writes: ${uncommittedHtml}</span>
                </div>
                ${versionsHtml}
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  renderWorkbenchInspectorTabs() {
    const history = this.engine.executionHistory;
    const lockRows = this.engine.lockManager.getLockTableRows();
    const anomalies = AnomalyDetector.analyze(this.engine);

    const cSched = document.getElementById('tab-count-schedule');
    const cLocks = document.getElementById('tab-count-locks');
    const cAnom = document.getElementById('tab-count-anomalies');
    if (cSched) cSched.textContent = String(history.length);
    if (cLocks) cLocks.textContent = String(this.engine.lockManager.getActiveLockCount());
    if (cAnom) {
      cAnom.textContent = String(anomalies.length);
      cAnom.classList.toggle('has-alert', anomalies.length > 0);
    }

    document.querySelectorAll('[data-wb-tab]').forEach((btn) => {
      const active = btn.dataset.wbTab === this.activeWorkbenchTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    ['schedule', 'locks', 'anomalies'].forEach((tab) => {
      const panel = document.getElementById(`wb-tab-${tab}`);
      if (panel) {
        const active = tab === this.activeWorkbenchTab;
        panel.hidden = !active;
        panel.classList.toggle('is-active', active);
      }
    });

    // Schedule tab content
    const schedPanel = document.getElementById('wb-tab-schedule');
    if (schedPanel) {
      if (history.length === 0) {
        schedPanel.innerHTML =
          '<div class="empty-state">No operations executed yet. Click Step or Play to begin.</div>';
      } else {
        schedPanel.innerHTML = `
          <table class="data-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Txn</th>
                <th>Operation</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              ${history
                .slice()
                .reverse()
                .map((ev) => {
                  const tagCls =
                    ev.status === 'BLOCKED'
                      ? 'state-blocked'
                      : ev.opType === 'COMMIT'
                        ? 'state-ok'
                        : ev.opType === 'ROLLBACK'
                          ? 'state-danger'
                          : 'state-info';
                  return `
                    <tr>
                      <td class="mono">S${ev.step}</td>
                      <td class="mono">${escapeHtml(ev.txId)}</td>
                      <td>
                        <div class="mono">${escapeHtml(ev.opLabel)}</div>
                        <div class="muted" style="font-size:11px;">${escapeHtml(ev.detail)}</div>
                      </td>
                      <td><span class="state-tag ${tagCls}">${escapeHtml(ev.status)}</span></td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        `;
      }
    }

    // Locks tab content
    const locksPanel = document.getElementById('wb-tab-locks');
    if (locksPanel) {
      locksPanel.innerHTML = this._buildLockTableHtml(lockRows);
    }

    // Anomalies tab content
    const anomPanel = document.getElementById('wb-tab-anomalies');
    if (anomPanel) {
      if (anomalies.length === 0) {
        anomPanel.innerHTML =
          '<div class="empty-state">No concurrency anomalies detected in the executed schedule so far.</div>';
      } else {
        anomPanel.innerHTML = `
          <div class="anomaly-list">
            ${anomalies
              .map(
                (a) => `
                  <div class="anomaly-card">
                    <div class="anomaly-head">
                      <span class="anomaly-name">${escapeHtml(a.name)}</span>
                      <span class="state-tag ${a.severity === 'HIGH' ? 'state-danger' : 'state-warn'}">${escapeHtml(a.severity)}</span>
                    </div>
                    <div class="anomaly-meta mono">Involved: ${escapeHtml(a.transactions.join(', '))}</div>
                    <p class="anomaly-desc">${escapeHtml(a.explanation)}</p>
                    <div class="scenario-preview-code">${escapeHtml(a.operations.join('\n'))}</div>
                    <div class="anomaly-fix"><strong>Prevention:</strong> ${escapeHtml(a.prevention)}</div>
                  </div>
                `
              )
              .join('')}
          </div>
        `;
      }
    }
  }

  _buildLockTableHtml(rows) {
    if (!rows || rows.length === 0) {
      return '<div class="empty-state">No active locks or queued lock requests.</div>';
    }
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Lock Type</th>
              <th>Owner</th>
              <th>Waiting</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((row) => {
                const ownerText =
                  row.owners.length > 0
                    ? row.owners.map((o) => `${o.txId} (${o.mode})`).join(', ')
                    : '—';
                const waitText =
                  row.waiting.length > 0
                    ? row.waiting.map((w) => `${w.txId} req ${w.mode}`).join(', ')
                    : '—';
                const typeClass = row.lockType.includes('X') ? 'state-warn' : 'state-info';
                return `
                  <tr>
                    <td class="mono"><strong>${escapeHtml(row.resource)}</strong></td>
                    <td><span class="state-tag ${typeClass} mono">${escapeHtml(row.lockType)}</span></td>
                    <td class="mono">${escapeHtml(ownerText)}</td>
                    <td class="mono">${escapeHtml(waitText)}</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /* ---- 3. Isolation Lab Renderer ---- */

  renderIsolationView() {
    const current = ISOLATION_SPECS[this.engine.isolationLevel];

    const barEl = document.getElementById('isolation-selector-bar');
    if (barEl) {
      barEl.innerHTML = Object.values(ISOLATION_SPECS)
        .map(
          (spec, idx) => `
          <button
            type="button"
            class="iso-select-btn ${spec.id === current.id ? 'is-active' : ''}"
            data-select-isolation="${spec.id}"
            role="radio"
            aria-checked="${spec.id === current.id}"
          >
            <span class="iso-step-num">Level 0${idx + 1}</span>
            <span class="iso-btn-title">${escapeHtml(spec.label)}</span>
            <span class="iso-btn-sub">${escapeHtml(spec.shortDesc)}</span>
          </button>
        `
        )
        .join('');
    }

    const detailEl = document.getElementById('isolation-detail-container');
    if (detailEl) {
      detailEl.innerHTML = `
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title mono">${escapeHtml(current.label)}</h3>
              <p class="panel-subtitle">Active teaching semantics enforced by the simulation engine.</p>
            </div>
            <button type="button" class="btn btn-primary btn-sm" data-load-scenario="${escapeHtml(current.recommendedScenario)}">
              Test in Workbench
            </button>
          </div>
          <div class="spec-list">
            <div class="spec-row">
              <div class="spec-label">Reads Allowed</div>
              <div class="spec-value">${escapeHtml(current.readsAllowed)}</div>
            </div>
            <div class="spec-row">
              <div class="spec-label">Reads Prevented</div>
              <div class="spec-value">${escapeHtml(current.readsPrevented)}</div>
            </div>
            <div class="spec-row">
              <div class="spec-label">Lock Acquisition &amp; Release Timing</div>
              <div class="spec-value">${escapeHtml(current.lockBehavior)}</div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">Possible Anomalies &amp; Model Caveats</h3>
              <p class="panel-subtitle">Explicit boundaries of this simplified simulator.</p>
            </div>
          </div>
          <div class="spec-list">
            <div class="spec-row">
              <div class="spec-label">Anomalies That May Occur</div>
              <div class="spec-value">${escapeHtml(current.anomaliesPossible.join(' · '))}</div>
            </div>
            <div class="spec-row">
              <div class="spec-label">Model Limitations &amp; Real DBMS Differences</div>
              <div class="spec-value">${escapeHtml(current.limitations)}</div>
            </div>
          </div>
          <div class="honesty-note" style="margin-top:12px;">
            Real database systems do not implement isolation levels identically. PostgreSQL, MySQL InnoDB, SQL Server, and Oracle combine MVCC snapshots, row/gap locks, and SSI in vendor-specific ways.
          </div>
        </div>
      `;
    }

    const matrixEl = document.getElementById('isolation-matrix-container');
    if (matrixEl) {
      const levels = Object.values(ISOLATION_SPECS);
      matrixEl.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Isolation Level</th>
              <th>Dirty Reads</th>
              <th>Non-Repeatable Reads</th>
              <th>Lost Updates</th>
              <th>Phantom Reads</th>
              <th>Locking Behavior (TxnLab)</th>
              <th>Concurrency Impact</th>
            </tr>
          </thead>
          <tbody>
            ${levels
              .map((lvl) => {
                const isCur = lvl.id === current.id;
                const tag = (txt) => {
                  const lower = txt.toLowerCase();
                  const cls = lower.startsWith('prevented')
                    ? 'state-ok'
                    : lower.startsWith('possible')
                      ? 'state-warn'
                      : 'state-neutral';
                  return `<span class="state-tag ${cls}">${escapeHtml(txt)}</span>`;
                };
                return `
                  <tr ${isCur ? 'style="background:var(--accent-soft);"' : ''}>
                    <td class="mono"><strong>${escapeHtml(lvl.label)}</strong></td>
                    <td>${tag(lvl.matrix.dirtyRead)}</td>
                    <td>${tag(lvl.matrix.nonRepeatableRead)}</td>
                    <td>${tag(lvl.matrix.lostUpdate)}</td>
                    <td>${tag(lvl.matrix.phantomRead)}</td>
                    <td>${escapeHtml(lvl.matrix.locking)}</td>
                    <td>${escapeHtml(lvl.matrix.concurrency)}</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      `;
    }
  }

  /* ---- 4. Lock Manager Renderer ---- */

  renderLockManagerView() {
    const liveTable = document.getElementById('locks-live-table');
    const blockedBox = document.getElementById('locks-blocked-details');
    const logBox = document.getElementById('locks-event-log');

    if (liveTable) {
      liveTable.innerHTML = this._buildLockTableHtml(this.engine.lockManager.getLockTableRows());
    }

    if (blockedBox) {
      const blockedTxns = this.engine.transactions.filter((t) => t.state === 'BLOCKED');
      if (blockedTxns.length === 0) {
        blockedBox.innerHTML = '<div class="empty-state">No transactions are currently blocked.</div>';
      } else {
        blockedBox.innerHTML = blockedTxns
          .map(
            (tx) => `
              <div class="txn-blocked-note" style="margin:0 0 8px;">
                <strong class="mono">${escapeHtml(tx.id)}</strong> &mdash; ${escapeHtml(tx.blockedInfo?.reason || 'Waiting for lock.')}
              </div>
            `
          )
          .join('');
      }
    }

    if (logBox) {
      const events = this.engine.lockManager.lockEvents;
      if (events.length === 0) {
        logBox.innerHTML =
          '<div class="empty-state">No lock events recorded yet. Step the simulation to observe lock acquisition and release.</div>';
      } else {
        logBox.innerHTML = `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Txn</th>
                  <th>Resource</th>
                  <th>Action</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                ${events
                  .slice()
                  .reverse()
                  .map((ev) => {
                    const cls =
                      ev.action === 'BLOCKED'
                        ? 'state-blocked'
                        : ev.action === 'RELEASE'
                          ? 'state-neutral'
                          : ev.action === 'UNBLOCK'
                            ? 'state-ok'
                            : 'state-info';
                    return `
                      <tr>
                        <td class="mono">S${ev.step}</td>
                        <td class="mono">${escapeHtml(ev.txId)}</td>
                        <td class="mono">${escapeHtml(ev.resource)} (${escapeHtml(ev.mode)})</td>
                        <td><span class="state-tag ${cls}">${escapeHtml(ev.action)}</span></td>
                        <td>${escapeHtml(ev.detail)}</td>
                      </tr>
                    `;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    }
  }

  /* ---- 5. Deadlock Detector Renderer ---- */

  renderDeadlockView() {
    const dl = this.engine.getDeadlockState();
    const graphEl = document.getElementById('deadlock-graph-container');
    const statusEl = document.getElementById('deadlock-status-label');
    const analysisEl = document.getElementById('deadlock-analysis-panel');

    if (statusEl) {
      statusEl.textContent = dl.hasDeadlock ? 'Deadlock Cycle Detected' : 'No Cycle Detected';
      statusEl.className = `state-tag ${dl.hasDeadlock ? 'state-danger' : 'state-ok'}`;
    }

    if (graphEl) {
      graphEl.innerHTML = renderDirectedGraphSVG({
        nodes: dl.nodes,
        edges: dl.edges,
        cycleNodeSet: dl.cycleNodeSet,
        cycleEdgeSet: dl.cycleEdgeSet,
        emptyMessage: 'No active or blocked transactions in the Wait-For Graph.',
        markerPrefix: 'wfg'
      });
    }

    if (analysisEl) {
      if (!dl.hasDeadlock) {
        const edgeDesc =
          dl.edges.length > 0
            ? `<p class="section-subtitle">Current wait dependencies (acyclic):</p>
               <div class="chain-box">${dl.edges.map((e) => `${escapeHtml(e.from)} → ${escapeHtml(e.to)} (${escapeHtml(e.resource)}: req ${e.requestedMode}, held ${e.heldMode})`).join('<br>')}</div>`
            : '<p class="section-subtitle">No waiting lock dependencies exist right now. Load the Deadlock Demonstration scenario and step through it to observe a real Wait-For cycle.</p>';

        analysisEl.innerHTML = `
          <div>
            <span class="state-tag state-ok">Acyclic Wait-For Graph</span>
            ${edgeDesc}
            <div class="honesty-note" style="margin-top:14px;">
              Deadlocks are never fabricated: a cycle appears only when active lock holders form a genuine circular wait in the Lock Manager.
            </div>
          </div>
        `;
      } else {
        const cycleHtml = dl.cycles
          .map((cyc) => {
            const chain = cyc.nodes.join(' → ');
            const reasons = cyc.edges
              .map(
                (e) =>
                  `${e.from} is waiting for ${e.requestedMode}(${e.resource}) while ${e.to} holds ${e.heldMode}(${e.resource}).`
              )
              .join(' ');
            return `
              <div class="chain-box" style="color:var(--danger);border-color:rgba(239,68,68,0.45);">${escapeHtml(chain)}</div>
              <p class="anomaly-desc">${escapeHtml(reasons)}</p>
            `;
          })
          .join('');

        const candidates = [...dl.cycleNodeSet].sort();
        const victimRadios = candidates
          .map((txId, idx) => {
            const tx = this.engine.transactions.find((t) => t.id === txId);
            const writes = tx ? tx.writeSet.length : 0;
            const locks = this.engine.lockManager.getHeldLocksForTx(txId).length;
            return `
              <label class="victim-option">
                <span class="victim-option-left">
                  <input type="radio" name="deadlock-victim" value="${escapeHtml(txId)}" ${idx === candidates.length - 1 ? 'checked' : ''} />
                  <strong class="mono">${escapeHtml(txId)}</strong>
                </span>
                <span class="muted mono">${locks} lock(s) · ${writes} write(s)</span>
              </label>
            `;
          })
          .join('');

        analysisEl.innerHTML = `
          <div>
            <span class="state-tag state-danger">Deadlock Alert</span>
            ${cycleHtml}
            <div class="subpanel-divider"></div>
            <h4 class="subpanel-title">Manual Deadlock Recovery</h4>
            <p class="panel-subtitle">Choose a victim transaction to abort. Its uncommitted writes will be rolled back, its locks released, and waiting transactions retried.</p>
            <div class="victim-selector">${victimRadios}</div>
            <button type="button" id="btn-abort-victim" class="btn btn-danger">Abort Selected Victim &amp; Recover</button>
            <div class="honesty-note" style="margin-top:14px;">
              <strong>Educational Note:</strong> Manual victim choice lets you compare recovery outcomes. Production DBMS engines choose victims automatically using policies such as youngest transaction, fewest log records written, or lock-wait timeouts.
            </div>
          </div>
        `;
      }
    }
  }

  /* ---- 6. Serializability Analyzer Renderer ---- */

  renderSerializabilityView() {
    const analysis = SerializabilityAnalyzer.analyze(
      this.engine.executionHistory,
      this.engine.transactions,
      this.includeAbortedInSerial
    );

    const verdictTag = document.getElementById('serial-verdict-tag');
    if (verdictTag) {
      verdictTag.textContent = analysis.label;
      verdictTag.className = `state-tag ${
        analysis.status === 'CONFLICT_SERIALIZABLE'
          ? 'state-ok'
          : analysis.status === 'NOT_CONFLICT_SERIALIZABLE'
            ? 'state-danger'
            : 'state-neutral'
      }`;
    }

    const graphEl = document.getElementById('serial-graph-container');
    if (graphEl) {
      graphEl.innerHTML = renderDirectedGraphSVG({
        nodes: analysis.nodes,
        edges: analysis.edges,
        cycleNodeSet: analysis.cycleNodeSet,
        cycleEdgeSet: analysis.cycleEdgeSet,
        emptyMessage: 'Execute READ or WRITE operations to generate the precedence graph.',
        markerPrefix: 'prec'
      });
    }

    const summaryEl = document.getElementById('serial-summary-panel');
    if (summaryEl) {
      if (analysis.status === 'NO_SCHEDULE') {
        summaryEl.innerHTML = `
          <div class="empty-state">
            No READ/WRITE operations have executed yet. Step the simulation to analyze conflict edges and serializability.
          </div>
        `;
      } else if (analysis.hasCycle) {
        const cyclesText = analysis.cycles.map((c) => c.nodes.join(' → ')).join(' | ');
        summaryEl.innerHTML = `
          <span class="state-tag state-danger">Not Conflict Serializable</span>
          <p class="section-subtitle" style="margin-top:8px;">
            The precedence graph contains a directed cycle, which means no equivalent serial execution order preserves all read/write conflict directions.
          </p>
          <div class="chain-box" style="color:var(--danger);border-color:rgba(239,68,68,0.45);">${escapeHtml(cyclesText)}</div>
          <div class="honesty-note">
            Try switching to <strong class="mono">SERIALIZABLE</strong> (Strict 2PL) in the Isolation Lab and re-running the same transactions to see how locking prevents this non-serializable interleaving.
          </div>
        `;
      } else {
        const orderText = analysis.serialOrder.join(' → ');
        summaryEl.innerHTML = `
          <span class="state-tag state-ok">Conflict Serializable</span>
          <p class="section-subtitle" style="margin-top:8px;">
            The precedence graph is acyclic (${analysis.conflicts.length} conflict pair${analysis.conflicts.length === 1 ? '' : 's'} analyzed). Equivalent serial order via Kahn's topological sort:
          </p>
          <div class="chain-box" style="color:var(--success);border-color:rgba(34,197,94,0.38);">${escapeHtml(orderText)}</div>
          ${
            analysis.excludedAbortedCount > 0
              ? `<p class="muted" style="font-size:12px;">Note: ${analysis.excludedAbortedCount} aborted transaction(s) excluded from committed schedule analysis. Use the checkbox below to inspect all executed operations.</p>`
              : ''
          }
        `;
      }
    }

    const tableEl = document.getElementById('serial-conflicts-table');
    if (tableEl) {
      if (analysis.conflicts.length === 0) {
        tableEl.innerHTML =
          '<div class="empty-state">No conflicting operation pairs (RW, WR, WW) on shared keys detected yet.</div>';
      } else {
        tableEl.innerHTML = `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Earlier Operation</th>
                  <th>Later Operation</th>
                  <th>Resource</th>
                  <th>Conflict Type</th>
                  <th>Precedence Edge</th>
                </tr>
              </thead>
              <tbody>
                ${analysis.conflicts
                  .map(
                    (c) => `
                      <tr>
                        <td class="mono">S${c.op1.step}: ${escapeHtml(c.op1.txId)} ${escapeHtml(c.op1.opLabel)}</td>
                        <td class="mono">S${c.op2.step}: ${escapeHtml(c.op2.txId)} ${escapeHtml(c.op2.opLabel)}</td>
                        <td class="mono"><strong>${escapeHtml(c.key)}</strong></td>
                        <td><span class="state-tag state-warn mono">${escapeHtml(c.conflictType)}</span></td>
                        <td class="mono">${escapeHtml(c.from)} &rarr; ${escapeHtml(c.to)}</td>
                      </tr>
                    `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    }
  }

  /* ---- 7. Scenario Library Renderer ---- */

  renderScenariosView() {
    const renderCard = (s, isCustom) => {
      const previewLines = s.transactions
        .map(
          (t) =>
            `${t.id}: ${t.operations.map((o) => SimulationEngine.formatOp(o)).join(' -> ')}`
        )
        .join('\n');
      const dbSummary = Object.entries(s.initialDb || {})
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');

      return `
        <article class="scenario-card">
          <div>
            <h4 class="scenario-card-title">${escapeHtml(s.name)}</h4>
            <div class="scenario-card-meta">
              <span>${escapeHtml(s.category || 'Scenario')}</span>
              <span aria-hidden="true"> &middot; </span>
              <span class="mono">${escapeHtml(ISOLATION_SPECS[s.isolationLevel]?.label || s.isolationLevel)}</span>
              <span aria-hidden="true"> &middot; </span>
              <span class="mono">DB: ${escapeHtml(dbSummary)}</span>
            </div>
          </div>
          <p class="scenario-card-desc">${escapeHtml(s.description)}</p>
          <div class="scenario-preview-code">${escapeHtml(previewLines)}</div>
          <div class="scenario-card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-load-scenario="${escapeHtml(s.id)}">Load into Workbench</button>
            ${
              isCustom
                ? `<button type="button" class="btn btn-ghost btn-sm" data-delete-scenario="${escapeHtml(s.id)}">Delete</button>`
                : `<span class="muted mono" style="font-size:11px;">${s.transactions.length} txns</span>`
            }
          </div>
        </article>
      `;
    };

    const builtinGrid = document.getElementById('builtin-scenarios-grid');
    if (builtinGrid) {
      builtinGrid.innerHTML = BUILTIN_SCENARIOS.map((s) => renderCard(s, false)).join('');
    }

    const customList = StorageManager.getCustomScenarios();
    const countEl = document.getElementById('custom-scenario-count');
    if (countEl) countEl.textContent = `${customList.length} saved`;

    const customGrid = document.getElementById('custom-scenarios-grid');
    if (customGrid) {
      if (customList.length === 0) {
        customGrid.innerHTML =
          '<div class="panel empty-state" style="grid-column:1/-1;">No custom scenarios saved yet. Configure transactions in the Workbench and click "Save Scenario" to store them in localStorage.</div>';
      } else {
        customGrid.innerHTML = customList.map((s) => renderCard(s, true)).join('');
      }
    }
  }

  /* ---- 8. Documentation Renderer ---- */

  renderDocsView() {
    const q = this.docSearchQuery;
    const filtered = DOCUMENTATION_TOPICS.filter((topic) => {
      if (!q) return true;
      return (
        topic.title.toLowerCase().includes(q) ||
        topic.body.toLowerCase().includes(q) ||
        topic.keywords.toLowerCase().includes(q)
      );
    });

    const tocEl = document.getElementById('docs-toc');
    if (tocEl) {
      tocEl.innerHTML = filtered
        .map(
          (t) =>
            `<button type="button" class="docs-toc-link" data-doc-jump="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button>`
        )
        .join('');
    }

    const contentEl = document.getElementById('docs-content');
    if (contentEl) {
      if (filtered.length === 0) {
        contentEl.innerHTML =
          '<div class="panel empty-state">No documentation topics match your search filter.</div>';
      } else {
        contentEl.innerHTML = filtered
          .map(
            (t) => `
              <article id="doc-article-${escapeHtml(t.id)}" class="doc-article">
                <div class="doc-article-head">
                  <h3>${escapeHtml(t.title)}</h3>
                  ${
                    t.scenarioId
                      ? `<button type="button" class="btn btn-secondary btn-xs" data-load-scenario="${escapeHtml(t.scenarioId)}">Try Scenario</button>`
                      : ''
                  }
                </div>
                <p>${escapeHtml(t.body)}</p>
                <div class="doc-example">${escapeHtml(t.example)}</div>
              </article>
            `
          )
          .join('');
      }
    }
  }

  /* ---- 9. Self-Tests Renderer ---- */

  renderTestsView() {
    const container = document.getElementById('test-results-container');
    const summaryText = document.getElementById('test-summary-text');
    const overallBadge = document.getElementById('test-overall-badge');
    if (!container) return;

    if (!this.lastTestResults) {
      // Automatically run on first visit so user immediately sees real live results
      this.lastTestResults = SelfTestRunner.runAll();
      this.renderHeaderAndSidebar();
    }

    const results = this.lastTestResults;
    const passed = results.filter((r) => r.passed).length;
    const allPass = passed === results.length;

    if (summaryText) {
      summaryText.textContent = `Executed ${results.length} deterministic engine checks: ${passed} passed, ${results.length - passed} failed.`;
    }
    if (overallBadge) {
      overallBadge.textContent = allPass ? `ALL PASS (${passed}/${results.length})` : `${passed}/${results.length} PASSED`;
      overallBadge.className = `state-tag ${allPass ? 'state-ok' : 'state-danger'}`;
    }

    container.innerHTML = results
      .map(
        (r) => `
          <div class="test-row">
            <span class="state-tag ${r.passed ? 'state-ok' : 'state-danger'} mono">${r.passed ? 'PASS' : 'FAIL'}</span>
            <strong>${escapeHtml(r.name)}</strong>
            <span class="muted">${escapeHtml(r.detail)}</span>
            <span class="mono muted" style="text-align:right;">${escapeHtml(r.durationMs)}ms</span>
          </div>
        `
      )
      .join('');
  }
}

// Bootstrap application cleanly when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    window.__txnLabApp = new TxnLabUI();
  });
}

// Export pure engine classes for programmatic verification if imported as ES module
export {
  ISOLATION_SPECS,
  BUILTIN_SCENARIOS,
  LockManager,
  WaitForGraph,
  DatabaseState,
  SimulationEngine,
  SerializabilityAnalyzer,
  AnomalyDetector,
  SelfTestRunner
};
