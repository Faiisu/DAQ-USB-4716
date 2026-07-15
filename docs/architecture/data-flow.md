# Data Flow Diagram

```mermaid
graph LR
  subgraph HW [USB-4716 Hardware]
    AI["Analog Input Channels (ch0-ch7)"]
  end

  subgraph Pipeline [stream_to_db.py]
    direction TB
    DAQThread["🧵 DAQ-Reader Thread"]
    Queue[("📥 In-memory queue.Queue (maxsize=200)")]
    DBThread["🧵 DB-Writer Thread"]
    Stats[("📊 stats (dict with Lock)")]
    MonitorThread["🧵 Monitor Thread"]

    DAQThread -->|1. Poll via getDataF64| AI
    DAQThread -->|2. Wall-clock timestamping & raw enqueue| Queue
    DAQThread -->|Update stats| Stats
    Queue -->|3. Dequeue batch| DBThread
    DBThread -->|4. Parse interleaved samples & back-compute ts| DBThread
    DBThread -->|Update stats| Stats
    MonitorThread -->|Read stats & log| Stats
  end

  subgraph PostgreSQL [TimescaleDB]
    daq_samples[("🗄️ daq_samples Table")]
  end

  subgraph Plot [plot_from_db.py]
    Plotter["📈 Matplotlib Live/Static Plotter"]
  end

  DBThread -->|5. execute_values (batch size=1000)| daq_samples
  daq_samples -->|6. Query SELECT| Plotter
```

**What this shows**: Data flows from the physical analog input channels to the DAQ-Reader Thread via polling. It is enqueued along with a wall-clock batch timestamp into a thread-safe Queue. The DB-Writer Thread dequeues the data, parses the interleaved samples, back-computes timestamps, and bulk inserts them into the `daq_samples` table. The Monitor Thread logs stats, and `plot_from_db.py` queries the DB directly to display plots.
