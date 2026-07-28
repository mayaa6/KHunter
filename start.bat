@echo off
chcp 65001 >nul
title KHunter - Start

cd /d "%~dp0"

:: Check uv
uv --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] uv not found. Install it from https://docs.astral.sh/uv/
    pause
    exit /b 1
)

echo Synchronizing the locked environment...
uv sync --frozen --no-dev

:: Start server
echo.
echo Starting KHunter...
uv run --frozen python main.py web

pause
