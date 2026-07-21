import sqlite3
import datetime
import os
import logging

logger = logging.getLogger(__name__)

class DatabaseHandler:
    def __init__(self, db_config):
        """
        Initializes Database Connection based on configuration.
        Supports SQLite out of the box, with extensible support for PostgreSQL/MySQL.
        """
        self.config = db_config
        self.db_type = db_config.get("db_type", "sqlite").lower()
        self.db_name = db_config.get("db_name", "musashi_data.db")
        self.table_name = db_config.get("table_name", "musashi_telemetry")
        self.description = db_config.get("description", "MUSASHI Dispenser Telemetry DB")
        
        self.conn = None
        self.connect()
        self.init_db()

    def connect(self):
        """Establishes connection to the configured database."""
        if self.db_type == "sqlite":
            self.conn = sqlite3.connect(self.db_name, check_same_thread=False)
            logger.info(f"Connected to SQLite database: {self.db_name}")
        elif self.db_type in ("postgres", "postgresql", "timescaledb"):
            try:
                import psycopg2
                self.conn = psycopg2.connect(
                    dbname=self.db_name,
                    user=self.config.get("user", "postgres"),
                    password=self.config.get("password", ""),
                    host=self.config.get("host", "localhost"),
                    port=self.config.get("port", 5432)
                )
                logger.info(f"Connected to PostgreSQL database: {self.db_name} at {self.config.get('host')}")
            except ImportError:
                raise ImportError("psycopg2 package is required for PostgreSQL connections.")
        elif self.db_type == "mysql":
            try:
                import mysql.connector
                self.conn = mysql.connector.connect(
                    database=self.db_name,
                    user=self.config.get("user", "root"),
                    password=self.config.get("password", ""),
                    host=self.config.get("host", "localhost"),
                    port=self.config.get("port", 3306)
                )
                logger.info(f"Connected to MySQL database: {self.db_name} at {self.config.get('host')}")
            except ImportError:
                raise ImportError("mysql-connector-python package is required for MySQL connections.")
        else:
            raise ValueError(f"Unsupported database type: {self.db_type}")

    def init_db(self):
        """Creates the target table if it does not already exist."""
        cursor = self.conn.cursor()
        
        if self.db_type == "sqlite":
            query = f"""
            CREATE TABLE IF NOT EXISTS {self.table_name} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                channel INTEGER NOT NULL,
                pressure_kpa REAL NOT NULL,
                pressure_raw INTEGER NOT NULL,
                time_ms INTEGER NOT NULL,
                time_sec REAL NOT NULL,
                vacuum_kpa REAL NOT NULL,
                mode_code INTEGER NOT NULL,
                mode_name TEXT NOT NULL,
                product_name TEXT NOT NULL,
                raw_payload TEXT NOT NULL
            );
            """
        elif self.db_type in ("postgres", "postgresql", "timescaledb"):
            query = f"""
            CREATE TABLE IF NOT EXISTS {self.table_name} (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
                channel INT NOT NULL,
                pressure_kpa DOUBLE PRECISION NOT NULL,
                pressure_raw INT NOT NULL,
                time_ms INT NOT NULL,
                time_sec DOUBLE PRECISION NOT NULL,
                vacuum_kpa DOUBLE PRECISION NOT NULL,
                mode_code INT NOT NULL,
                mode_name VARCHAR(50) NOT NULL,
                product_name VARCHAR(100) NOT NULL,
                raw_payload TEXT NOT NULL
            );
            """
        elif self.db_type == "mysql":
            query = f"""
            CREATE TABLE IF NOT EXISTS {self.table_name} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                timestamp DATETIME NOT NULL,
                channel INT NOT NULL,
                pressure_kpa DOUBLE NOT NULL,
                pressure_raw INT NOT NULL,
                time_ms INT NOT NULL,
                time_sec DOUBLE NOT NULL,
                vacuum_kpa DOUBLE NOT NULL,
                mode_code INT NOT NULL,
                mode_name VARCHAR(50) NOT NULL,
                product_name VARCHAR(100) NOT NULL,
                raw_payload TEXT NOT NULL
            );
            """
        
        cursor.execute(query)
        self.conn.commit()
        cursor.close()
        logger.info(f"Database table '{self.table_name}' verified/initialized.")

    def insert_telemetry(self, data):
        """
        Inserts a single telemetry record into the database.
        
        :param data: Dictionary containing telemetry parameters from MusashiDispenser
        :return: Inserted record ID or boolean success
        """
        cursor = self.conn.cursor()
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        if self.db_type == "sqlite":
            db_timestamp = now_dt.isoformat(" ")
        else:
            db_timestamp = now_dt

        if self.db_type in ("sqlite", "postgres", "postgresql", "timescaledb"):
            placeholder = "%s" if self.db_type != "sqlite" else "?"
            query = f"""
            INSERT INTO {self.table_name} (
                timestamp, channel, pressure_kpa, pressure_raw,
                time_ms, time_sec, vacuum_kpa, mode_code,
                mode_name, product_name, raw_payload
            ) VALUES ({', '.join([placeholder]*11)});
            """
            params = (
                db_timestamp,
                data.get("channel", 1),
                data.get("pressure_kpa", 0.0),
                data.get("pressure_raw", 0),
                data.get("time_ms", 0),
                data.get("time_sec", 0.0),
                data.get("vacuum_kpa", 0.0),
                data.get("mode_code", 0),
                data.get("mode_name", ""),
                data.get("product_name", ""),
                data.get("raw_payload", "")
            )
        elif self.db_type == "mysql":
            query = f"""
            INSERT INTO {self.table_name} (
                timestamp, channel, pressure_kpa, pressure_raw,
                time_ms, time_sec, vacuum_kpa, mode_code,
                mode_name, product_name, raw_payload
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
            """
            params = (
                db_timestamp,
                data.get("channel", 1),
                data.get("pressure_kpa", 0.0),
                data.get("pressure_raw", 0),
                data.get("time_ms", 0),
                data.get("time_sec", 0.0),
                data.get("vacuum_kpa", 0.0),
                data.get("mode_code", 0),
                data.get("mode_name", ""),
                data.get("product_name", ""),
                data.get("raw_payload", "")
            )

        cursor.execute(query, params)
        self.conn.commit()
        last_row_id = getattr(cursor, "lastrowid", None)
        cursor.close()
        logger.info(f"Inserted record into '{self.table_name}' at {now_dt}")
        return last_row_id

    def close(self):
        """Closes the database connection cleanly."""
        if self.conn:
            self.conn.close()
            self.conn = None
            logger.info("Database connection closed.")
