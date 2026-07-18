# MDDP Ingestion Control Suite

The Multi-Device Data Ingestion Control Suite (MDDP) is a modular, high-performance software system designed to orchestrate and visualize time-series telemetry from hardware data acquisition systems (such as the Advantech USB-4716 DAQ Card) and robot dispensers.

This repository features:
- **Portal Gateway (Port 8080)**: A centralized dashboard for auditing and launching active device control panels.
- **DAQ USB-4716 Control Console (Port 8081)**: A dedicated Flask-SocketIO dashboard to configure, start, stop, and audit telemetry stream ingestion in real time.
- **Database Plotter (Port 8084)**: A flexible multi-chart grid workspace powered by Plotly.js, displaying time-series telemetry retrieved dynamically from TimescaleDB hypertables.

---

## 1. System Architecture & Operation Principles

### A. User Operation Flow
Shows how a user configures and runs the data acquisition and plotting pipeline.

```mermaid
graph LR
    Start([User Starts System]) --> StartDocker[Start TimescaleDB Container]
    StartDocker --> RunScripts[Run Ingestion Control Suite run.sh]
    RunScripts --> LaunchPortal[Access Portal Gateway :8080]
    
    LaunchPortal --> SelectDAQ[Select DAQ USB-4716 Panel :8081]
    SelectDAQ --> AdjustConfig[Modify & Save Configuration Parameters]
    AdjustConfig --> StartStream{Start Stream Ingestion}
    
    StartStream -->|Mock Mode| StartMock[Run mockup_stream_to_db.py]
    StartStream -->|Real Hardware Mode| StartReal[Run stream_to_db.py]
    
    StartMock --> IngestionLoop[Telemetry batch-inserted into TimescaleDB]
    StartReal --> IngestionLoop
    
    IngestionLoop --> OpenPlotter[Launch Database Plotter :8084]
    OpenPlotter --> QueryLive[Select Channel & view live Plotly charts]
    QueryLive --> Verify{Telemetry verified?}
    
    Verify -->|No| AdjustConfig
    Verify -->|Yes| EndIngestion[Stop Stream & shutdown via stop.sh]
    
    style Start fill:#e1f5e1,stroke:#4caf50,color:#000
    style LaunchPortal fill:#e3f2fd,stroke:#2196f3,color:#000
    style StartStream fill:#fff3e0,stroke:#ff9800,color:#000
    style Verify fill:#fce4ec,stroke:#e91e63,color:#000
```

### B. Technical Architecture Diagram
Depicts the layered structure of the tech stack and the data pathways across services.

```mermaid
graph LR
    subgraph "Presentation Layer"
        Portal[Portal Gateway<br/>Vanilla HTML / CSS / JS]
        DAQView[DAQ UI Panel<br/>Bootstrap + SocketIO]
        PlotView[Plotter UI<br/>Plotly.js dynamic grid]
    end

    subgraph "Application & Service Layer"
        WebServer[Python http.server<br/>Port 8080]
        DAQGUISvc["DAQ Control Server<br/>Flask + SocketIO (Port 8081)"]
        PlotSvc["Analytics & Plotter Service<br/>Flask Stateless Web API (Port 8084)"]
        DAQStream[Ingestion Process<br/>stream_to_db.py / mockup_stream_to_db.py]
    end

    subgraph "Data Layer"
        TimescaleDB[(TimescaleDB / PostgreSQL<br/>Port 5432)]
    end

    Portal -.->|links| DAQView
    Portal -.->|links| PlotView

    DAQView -->|WebSockets| DAQGUISvc
    DAQGUISvc -->|Popen subprocess| DAQStream
    PlotView -->|REST queries| PlotSvc

    DAQStream -->|psycopg2 bulk INSERT| TimescaleDB
    PlotSvc -->|psycopg2 SELECT queries| TimescaleDB

    style Portal fill:#61dafb,stroke:#00d8ff,color:#000
    style DAQGUISvc fill:#ff6b6b,stroke:#ff0000,color:#000
    style TimescaleDB fill:#4caf50,stroke:#2e7d32,color:#000
```

### C. Data Flow Diagram
Maps internal threading, buffering, and query flows of the streaming pipeline.

