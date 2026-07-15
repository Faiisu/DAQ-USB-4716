# app.py
# See: docs/architecture/context.md
# English comments only

import os
import sys
import json
from datetime import datetime, timedelta, timezone
from flask import Flask, render_template, jsonify, request
import psycopg2
import psycopg2.extras

app = Flask(__name__, template_folder='templates', static_folder='static')

# Resolve config.json path from the USB4716 directory
CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', 'USB4716', 'config.json')

def get_db_dsn():
    """Reads the database connection string from config.json."""
    try:
        with open(CONFIG_PATH, 'r') as f:
            cfg = json.load(f)
            return cfg.get("DB_DSN")
    except Exception as e:
        print(f"Error loading config.json DSN: {e}")
        # Default fallback
        return "postgresql://admin:admin@172.21.108.86:5432/daq_db"

@app.route('/')
def home():
    """Renders the main plotting dashboard."""
    return render_template('index.html')

@app.route('/api/channels')
def get_channels():
    """Retrieves a list of available channels in the database."""
    dsn = get_db_dsn()
    conn = None
    try:
        conn = psycopg2.connect(dsn)
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT channel FROM daq_samples ORDER BY channel;")
            channels = [row[0] for row in cur.fetchall()]
        return jsonify(channels)
    except Exception as e:
        print(f"Error fetching channels: {e}")
        return jsonify([])
    finally:
        if conn:
            conn.close()

@app.route('/api/data')
def get_data():
    """
    Retrieves time-series telemetry from the database.
    Query Params:
      - channel: integer (default 0)
      - last: seconds of history to fetch (default 60)
      - start: ISO datetime (optional)
      - end: ISO datetime (optional)
    """
    channel = request.args.get('channel', default=0, type=int)
    last_sec = request.args.get('last', default=60, type=float)
    start_str = request.args.get('start', default=None)
    end_str = request.args.get('end', default=None)

    dsn = get_db_dsn()
    conn = None
    try:
        conn = psycopg2.connect(dsn)
        
        # Build query based on parameters
        if start_str and end_str:
            # Custom window query
            start_dt = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
            end_dt = datetime.fromisoformat(end_str.replace('Z', '+00:00'))
            query = """
                SELECT time, value 
                FROM daq_samples 
                WHERE channel = %s AND time >= %s AND time <= %s 
                ORDER BY time ASC;
            """
            params = (channel, start_dt, end_dt)
        else:
            # Rolling window query
            end_dt = datetime.now(timezone.utc)
            start_dt = end_dt - timedelta(seconds=last_sec)
            query = """
                SELECT time, value 
                FROM daq_samples 
                WHERE channel = %s AND time >= %s AND time <= %s 
                ORDER BY time ASC;
            """
            params = (channel, start_dt, end_dt)

        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
            
            # Format outputs for Chart ingestion
            # Timestamps are formatted with millisecond precision
            times = [r['time'].isoformat() for r in rows]
            values = [r['value'] for r in rows]

        return jsonify({
            'times': times,
            'values': values
        })

    except Exception as e:
        print(f"Error fetching telemetry: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    # Served on Port 8084
    app.run(host='0.0.0.0', port=8084, debug=True)
