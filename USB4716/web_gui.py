# web_gui.py
# See: docs/architecture/context.md
# English comments only

import os
import sys
import json
import subprocess
import threading
import re
from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit

app = Flask(__name__, template_folder='templates', static_folder='static')
socketio = SocketIO(app, cors_allowed_origins="*")

# Absolute path of configuration file config.json
CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')

# State variables for background subprocess tracking
process = None
process_thread = None
is_running = False
run_mode = "mockup" # Either "real" or "mockup"

def read_config():
    """Reads static configurations from config.json."""
    try:
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading config.json: {e}")
        return {}

def write_config(config_data):
    """Writes updated configurations back to config.json."""
    try:
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config_data, f, indent=2)
        return True
    except Exception as e:
        print(f"Error writing config.json: {e}")
        return False

# Regular expression to capture and parse telemetry stats log line:
# [STATS] polled=1,024 | written=1,024 | dropped_batches=0 (0.0%) | db_errors=0 | queue=0/200
STATS_REGEX = re.compile(
    r"\[STATS\] polled=(?P<polled>[0-9,]+) \| written=(?P<written>[0-9,]+) \| dropped_batches=(?P<dropped>[0-9]+) \((?P<loss_pct>[0-9\.]+)%\) \| db_errors=(?P<errors>[0-9]+) \| queue=(?P<qsize>[0-9]+)/(?P<qmax>[0-9]+)"
)

def monitor_process_output(proc):
    """Background thread worker to poll stdout stream of DAQ subprocess."""
    global is_running, process
    try:
        while True:
            line = proc.stdout.readline()
            if not line:
                break
            
            # Decode byte lines from stream
            decoded_line = line.decode('utf-8', errors='replace').strip()
            
            # Broadcast raw logs to web dashboard console
            socketio.emit('log_update', {'log': decoded_line})
            
            # Match logs for stats update telemetry
            match = STATS_REGEX.search(decoded_line)
            if match:
                stats_data = {
                    'polled': match.group('polled'),
                    'written': match.group('written'),
                    'dropped': match.group('dropped'),
                    'loss_pct': match.group('loss_pct'),
                    'errors': match.group('errors'),
                    'queue_util': f"{match.group('qsize')}/{match.group('qmax')}"
                }
                socketio.emit('stats_update', stats_data)
                
    except Exception as e:
        print(f"Error reading subprocess stdout: {e}")
    finally:
        proc.wait()
        is_running = False
        process = None
        socketio.emit('status_change', {'is_running': False})
        socketio.emit('log_update', {'log': '[SYSTEM] Ingestion pipeline process terminated.'})

@app.route('/')
def home():
    """Renders the central control panel page."""
    return render_template('index.html')

@app.route('/api/config', methods=['GET'])
def get_config():
    """API endpoint to get config parameters."""
    return jsonify(read_config())

@app.route('/api/config', methods=['POST'])
def save_config():
    """API endpoint to update config parameters."""
    config_data = request.json
    if write_config(config_data):
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'message': 'Failed to save configuration.'}), 500

@app.route('/api/status', methods=['GET'])
def get_status():
    """API endpoint to check running state of processes."""
    return jsonify({
        'is_running': is_running,
        'run_mode': run_mode
    })

@socketio.on('start_daq')
def handle_start(data):
    """WebSocket command trigger to run DAQ subprocess."""
    global process, process_thread, is_running, run_mode
    if is_running:
        emit('log_update', {'log': '[SYSTEM] Warning: Ingestion process already running.'})
        return
        
    run_mode = data.get('mode', 'mockup')
    script_name = "mockup_stream_to_db.py" if run_mode == "mockup" else "stream_to_db.py"
    script_path = os.path.join(os.path.dirname(__file__), script_name)
    
    try:
        # Pass unbuffered flag so Python prints logs immediately to stdout stream
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        
        process = subprocess.Popen(
            [sys.executable, script_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env
        )
        
        is_running = True
        socketio.emit('status_change', {'is_running': True, 'mode': run_mode})
        socketio.emit('log_update', {'log': f'[SYSTEM] Spawning subprocess: {script_name}'})
        
        # Start background listener thread
        process_thread = threading.Thread(
            target=monitor_process_output, 
            args=(process,),
            daemon=True
        )
        process_thread.start()
        
    except Exception as e:
        socketio.emit('log_update', {'log': f'[SYSTEM] Failed to spawn process: {e}'})
        is_running = False
        process = None

@socketio.on('stop_daq')
def handle_stop():
    """WebSocket command trigger to terminate running subprocess."""
    global process, is_running
    if not is_running or process is None:
        emit('log_update', {'log': '[SYSTEM] Warning: Ingestion process is not running.'})
        return
        
    socketio.emit('log_update', {'log': '[SYSTEM] Sending termination signal to process...'})
    try:
        process.terminate() # Graceful shutdown (allows queue flush)
    except Exception as e:
        socketio.emit('log_update', {'log': f'[SYSTEM] Error terminating process: {e}'})

if __name__ == '__main__':
    # Served on Port 8081 for distributed scaling compatibility
    socketio.run(app, host='0.0.0.0', port=8081, debug=True)
