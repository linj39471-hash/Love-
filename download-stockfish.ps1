$ErrorActionPreference = "Stop"

$Version = "18.0.8"
$BaseUrl = "https://unpkg.com/stockfish@$Version/bin"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TargetDir = Join-Path $RootDir "stockfish"

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

Invoke-WebRequest `
    -Uri "$BaseUrl/stockfish-18-lite-single.js" `
    -OutFile (Join-Path $TargetDir "stockfish-18-lite-single.js")

Invoke-WebRequest `
    -Uri "$BaseUrl/stockfish-18-lite-single.wasm" `
    -OutFile (Join-Path $TargetDir "stockfish-18-lite-single.wasm")

Write-Host "Stockfish 18 files downloaded to: $TargetDir"
