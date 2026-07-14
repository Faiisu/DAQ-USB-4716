# config.py (Auto-generated/updated by Web GUI on 2026-07-14T22:17:08.743591)

# ─── DAQ Hardware ────────────────────────────────────────────────────────────
DEVICE_DESCRIPTION   = 'USB-4716,BID#0'
PROFILE_PATH         = './profile.xml'
START_CHANNEL        = 0
CHANNEL_COUNT        = 1
CLOCK_RATE           = 1000

HARDWARE_BUFFER_SIZE = 1024
SECTION_LENGTH       = 1024
SECTION_COUNT        = 0

# USER_BUFFER size (derived)
USER_BUFFER_SIZE     = SECTION_LENGTH * CHANNEL_COUNT

# ─── Pipeline ────────────────────────────────────────────────────────────────
QUEUE_BATCH_SIZE     = USER_BUFFER_SIZE
QUEUE_MAXSIZE        = 200

# ─── Database ────────────────────────────────────────────────────────────────
DB_DSN               = 'postgresql://admin:admin@172.21.108.86:5432/daq_db'
MOCKUP_DB_DSN        = 'postgresql://admin:admin@localhost:5432/daq_db'
DB_PAGE_SIZE         = 1000

# ─── Logging ─────────────────────────────────────────────────────────────────
STATS_INTERVAL_SEC   = 10
