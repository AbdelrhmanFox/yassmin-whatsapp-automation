$headers = @{
    "apikey"       = "admin"
    "Content-Type" = "application/json"
}

$bodyObj = @{
    webhook = @{
        enabled         = $true
        url             = "https://s3odyn8n.tech/webhook/whatsapp"
        webhookByEvents = $true
        webhookBase64   = $false
        events          = @("MESSAGES_UPSERT")
    }
}

$body = $bodyObj | ConvertTo-Json -Depth 5 -Compress

Write-Host "Body being sent: $body"
Write-Host ""

Write-Host "=== Registering Webhook ===" -ForegroundColor Cyan

try {
    $r = Invoke-RestMethod `
        -Uri "http://185.170.198.193:18709/webhook/set/test" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -ContentType "application/json"

    Write-Host "SUCCESS!" -ForegroundColor Green
    Write-Host ($r | ConvertTo-Json -Depth 5)
} catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "DETAIL: $($_.ErrorDetails.Message)"
}

Write-Host ""
Write-Host "=== Verifying ===" -ForegroundColor Cyan

try {
    $v = Invoke-RestMethod `
        -Uri "http://185.170.198.193:18709/webhook/find/test" `
        -Method GET `
        -Headers $headers

    Write-Host ($v | ConvertTo-Json -Depth 5)
} catch {
    Write-Host "FAIL: $($_.Exception.Message)"
    Write-Host "DETAIL: $($_.ErrorDetails.Message)"
}
