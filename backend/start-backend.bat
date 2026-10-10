@echo off
REM Double-click to start the AutoCorrect AI local proxy (reads GROQ_API_KEY from .env)
cd /d "%~dp0.."
node backend\server.mjs
pause
