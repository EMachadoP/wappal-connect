# Simplified check
$headers = @{
    "apikey"        = $env:SUPABASE_SERVICE_ROLE_KEY
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
}

Write-Host "🔍 [PRE-CHECK] Getting legacy count..." -ForegroundColor Cyan

# Avoid ampersands by making two separate calls or using simpler query
$url = "$($env:SUPABASE_URL)/rest/v1/conversations?thread_key=like.u%3A*"

try {
    $res = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
    Write-Host "U_COUNT: $($res.Count)" -ForegroundColor Green
    
    if ($res.Count -gt 0) {
        Write-Host "`n🔍 Sample legacy thread_keys:" -ForegroundColor Yellow
        $res | Select-Object -First 5 | Format-Table id, thread_key, contact_id -AutoSize
    }
}
catch {
    Write-Host "X Error: $($_.Exception.Message)" -ForegroundColor Red
}
