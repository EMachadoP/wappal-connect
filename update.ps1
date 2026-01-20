# Script de Atualizacao Completa
# Uso: .\update.ps1 "mensagem do commit"

param(
    [Parameter(Mandatory = $true)]
    [string]$CommitMessage
)

Write-Host ""
Write-Host "RELEASE COMPLETO - WAPPAL CONNECT" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# 1. Git Add
# ============================================
Write-Host "[1/5] Adicionando arquivos ao Git..." -ForegroundColor Yellow
git add .

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao adicionar arquivos" -ForegroundColor Red
    exit 1
}
Write-Host "    Arquivos adicionados" -ForegroundColor Green

# ============================================
# 2. Git Commit
# ============================================
Write-Host "[2/5] Fazendo commit..." -ForegroundColor Yellow
git commit -m "$CommitMessage" --allow-empty

if ($LASTEXITCODE -ne 0) {
    Write-Host "    Aviso: Commit pode estar vazio ou houve erro" -ForegroundColor Yellow
}
else {
    Write-Host "    Commit realizado" -ForegroundColor Green
}

# ============================================
# 3. Git Push
# ============================================
Write-Host "[3/5] Enviando para GitHub..." -ForegroundColor Yellow
git push origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao fazer push" -ForegroundColor Red
    exit 1
}
Write-Host "    Push realizado com sucesso" -ForegroundColor Green

# ============================================
# 4. Aplicar Migrations (Supabase DB Push)
# ============================================
Write-Host "[4/5] Aplicando migrations no banco..." -ForegroundColor Yellow

$dbJob = Start-Job -ScriptBlock {
    npx supabase db push --linked 2>&1
}

$dbCompleted = Wait-Job $dbJob -Timeout 60

if ($dbCompleted) {
    $dbOutput = Receive-Job $dbJob
    Remove-Job $dbJob -Force
    if ($dbOutput -match "error" -or $dbOutput -match "Error") {
        Write-Host "    Migrations: Aviso - verifique logs" -ForegroundColor Yellow
    }
    else {
        Write-Host "    Migrations aplicadas" -ForegroundColor Green
    }
}
else {
    Stop-Job $dbJob
    Remove-Job $dbJob -Force
    Write-Host "    Migrations: Timeout (60s) - verifique manualmente" -ForegroundColor Yellow
}

# ============================================
# 5. Deploy Edge Functions (com timeout)
# ============================================
Write-Host "[5/5] Deploy das Edge Functions..." -ForegroundColor Yellow

$functions = @(
    "zapi-webhook",
    "zapi-send-message",
    "ai-maybe-reply",
    "ai-generate-reply",
    "ai-auto-reactivate",
    "create-protocol",
    "protocol-opened",
    "sla-metrics",
    "assign-conversation",
    "transcribe-audio",
    "create-agent"
)

$success = 0
$failed = 0
$timeoutSeconds = 45

foreach ($func in $functions) {
    $funcPath = "supabase/functions/$func"
    if (-not (Test-Path $funcPath)) {
        continue
    }

    Write-Host "    $func..." -ForegroundColor Gray -NoNewline

    $job = Start-Job -ScriptBlock {
        param($funcName)
        npx supabase functions deploy $funcName 2>&1
    } -ArgumentList $func

    $completed = Wait-Job $job -Timeout $timeoutSeconds

    if ($completed) {
        $null = Receive-Job $job
        Remove-Job $job -Force
        Write-Host " OK" -ForegroundColor Green
        $success++
    }
    else {
        Stop-Job $job
        Remove-Job $job -Force
        Write-Host " TIMEOUT" -ForegroundColor Yellow
        $failed++
    }
}

Write-Host ""
Write-Host "    Functions: $success sucesso, $failed timeout" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })
