FROM python:3.11-slim

WORKDIR /app

# Install Docker CLI so the GUI can interact with the host Docker daemon
COPY --from=docker:latest /usr/local/bin/docker /usr/local/bin/docker

# Install dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . /app/

# Expose Web GUI port
EXPOSE 5050

# Environment variables
ENV RUNNING_IN_DOCKER=true

# Entrypoint to run the Flask application
CMD ["python", "web_gui/app.py"]
