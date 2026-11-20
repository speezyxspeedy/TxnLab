# TxnLab — Database Transaction & Concurrency Simulator

TxnLab is an interactive, browser-based database internals workbench for exploring concurrent transactions, isolation levels, Shared/Exclusive locking, wait-for deadlocks, concurrency anomalies, and conflict serializability.

Built with pure **HTML5, CSS3, and vanilla ES6+ JavaScript** — zero frameworks, zero external runtime dependencies, zero CDNs, and fully functional offline.

---

## Key Features

- **Transaction Workbench**
  - Create, remove, edit, and reorder transactions (`READ`, `WRITE`, `COMMIT`, `ROLLBACK`) and database keys before execution.
  - Execute step-by-step (`Step`), continuously (`Play` / `Pause` with speed control), or craft exact interleavings using **Manual Scheduling** or **Auto Round-Robin** mode.
  - Inspect per-transaction execution pointers, states (`ACTIVE`, `BLOCKED`, `COMMITTED`, `ABORTED`), read/write sets, held locks, and live blocking reasons.
- **Interactive Execution Timeline (SVG)**
  - Horizontal swimlanes per transaction (`T1`, `T2`, `T3`, ...) with color-coded operation events, blocked attempts, and click/hover event inspection.
- **Database State Inspector**
  - Separates committed values from uncommitted transaction write buffers, tracks last committing transaction, and preserves per-key version history across `COMMIT` and `ROLLBACK`.
- **Isolation Lab**
  - Switch between `READ UNCOMMITTED`, `READ COMMITTED`, `REPEATABLE READ`, and `SERIALIZABLE` (Strict Two-Phase Locking) with explicit teaching rules, comparison matrix, and real-DBMS implementation caveats.
- **Lock Manager**
  - Live lock table (`Resource | Lock Type | Owner | Waiting`), `S`/`X` compatibility matrix, lock upgrades (`S → X`), FIFO waiting queues, automatic wake-up processing upon lock release, and a chronological lock event log.
- **Deadlock Detector & Wait-For Graph (SVG)**
  - Builds the Wait-For Graph directly from active lock dependencies, runs DFS cycle detection, highlights circular waiting chains, and provides manual victim abort recovery.