```mermaid
graph LR
    subgraph HW [USB-4716 Hardware]
        AI["Analog Input Channels (ch0-ch7)"]
    end

    subgraph Pipeline [stream_to_db.py / mockup]
        direction TB
        DAQThread["🧵 DAQ-Reader Thread"]
        Queue[("📥 In-memory queue.Queue (maxsize=200)")]
        DBThread["🧵 DB-Writer Thread"]
        Stats[("📊 Stats Lock & Dict")]
        MonitorThread["🧵 Monitor Thread"]

        DAQThread -->|1. Poll via getDataF64| AI
        DAQThread -->|2. Wall-clock timestamping & raw enqueue| Queue
        DAQThread -->|Update stats| Stats
        Queue -->|3. Dequeue batch| DBThread
        DBThread -->|4. Parse interleaved samples & back-compute ts| DBThread
        DBThread -->|Update stats| Stats
        MonitorThread -->|Read stats & log stdout| Stats
    end

    subgraph PostgreSQL [TimescaleDB]
        daq_samples[("🗄️ daq_samples Table")]
    end

    subgraph Plot [plot_service]
        Plotter["📈 Interactive Plotly charts"]
    end

    DBThread -->|"5. execute_values (batch size=1000)"| daq_samples
    daq_samples -->|6. REST API SELECT| Plotter
```

---

## 2. Tech Stack

- **Frontend**: Vanilla HTML5, CSS Grid/Flexbox matching the Unified Industrial Cockpit Design Tokens, Javascript (ES6), Socket.io Client, and Plotly.js.
- **Backend Services**: Python 3, Flask, Flask-SocketIO, Eventlet (for high-concurrency event loops).
- **Ingestion Pipeline**: Multi-threaded Python pipeline, `psycopg2` bulk inserts, Advantech DAQNavi driver interface.
- **Database**: TimescaleDB / PostgreSQL (packaged as a Dockerized instance).

---

## 3. Quick Start (Step-by-Step)

### Prerequisites
Before launching the control suite, ensure you have the following installed:
- ✅ **Python** (v3.9 or higher)
- ✅ **Docker** and **Docker Compose**
- ✅ **Advantech DAQNavi SDK** (only required if running in `Real Hardware` mode; mockup mode runs driver-free)

### Step 1: Initialize Database Container
Launch the TimescaleDB database instance using Docker Compose:

```bash
docker compose up -d
```

**Expected Output**:
```
[+] Running 2/2
 ✔ Network daq-usb-4716_default  Created
 ✔ Container daq_tsdb            Started
```

### Step 2: Install Dependencies
Run the install script to bootstrap the virtual environment and install dependencies:

```bash
chmod +x install_deps.sh
./install_deps.sh
```

> 💡 **Tip**: This script creates a localized Python virtual environment (`venv`) and automatically upgrades `pip` before installing required packages from `requirements.txt`.

### Step 3: Run Ingestion Control Suite
Start the Portal Gateway, DAQ Control Panel, and Database Plotter backend services:

```bash
chmod +x run.sh
./run.sh
```

**Expected Output**:
```
[SYSTEM] Using Python interpreter: venv/bin/python
==========================================================
         MDDP Ingestion Control Suite Startup
==========================================================
[SYSTEM] Starting Ingestion Portal on Port 8080 (all interfaces)...
[SYSTEM] Starting DAQ Control Panel on Port 8081 (all interfaces)...
[SYSTEM] Starting Database Plotter on Port 8084 (all interfaces)...
[SYSTEM] Services launched in background.
[SYSTEM] Accessible locally at http://localhost:8080
[SYSTEM] Accessible network-wide at http://<HOST_IP>:8080
==========================================================
```

### Step 4: Verify Service Status
To verify the services are running and listening on the designated ports:

```bash
# On macOS/Linux:
lsof -i :8080 -i :8081 -i :8084
```

