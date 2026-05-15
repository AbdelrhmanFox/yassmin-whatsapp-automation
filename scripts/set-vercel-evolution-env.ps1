# Run after: npx vercel login
# Project: yassmin-whatsapp-automation (see .vercel/project.json)
param(
  [string]$ApiKey = $env:EVOLUTION_API_KEY
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $ApiKey) {
  Write-Host 'Get apikey from Evolution Manager (instance Yas) or n8n HTTP nodes, then run:'
  Write-Host '  $env:EVOLUTION_API_KEY = "YOUR_KEY"'
  Write-Host '  .\scripts\set-vercel-evolution-env.ps1'
  exit 1
}

$vars = @{
  EVOLUTION_API_URL      = 'https://evolution.growleadpro.com'
  EVOLUTION_INSTANCE     = 'Yas'
  EVOLUTION_API_KEY      = $ApiKey
}

foreach ($target in @('production', 'preview', 'development')) {
  foreach ($name in $vars.Keys) {
    $value = $vars[$name]
    Write-Host "Setting $name ($target)..."
    $value | npx vercel@latest env add $name $target --force 2>&1
  }
}

Write-Host 'Done. Redeploy: npx vercel --prod'
