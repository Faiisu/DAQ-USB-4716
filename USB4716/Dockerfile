# Dockerfile
# See: docs/architecture/context.md
# English comments only

# Use official lightweight Python image
FROM python:3.11-slim

# Prevent Python from buffering stdout/stderr (crucial for live logging)
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install build dependencies for postgres compiler bindings
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code files into image
COPY . .

# Expose Web GUI port
EXPOSE 8081

# Run Web GUI server on start
CMD ["python", "web_gui.py"]
