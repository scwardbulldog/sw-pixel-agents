@echo off
REM Mock 'copilot' executable for Pixel Agents e2e tests (Windows).
REM
REM Behaviour:
REM   1. Parses --resume=<id> from args.
REM   2. Creates a new session directory with a random UUID if no --resume.
REM   3. Appends an invocation record to %HOME%\.copilot-mock\invocations.log.
REM   4. Creates the expected events.jsonl file under %HOME%\.copilot\session-state\<id>\
REM   5. Stays alive for up to 30 s (tests can kill it once assertions pass).

setlocal enabledelayedexpansion

set "SESSION_ID="

:parse_args
if "%~1"=="" goto done_args
set "ARG=%~1"
if "!ARG:~0,9!"=="--resume=" (
  set "SESSION_ID=!ARG:~9!"
)
shift
goto parse_args
:done_args

REM Generate UUID if no session ID provided
if "%SESSION_ID%"=="" (
  for /f "delims=" %%U in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString()"') do set "SESSION_ID=%%U"
)

REM Use HOME if set (our e2e sets it), fall back to USERPROFILE
if defined HOME (
  set "MOCK_HOME=%HOME%"
) else (
  set "MOCK_HOME=%USERPROFILE%"
)

set "LOG_DIR=%MOCK_HOME%\.copilot-mock"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
echo %DATE% %TIME% session-id=%SESSION_ID% cwd=%CD% args=%* >> "%LOG_DIR%\invocations.log"

set "SESSION_DIR=%MOCK_HOME%\.copilot\session-state\%SESSION_ID%"
if not exist "%SESSION_DIR%" mkdir "%SESSION_DIR%"

set "JSONL_FILE=%SESSION_DIR%\events.jsonl"
echo {"type":"session.start","data":{"sessionId":"%SESSION_ID%","version":1,"producer":"mock-copilot"}} >> "%JSONL_FILE%"

REM Stay alive so the VS Code terminal doesn't immediately close.
REM Use ping to localhost as a cross-platform sleep (timeout command requires console).
ping -n 31 127.0.0.1 > nul 2>&1
