# Extremely simplified check
$headers = @{
    "apikey"        = [System.Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY", "User")
    "Authorization" = "Bearer " + [System.Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY", "User")
}

# Fallback to .env if environment variables aren't set in the shell session
if ([string]::IsNullOrEmpty($env:SUPABASE_SERVICE_ROLE_KEY)) {
    if (Test-Path ".env") {
        Get-Content ".env" | ForEach-Object {
            if ($_ -match '^([^=]+)=(.*)$') {
                $k = $matches[1].Trim()
                $v = $matches[2].Trim()
                if ($k -eq "SUPABASE_SERVICE_ROLE_KEY") { $script:supabaseKey = $v }
                if ($k -eq "SUPABASE_URL") { $script:supabaseUrl = $v }
            }
        }
        $headers["apikey"] = $script:supabaseKey
        $headers["Authorization"] = "Bearer " + $script:supabaseKey
    }
}
else {
    $script:supabaseUrl = $env:SUPABASE_URL
}

Write-Host "🔍 [PRE-CHECK] Getting legacy count..." -ForegroundColor Cyan

$url = $script:supabaseUrl + "/rest/v1/conversations?thread_key=like.u:*"

try {
    $res = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
    if ($null -eq $res) {
        Write-Host "U_COUNT: 0" -ForegroundColor Green
    }
    else {
        Write-Host "U_COUNT: $($res.Count)" -ForegroundColor Green
        if ($res.Count -gt 0) {
            $res | Select-Object -First 3 | Format-Table id, thread_key, contact_id -AutoSize
        }
    }
}
catch {
    Write-Host "X Error: $($_.Exception.Message)" -ForegroundColor Red
}
