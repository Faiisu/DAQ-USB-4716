# config.py
# ─── DAQ Hardware ────────────────────────────────────────────────────────────
DEVICE_DESCRIPTION   = "USB-4716,BID#0"
PROFILE_PATH         = "./profile.xml"
START_CHANNEL        = 0
CHANNEL_COUNT        = 2             # 2 or 4 channels

CLOCK_RATE           = 1024          # Hz — hardware max sampling rate

# Hardware internal buffer max = 1024 samples (total, interleaved across channels)
# sectionLength must be <= HARDWARE_BUFFER_SIZE // CHANNEL_COUNT to avoid overflow
HARDWARE_BUFFER_SIZE = 1024          # samples total (shared across all channels)
SECTION_LENGTH       = HARDWARE_BUFFER_SIZE // CHANNEL_COUNT  # = 512 per channel
SECTION_COUNT        = 0             # 0 = infinite recording

# USER_BUFFER for getDataF64 call = interleaved samples to request per poll
# = sectionLength × channelCount = 512 × 2 = 1024 total interleaved samples
# At 1024 Hz with 2ch, this fills in ~500ms → PC must drain every <500ms
USER_BUFFER_SIZE     = SECTION_LENGTH * CHANNEL_COUNT

# ─── Pipeline ────────────────────────────────────────────────────────────────
# How many interleaved samples to batch before enqueuing (raw, unprocessed)
# Keep small so DAQ thread returns to polling quickly
# 1024 = one full hardware buffer worth = ~500ms of data
QUEUE_BATCH_SIZE     = USER_BUFFER_SIZE   # enqueue every full buffer

# In-memory queue max batches (safety cap against memory exhaustion)
# 200 batches × 500ms = ~100 seconds of buffer if DB goes down
QUEUE_MAXSIZE        = 200

# ─── Database ────────────────────────────────────────────────────────────────
DB_DSN               = "postgresql://admin:admin@localhost:5432/daq_db"

# Number of rows per executemany page (psycopg2 tuning)
DB_PAGE_SIZE         = 1000

# ─── Logging ─────────────────────────────────────────────────────────────────
STATS_INTERVAL_SEC   = 10            # print stats every N seconds
