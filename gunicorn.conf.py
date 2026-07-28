"""Gunicorn settings for the single-instance KHunter deployment."""

import os


bind = f"0.0.0.0:{os.getenv('PORT', '5001')}"
workers = 1
worker_class = "gthread"
threads = int(os.getenv("GUNICORN_THREADS", "8"))
timeout = int(os.getenv("GUNICORN_TIMEOUT", "3600"))
graceful_timeout = 30
keepalive = 5

accesslog = "-"
errorlog = "-"
capture_output = True

# SQLite and the application's in-memory task state require a single process.
preload_app = False
