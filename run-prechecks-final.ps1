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

$script:key = $env:SUPABASE_SERVICE_ROLE_KEY
$script:url = $env:SUPABASE_URL

$headers = @{}
$headers.Add("apikey", $script:key)
$headers.Add("Authorization", "Bearer " + $script:key)

Write-Host "🔍 [PRE-CHECK] Results:" -ForegroundColor Cyan

# 1. Count u:%
try {
    $u_uri = $script:url + "/rest/v1/conversations?thread_key=like.u%3A*"
    $u_res = Invoke-RestMethod -Uri $u_uri -Headers $headers -Method Get
    $u_cnt = 0
    if ($null -ne $u_res) { $u_cnt = $u_res.Count }
    Write-Host "U_COUNT: $u_cnt" -ForegroundColor Green
}
catch {
    Write-Host "X Error: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. Eldon's Duplicates (Single parameter to avoid &)
try {
    $e_uri = $script:url + "/rest/v1/conversations?chat_id=ilike.*558197438430*"
    $e_res = Invoke-RestMethod -Uri $e_uri -Headers $headers -Method Get
    Write-Host "`n🔍 Eldon's Conversations (Raw):" -ForegroundColor Yellow
    if ($null -ne $e_res) { $e_res | Select-Object id, thread_key, contact_id | Format-Table -AutoSize }
}
catch {
    Write-Host "X Error: $($_.Exception.Message)" -ForegroundColor Red
}
