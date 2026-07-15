# Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    daq_samples {
        TIMESTAMPTZ time PK "Hypertable Time Partition Key"
        SMALLINT channel
        DOUBLE PRECISION value
    }
    daq_sessions {
        SERIAL id PK
        TIMESTAMPTZ started_at
        TIMESTAMPTZ stopped_at
        SMALLINT channel_count
        INTEGER clock_rate_hz
        TEXT notes
    }
```

**What this shows**: The database schema consists of `daq_samples` (the time-series hypertable storing samples by time, channel, and value) and `daq_sessions` (tracking specific streaming acquisition sessions).