### Step 5: Start Data Ingestion
1. Open your browser and navigate to the Portal Gateway at [http://localhost:8080](http://localhost:8080).
2. Click **LAUNCH PANEL** on the **DAQ USB-4716** row to open the Control Panel at [http://localhost:8081](http://localhost:8081).
3. Select **MOCKUP** (or **REAL** if the hardware and drivers are connected) and click the green **START ACQUISITION** button.
4. You should see telemetry statistics updating and stdout logs streaming to the terminal console window.

### Step 6: Plot Interactive Telemetry
1. Return to the Portal Gateway or go directly to [http://localhost:8084](http://localhost:8084).
2. Select the channel matching your active configuration (e.g. Channel `0`) and click **Add Plot**.
3. Panning, zooming, and tracking options are available via the Plotly toolbar overlay.

### Step 7: Shutdown Services
To clean up and shut down background processes, run the stop script:

```bash
chmod +x stop.sh
./stop.sh
```

---

## 4. Configuration Documentation

The hardware interface, database connection parameters, and calibration parameters are configured via [USB4716/config.json](file:///Users/faiisu/projects.nosync/DAQ-USB-4716/USB4716/config.json).

### Required Parameters
| Parameter | Default Value | Description |
|:---|:---|:---|
| `DB_DSN` | `postgresql://admin:admin@172.21.108.86:5432/daq_db` | Connection DSN string for production TimescaleDB service. |
| `MOCKUP_DB_DSN` | `postgresql://admin:admin@localhost:5432/daq_db` | Connection DSN string for localized database testing. |
| `DEVICE_DESCRIPTION` | `USB-4716,BID#0` | Unique hardware identifier matching the Advantech DAQ card name. |

### Ingestion Parameter Tuning
| Parameter | Default Value | Description |
|:---|:---|:---|
| `START_CHANNEL` | `0` | Starting index of analog input channel scan. |
| `CHANNEL_COUNT` | `1` | Number of analog channels to scan (max 8 channels on single-ended connections). |
| `CLOCK_RATE` | `2000` | Hardware scanning frequency (samples per second per channel). |
| `SECTION_LENGTH` | `500` | Ingestion batch buffer size. Determines chunk size transferred to DB queue. |
| `QUEUE_MAXSIZE` | `200` | Maximum limit of the in-memory threading queue to protect against memory leaks. |
| `DB_PAGE_SIZE` | `1000` | Number of telemetry rows packed into a single database transactional `INSERT`. |

### Calibration & Scale Configs
The `SCALE_CONFIGS` block maps raw analog voltages (1V to 5V or 0V to 10V) to physical instrument metrics (e.g., pressure, flow, temperature).
```json
"SCALE_CONFIGS": {
  "0": {
    "enabled": true,
    "low_voltage": 1.0,
    "high_voltage": 5.0,
    "low_value": -100.0,
    "high_value": 100.0
  }
}
```
*If `enabled` is `true`, raw voltages reading from the channel are mapped linearly from `[low_voltage, high_voltage]` range into the `[low_value, high_value]` unit spectrum prior to storage.*

---

## 5. Project Structure

- `portal/`: Portal Gateway static site files.
  - [index.html](file:///Users/faiisu/projects.nosync/DAQ-USB-4716/portal/index.html): Central gateway cockpit web layout.
  - [app.js](file:///Users/faiisu/projects.nosync/DAQ-USB-4716/portal/app.js): Port heartbeat and uptime trackers.
- `USB4716/`: DAQ Controller daemon files.
  - [web_gui.py](file:///Users/faiisu/projects.nosync/DAQ-USB-4716/USB4716/web_gui.py): Controls python daemon cycles and streams stdout logs to client websockets.
  - [stream_to_db.py](file:///Users/faiisu/projects.nosync/DAQ-USB-4716/USB4716/stream_to_db.py): High-throughput hardware thread loop accessing Advantech library calls.
  - [mockup_stream_to_db.py](file:///Users/faiisu/projects.nosync/DAQ-USB-4716/USB4716/mockup_stream_to_db.py): Hardware-free mockup utility.
- `plot_service/`: Telemetry Visualizer web application files.
  - [app.py](file:///Users/faiisu/projects.nosync/DAQ-USB-4716/plot_service/app.py): REST API endpoints for connection testing and TimescaleDB querying.
  - `static/`: Frontend visual layout mapping Plotly grid resizing.
- `docs/`: Design systems documentation, diagrams, ERD, and context definitions.

---

## 6. Troubleshooting Tips

### ⚠️ Common Issue: Port Conflict
- **Symptom**: `[SYSTEM] Warning: PID files detected` or failed socket binding warnings during startup.
- **Solution**: Execute `./stop.sh` to clear dangling processes. If ports remain blocked, check processes listening on ports:
  ```bash
  kill -9 $(lsof -t -i :8080 -i :8081 -i :8084)
  ```

### ⚠️ Common Issue: TimescaleDB Connection Timeout
- **Symptom**: Log reports `psycopg2.OperationalError: connection to server at ... failed: Connection timed out`.
- **Solution**: Make sure Docker is running and verify status via `docker ps`. If connecting to an external server DSN, verify host accessibility via pinging:
  ```bash
  ping 172.21.108.86
  ```

### 💡 Recommendation: Running Mockup Mode for Local Work
If you are developing locally without an active USB-4716 hardware card:
1. Initialize the mockup database:
   ```sql
   CREATE DATABASE mockup;
   ```
2. Enable mockup mode in the DAQ Control Console (Port 8081).
3. The server will stream synthetic sinusoidal telemetry to the mockup database, enabling offline pipeline testing.