- **Conflict Serializability Analyzer (SVG)**
  - Analyzes executed `READ`/`WRITE` schedules for `RW`, `WR`, and `WW` conflicts on shared keys, renders the directed Precedence Graph, detects cycles, and computes a deterministic topological serial order (Kahn's algorithm) when acyclic.
- **Concurrency Anomaly Detector**
  - Dynamically detects **Dirty Reads**, **Non-Repeatable Reads**, **Lost Updates**, and **Serialization Conflicts** strictly from executed history, with involved operations and prevention guidance.
- **Scenario Library & Local Persistence**
  - Includes 7 built-in curated scenarios plus `localStorage` persistence for saving and loading custom scenarios and UI preferences (theme and playback speed).
- **Searchable Documentation & Built-In Self-Tests**
  - 11 database internals reference articles with schedule examples and 10 deterministic in-app engine self-tests verifying core invariants.

---

## Architecture

The application is organized into three core files with strict separation between pure simulation logic and DOM rendering:

```text
├── index.html   # Semantic HTML5 shell, workspace views, and modal dialogs
├── style.css    # Dark-first & light theme design system, layout, and responsive rules
└── script.js    # Modular ES6+ engine and UI layers:
                 #   1. Domain Constants, Isolation Specs, Scenarios & Docs
                 #   2. Concurrency Controller (LockManager, WaitForGraph)
                 #   3. Simulation Engine (DatabaseState, SimulationEngine)
                 #   4. Analysis Engine (SerializabilityAnalyzer, AnomalyDetector)
                 #   5. Built-In Self-Test Runner (SelfTestRunner)
                 #   6. Persistence Layer (StorageManager via localStorage)
                 #   7. SVG Visualization Renderers (Timeline & Directed Graphs)
                 #   8. UI Controller (TxnLabUI)
```

All simulation, locking, deadlock detection, and serializability classes (`LockManager`, `WaitForGraph`, `DatabaseState`, `SimulationEngine`, `SerializabilityAnalyzer`, `AnomalyDetector`, `SelfTestRunner`) are independent of the DOM and can also be imported directly as ES modules for programmatic testing.

---

## Simplified Isolation Model

TxnLab uses explicit lock-based teaching semantics:

| Isolation Level | Read Visibility | Shared (`S`) Lock Behavior | Exclusive (`X`) Lock Behavior |
|---|---|---|---|
| **READ UNCOMMITTED** | May observe uncommitted writes from active transactions | No `S` lock acquired for ordinary reads | Held until `COMMIT` / `ROLLBACK` |
| **READ COMMITTED** | Committed values (and own uncommitted writes) | Acquired per read, released immediately after read | Held until `COMMIT` / `ROLLBACK` |
| **REPEATABLE READ** | Committed values (and own uncommitted writes) | Retained until `COMMIT` / `ROLLBACK` | Held until `COMMIT` / `ROLLBACK` |
| **SERIALIZABLE** | Committed values (and own uncommitted writes) | Strict 2PL: retained until `COMMIT` / `ROLLBACK` | Strict 2PL: retained until `COMMIT` / `ROLLBACK` |

> **Educational Scope Note:** Real database engines (PostgreSQL MVCC/SSI, MySQL InnoDB MVCC + next-key gap locks, SQL Server, Oracle) implement isolation levels differently and handle phantom reads across range predicates. TxnLab models single-key lock-based concurrency to illustrate core theory clearly.

---

## Built-In Scenarios

1. **Dirty Read Demonstration** (`READ UNCOMMITTED`) — T2 reads T1's uncommitted write before T1 rolls back.
2. **Non-Repeatable Read** (`READ COMMITTED`) — T1 reads `A` twice around T2's committed update and observes two different values.
3. **Lost Update** (`READ COMMITTED`) — T1 and T2 read the same initial value and overwrite each other based on stale reads.
4. **Shared Lock vs Exclusive Lock** (`REPEATABLE READ`) — Concurrent `S` lock sharing between readers blocking a writer until both release.
5. **Deadlock Demonstration** (`REPEATABLE READ`) — Circular lock wait (`T1 → T2 → T1`) with Wait-For Graph visualization and manual victim recovery.
6. **Serializable vs Non-Serializable Schedule** (`READ COMMITTED`) — Interleaved cross-key reads/writes creating a precedence cycle (`T1 → T2 → T1`).
7. **Conflict-Serializable Pipeline** (`REPEATABLE READ`) — Acyclic 3-transaction schedule producing a topological serial order.

---

## Running Locally

### Option 1: Static HTTP Server (Zero Tooling)

Because TxnLab uses ES modules (`<script type="module" src="./script.js">`), serve the root directory with any static HTTP server:

```bash
python3 -m http.server 3000
```

Then open `http://localhost:3000`.

### Option 2: Vite Dev Server & Build

```bash
npm install
npm run dev      # Starts dev server on http://localhost:3000
npm run build    # Produces production bundle in dist/
```

### Running Engine Self-Tests

- **In-App**: Open **Engine Self-Tests** from the bottom of the left sidebar and click **Run All Tests**.
- **CLI (Node.js)**:

```bash
node -e 'import("./script.js").then(({ SelfTestRunner }) => {
  for (const r of SelfTestRunner.runAll()) {
    console.log(`[${r.passed ? "PASS" : "FAIL"}] ${r.name}: ${r.detail}`);
  }
});'
```

---

## Keyboard Shortcuts (Transaction Workbench)

| Key | Action |
|---|---|
| `Space` | Execute next eligible operation |
| `P` | Play / Pause automatic execution |
| `R` | Reset simulation to initial state |
| `Esc` | Close active modal |
