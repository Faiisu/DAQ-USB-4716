# ──────────────────────────────────────────────────────────────
#  DAQ USB-4716  —  Makefile
# ──────────────────────────────────────────────────────────────

PYTHON   ?= python3
PIP      ?= pip3
VENV_DIR ?= .venv

.PHONY: help install venv run db db-stop db-logs db-reset clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ── Python Environment ───────────────────────────────────────

venv: ## Create virtual environment
	$(PYTHON) -m venv $(VENV_DIR)
	@echo "Activate with:  source $(VENV_DIR)/bin/activate"

install: ## Install Python dependencies
	$(PIP) install -r requirements.txt

# ── Web GUI ──────────────────────────────────────────────────

run: ## Start Web GUI  (http://localhost:5050)
	$(PYTHON) web_gui/app.py

# ── TimescaleDB (Docker) ────────────────────────────────────

db: ## Start TimescaleDB container
	docker compose up -d

db-stop: ## Stop TimescaleDB container
	docker compose down

db-logs: ## Tail TimescaleDB logs
	docker compose logs -f timescaledb

db-reset: ## Wipe DB data and restart fresh
	docker compose down -v
	rm -rf pgdata
	docker compose up -d

# ── Cleanup ──────────────────────────────────────────────────

clean: ## Remove caches and compiled files
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
