# ============================================================
# Evolution API — Webhook Registration Script
# Run this AFTER:
#   1. n8n workflow is imported and ACTIVE
#   2. WhatsApp account is connected in Evolution API
# ============================================================

# --- FILL THESE IN BEFORE RUNNING ---
$EVOLUTION_API_URL  = "http://185.170.198.193:18709"
$EVOLUTION_API_KEY  = "admin"
$EVOLUTION_INSTANCE = "test"
$N8N_DOMAIN         = "https://s3odyn8n.tech"
# ------------------------------------

$webhookUrl = "$N8N_DOMAIN/webhook/whatsapp"

Write-Host ""
Write-Host "=== Registering Webhook in Evolution API ===" -ForegroundColor Cyan
Write-Host "  Instance  : $EVOLUTION_INSTANCE"
Write-Host "  Webhook   : $webhookUrl"
Write-Host ""

$headers = @{
    "apikey"       = $EVOLUTION_API_KEY
    "Content-Type" = "application/json"
}

$body = @{
    url             = $webhookUrl
    webhookByEvents = $true
    webhookBase64   = $false
    events          = @("MESSAGES_UPSERT")
} | ConvertTo-Json -Compress

# Register the webhook
try {
    $response = Invoke-RestMethod `
        -Uri "$EVOLUTION_API_URL/webhook/set/$EVOLUTION_INSTANCE" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -ContentType "application/json"

    Write-Host "✅ Webhook registered successfully!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json)
} catch {
    Write-Host "❌ Failed to register webhook:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

Write-Host ""
Write-Host "=== Verifying Webhook Registration ===" -ForegroundColor Cyan

# Verify the registration
try {
    $verify = Invoke-RestMethod `
        -Uri "$EVOLUTION_API_URL/webhook/find/$EVOLUTION_INSTANCE" `
        -Method GET `
        -Headers $headers

    Write-Host "✅ Webhook is registered:" -ForegroundColor Green
    Write-Host ($verify | ConvertTo-Json)
} catch {
    Write-Host "❌ Could not verify webhook:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

Write-Host ""
Write-Host "=== n8n Environment Variables to Set ===" -ForegroundColor Yellow
Write-Host "  Go to: n8n Settings > Environment Variables"
Write-Host ""
Write-Host "  EVOLUTION_API_URL      = http://185.170.198.193:18709"
Write-Host "  EVOLUTION_API_KEY      = admin"
Write-Host "  EVOLUTION_INSTANCE     = test"
Write-Host ""
