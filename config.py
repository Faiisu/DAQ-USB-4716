# config.py (Auto-generated/updated by Web GUI on 2026-07-15T13:18:24.196211)

# ─── DAQ Hardware ────────────────────────────────────────────────────────────
DEVICE_DESCRIPTION   = 'USB-4716,BID#0'
PROFILE_PATH         = './profile.xml'
START_CHANNEL        = 0
CHANNEL_COUNT        = 1
CLOCK_RATE           = 1000

HARDWARE_BUFFER_SIZE = 1024
SECTION_LENGTH       = 200
SECTION_COUNT        = 0

# USER_BUFFER size (derived)
USER_BUFFER_SIZE     = SECTION_LENGTH * CHANNEL_COUNT

# ─── Pipeline ────────────────────────────────────────────────────────────────
QUEUE_BATCH_SIZE     = USER_BUFFER_SIZE
QUEUE_MAXSIZE        = 200

# ─── Database ────────────────────────────────────────────────────────────────
DB_DSN               = 'postgresql://admin:admin@100.81.77.113:10001/mddp_lab'
MOCKUP_DB_DSN        = 'postgresql://admin:admin@100.81.77.113:10001/mddp_lab'
DB_PAGE_SIZE         = 1000

# ─── Logging ─────────────────────────────────────────────────────────────────
STATS_INTERVAL_SEC   = 5

# ─── Linear Scaling ──────────────────────────────────────────────────────────
SCALING_ENABLED      = False
SCALING              = [{'low_v': 0.0, 'high_v': 5.0, 'low_val': 0.0, 'high_val': 5.0}]
