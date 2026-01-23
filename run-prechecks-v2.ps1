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

$dbUrl = $env:DATABASE_URL
if (!$dbUrl) {
    Write-Host "X DATABASE_URL not found in .env" -ForegroundColor Red
    exit 1
}

# Simple SQL check using psql if available, or just use the REST API with a properly escaped query
# Let's try REST again but with NO ampersands in the string, using a hash table for Invoke-RestMethod
$headers = @{
    "apikey"        = $env:SUPABASE_SERVICE_ROLE_KEY
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
}

Write-Host "🔍 [PRE-CHECK] Calling REST API carefully..." -ForegroundColor Cyan

$baseUri = "$($env:SUPABASE_URL)/rest/v1/conversations"

# U_COUNT
try {
    $res = Invoke-RestMethod -Uri "$baseUri?thread_key=like.u:*&select=id" -Headers $headers -Method Get
    Write-Host "U_COUNT: $($res.Count)" -ForegroundColor Green
}
catch {
    Write-Host "X Error counting u:% : $($_.Exception.Message)" -ForegroundColor Red
}

# DUPLICATES
try {
    # We'll just check Eldon's phone specifically since full grouping is hard in REST
    $res = Invoke-RestMethod -Uri "$baseUri?chat_id=ilike.*558197438430*&select=id,thread_key" -Headers $headers -Method Get
    Write-Host "`n🔍 Eldon's Conversations:" -ForegroundColor Yellow
    $res | Format-Table -AutoSize
}
catch {
    Write-Host "X Error checking Eldon's duplicates: $($_.Exception.Message)" -ForegroundColor Red
}
