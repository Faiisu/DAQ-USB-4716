# config.py
# See: docs/architecture/context.md
# Dynamically loaded from config.json to prevent Python evaluation execution side-effects.

import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')

try:
    with open(CONFIG_PATH, 'r') as f:
        _data = json.load(f)
except Exception as e:
    # Fallback to defaults if file reading/parsing fails
    print(f"Warning: Failed to load {CONFIG_PATH} ({e}). Using default settings.")
    _data = {}

# ─── DAQ Hardware ────────────────────────────────────────────────────────────
DEVICE_DESCRIPTION   = _data.get('DEVICE_DESCRIPTION', 'USB-4716,BID#0')
PROFILE_PATH         = _data.get('PROFILE_PATH', './profile.xml')
START_CHANNEL        = int(_data.get('START_CHANNEL', 0))
CHANNEL_COUNT        = int(_data.get('CHANNEL_COUNT', 1))
CLOCK_RATE           = int(_data.get('CLOCK_RATE', 1000))

HARDWARE_BUFFER_SIZE = int(_data.get('HARDWARE_BUFFER_SIZE', 1024))
SECTION_LENGTH       = int(_data.get('SECTION_LENGTH', 1024))
SECTION_COUNT        = int(_data.get('SECTION_COUNT', 0))

# USER_BUFFER size (derived dynamically)
USER_BUFFER_SIZE     = SECTION_LENGTH * CHANNEL_COUNT

# ─── Pipeline ────────────────────────────────────────────────────────────────
QUEUE_BATCH_SIZE     = USER_BUFFER_SIZE
QUEUE_MAXSIZE        = int(_data.get('QUEUE_MAXSIZE', 200))

# ─── Database ────────────────────────────────────────────────────────────────
DB_DSN               = _data.get('DB_DSN', 'postgresql://admin:admin@172.21.108.86:5432/daq_db')
MOCKUP_DB_DSN        = _data.get('MOCKUP_DB_DSN', 'postgresql://admin:admin@localhost:5432/daq_db')
DB_PAGE_SIZE         = int(_data.get('DB_PAGE_SIZE', 1000))

# ─── Logging ─────────────────────────────────────────────────────────────────
STATS_INTERVAL_SEC   = int(_data.get('STATS_INTERVAL_SEC', 10))
