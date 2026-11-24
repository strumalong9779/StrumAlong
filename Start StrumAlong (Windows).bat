@echo off
rem Starts a small web server for this folder (only this computer can reach it) and opens the browser.
cd /d "%~dp0"
start "StrumAlong server - close this window to stop" /min python -m http.server 8732 --bind 127.0.0.1
timeout /t 2 >nul
start "" http://localhost:8732/
