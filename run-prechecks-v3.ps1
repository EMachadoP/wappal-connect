# psql-based prechecks
$ErrorActionPreference = "Continue"

# Parse .env
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
        }
    }
}

$headers = @{
    "apikey"        = $env:SUPABASE_SERVICE_ROLE_KEY
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
}

Write-Host "🔍 [PRE-CHECK] Calling REST API carefully..." -ForegroundColor Cyan

# Use a hashtable for URL parameters to avoid ampersands in the string
$params = @{
    "thread_key" = "like.u:*"
    "select"     = "id"
}
# Construct URL manually with escaped ampersand or use a better method
$url = "$($env:SUPABASE_URL)/rest/v1/conversations?thread_key=like.u%3A*&select=id"

try {
    $res = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
    Write-Host "U_COUNT: $($res.Count)" -ForegroundColor Green
    
    # Check Eldon's phone
    $urlEldon = "$($env:SUPABASE_URL)/rest/v1/conversations?chat_id=ilike.*558197438430*&select=id,thread_key"
    # Even simpler: just use separate calls if needed, but let's try backtick escaping
    $uriEldon = "$($env:SUPABASE_URL)/rest/v1/conversations?chat_id=ilike.*558197438430*`&select=id,thread_key"
    $resEldon = Invoke-RestMethod -Uri $uriEldon -Headers $headers -Method Get
    Write-Host "`n🔍 Eldon's Conversations:" -ForegroundColor Yellow
    $resEldon | Format-Table -AutoSize
}
catch {
    Write-Host "X Error: $($_.Exception.Message)" -ForegroundColor Red
}
