# Data Flow Diagram

```mermaid
graph LR
  subgraph HW [USB-4716 Hardware]
    AI["Analog Input Channels (ch0-ch7)"]
  end

  subgraph Pipeline [stream_to_db.py / mockup_stream_to_db.py]
    direction TB
    DAQThread["🧵 DAQ-Reader Thread"]
    Queue[("📥 In-memory queue.Queue (maxsize=200)")]
    WriterThread["🧵 Data Writer Thread"]
    Stats[("📊 stats (dict with Lock)")]
    MonitorThread["🧵 Monitor Thread"]

    DAQThread -->|1. Poll hardware / mock generator| AI
    DAQThread -->|2. Wall-clock timestamping & raw enqueue| Queue
    DAQThread -->|Update stats| Stats
    Queue -->|3. Dequeue batch| WriterThread
    WriterThread -->|4. Parse interleaved samples & compute periodic ts| WriterThread
    WriterThread -->|Update stats| Stats
    MonitorThread -->|Read stats & log| Stats
  end

  subgraph Targets [Configurable Destinations]
    TimescaleDB[("🗄️ TimescaleDB (daq_samples)")]
    MQTTBroker[("📡 MQTT Broker (daq/telemetry)")]
  end

  subgraph Consumer [Optional Consumer]
    MQTTBridge["🔄 mqtt_to_db.py Subscriber"]
  end

  WriterThread -->|"5a. execute_values (DESTINATION=database)"| TimescaleDB
  WriterThread -->|"5b. publish JSON batch (DESTINATION=mqtt)"| MQTTBroker
  MQTTBroker -->|"6. Subscribe & insert"| MQTTBridge
  MQTTBridge --> TimescaleDB
```

**What this shows**: Data flows from the physical or synthetic analog input channels to the DAQ-Reader Thread. It is enqueued along with a wall-clock batch timestamp into a thread-safe Queue. The Data Writer Thread dequeues the batch, parses the interleaved samples, computes timestamps relative to the periodic anchor, and sends them to the configured destination (`DESTINATION` in `config.json`): either bulk inserted into TimescaleDB via `psycopg2` or published as a JSON payload to the MQTT Broker via `paho-mqtt`. An optional `mqtt_to_db.py` subscriber can bridge MQTT messages into TimescaleDB.

