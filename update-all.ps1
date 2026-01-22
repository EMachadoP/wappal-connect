# ============================================
# SCRIPT DE ATUALIZAÇÃO COMPLETA - G7 Client Connector
# Uso: .\update-all.ps1 [-Push] [-Message "sua mensagem"]
# ============================================

param(
    [switch]$Push,
    [string]$Message = "chore: atualização completa"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  G7 Client Connector - Update All" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Build do Frontend
Write-Host "[1/5] Building frontend..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Build falhou!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Build OK" -ForegroundColor Green

# 2. Deploy das Edge Functions
Write-Host ""
Write-Host "[2/5] Deploying Edge Functions..." -ForegroundColor Yellow
npx supabase functions deploy --project-ref qoolzhzdcfnyblymdvbq
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Deploy das funções falhou!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Functions deployed" -ForegroundColor Green

# 3. Git Add
Write-Host ""
Write-Host "[3/5] Staging changes..." -ForegroundColor Yellow
git add -A
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "Nenhuma alteração para commit" -ForegroundColor Gray
} else {
    Write-Host "Arquivos staged:" -ForegroundColor Gray
    Write-Host $status
}

# 4. Git Commit
Write-Host ""
Write-Host "[4/5] Committing..." -ForegroundColor Yellow
$hasChanges = git diff --cached --quiet; $hasChanges = $LASTEXITCODE -ne 0
if ($hasChanges) {
    git commit -m "$Message"
    Write-Host "✓ Commit criado" -ForegroundColor Green
} else {
    Write-Host "Nada para commit" -ForegroundColor Gray
}

# 5. Git Push (opcional)
Write-Host ""
if ($Push) {
    Write-Host "[5/5] Pushing to GitHub..." -ForegroundColor Yellow
    git push
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Push OK - Vercel vai fazer deploy automaticamente" -ForegroundColor Green
    } else {
        Write-Host "ERRO: Push falhou!" -ForegroundColor Red
    }
} else {
    Write-Host "[5/5] Push ignorado (use -Push para enviar ao GitHub)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  CONCLUÍDO!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Para atualização completa com push:" -ForegroundColor White
Write-Host '  .\update-all.ps1 -Push -Message "sua mensagem"' -ForegroundColor Yellow
