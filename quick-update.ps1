# Script de Atualizacao Rapida
# Para quando voce so quer fazer push sem deploy de Edge Functions

param(
    [Parameter(Mandatory = $true)]
    [string]$CommitMessage
)

Write-Host "Atualizacao Rapida..." -ForegroundColor Cyan
Write-Host ""

# Git Add
Write-Host "Adicionando arquivos..." -ForegroundColor Yellow
git add .
Write-Host "Arquivos adicionados" -ForegroundColor Green
Write-Host ""

# Git Commit
Write-Host "Fazendo commit..." -ForegroundColor Yellow
git commit -m "$CommitMessage"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Nenhuma mudanca para commit" -ForegroundColor Yellow
    exit 0
}
Write-Host "Commit realizado" -ForegroundColor Green
Write-Host ""

# Git Push
Write-Host "Enviando para GitHub..." -ForegroundColor Yellow
git push origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao fazer push" -ForegroundColor Red
    exit 1
}
Write-Host "Push realizado com sucesso" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "ATUALIZACAO COMPLETA!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Vercel esta fazendo deploy automatico..." -ForegroundColor Yellow
Write-Host "Acompanhe em: https://vercel.com/eldons-projects-3194802d/wappal-connect/deployments" -ForegroundColor Cyan
Write-Host ""
