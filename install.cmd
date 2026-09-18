@echo off
rem Installs the AE MCP Bridge panel on Windows, linked to this checkout.
rem   install.cmd          link (edits are live)
rem   install.cmd --copy   real copy
if "%1"=="--copy" (
  node "%~dp0bin\install-panel.js"
) else (
  node "%~dp0bin\install-panel.js" --link
)
