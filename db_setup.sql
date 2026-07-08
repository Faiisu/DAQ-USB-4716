-- db_setup.sql
-- Auto-executed on first container start via docker-entrypoint-initdb.d

-- 1. Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 2. Main samples table (narrow/tall schema)
--    Each row = 1 sample, 1 channel
CREATE TABLE IF NOT EXISTS daq_samples (
    time        TIMESTAMPTZ      NOT NULL,
    channel     SMALLINT         NOT NULL,
    value       DOUBLE PRECISION NOT NULL
);

-- 3. Convert to hypertable (time-series optimized, partitioned by time)
SELECT create_hypertable('daq_samples', 'time', if_not_exists => TRUE);

-- 4. Index for fast queries by channel + time
CREATE INDEX IF NOT EXISTS idx_daq_channel_time
    ON daq_samples (channel, time DESC);

-- 5. Metadata table to track sessions
CREATE TABLE IF NOT EXISTS daq_sessions (
    id            SERIAL PRIMARY KEY,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at    TIMESTAMPTZ,
    channel_count SMALLINT    NOT NULL,
    clock_rate_hz INTEGER     NOT NULL,
    notes         TEXT
);
