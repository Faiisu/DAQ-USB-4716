import psycopg2
import psycopg2.extras
import psycopg2.extensions

def build_mockup_dsn(original_dsn: str, dbname: str) -> str:
    parsed = psycopg2.extensions.make_dsn(original_dsn)
    parts  = psycopg2.extensions.parse_dsn(parsed)
    parts["dbname"] = dbname
    return psycopg2.extensions.make_dsn(**parts)

def ensure_mockup_db(mockup_dsn: str, db_name: str = "mockup") -> str:
    postgres_dsn = build_mockup_dsn(mockup_dsn, "postgres")
    target_dsn   = build_mockup_dsn(mockup_dsn, db_name)

    conn = psycopg2.connect(postgres_dsn)
    conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
    if not cur.fetchone():
        cur.execute(f'CREATE DATABASE "{db_name}"')
    cur.close(); conn.close()

    ensure_schema(target_dsn)
    return target_dsn

def ensure_schema(dsn: str):
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()
    try:
        cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb;")
    except Exception:
        pass
    cur.execute("""
        CREATE TABLE IF NOT EXISTS daq_samples (
            time        TIMESTAMPTZ      NOT NULL,
            channel     SMALLINT         NOT NULL,
            value       DOUBLE PRECISION NOT NULL
        );
    """)
    try:
        cur.execute("SELECT create_hypertable('daq_samples', 'time', if_not_exists => TRUE);")
    except Exception:
        pass
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_daq_channel_time
            ON daq_samples (channel, time DESC);
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS daq_sessions (
            id            SERIAL PRIMARY KEY,
            started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            stopped_at    TIMESTAMPTZ,
            channel_count SMALLINT    NOT NULL,
            clock_rate_hz INTEGER     NOT NULL,
            notes         TEXT
        );
    """)
    cur.close(); conn.close()

def start_session(dsn: str, channel_count: int, clock_rate: int) -> int | None:
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO daq_sessions (started_at, channel_count, clock_rate_hz, notes) VALUES (NOW(), %s, %s, %s) RETURNING id;",
            (channel_count, clock_rate, "Started from Web GUI")
        )
        session_id = cur.fetchone()[0]
        cur.close()
        conn.close()
        return session_id
    except Exception:
        return None

def end_session(dsn: str, session_id: int | None):
    if session_id is None:
        return
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(
            "UPDATE daq_sessions SET stopped_at = NOW(), notes = COALESCE(notes, '') || ' | Stopped gracefully' WHERE id = %s;",
            (session_id,)
        )
        cur.close()
        conn.close()
    except Exception:
        pass
