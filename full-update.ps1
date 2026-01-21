# Atualização total (com GitHub opcional) - Wappal Connect
# - Instala deps
# - Build / lint
# - Testes (pasta tests/)
# - Aplica migrations no Supabase (db push --linked)
# - Deploy de TODAS as Edge Functions em supabase/functions (exceto _shared)
# - (Opcional) GitHub: git status/add/commit/push
#
# Uso:
#   .\full-update.ps1
#   .\full-update.ps1 -CommitMessage "fix: deploy total"
#   .\full-update.ps1 -SkipTests
#   .\full-update.ps1 -SkipDb -SkipBuild
#
param(
  # Git/GitHub
  [switch]$SkipGit,
  [string]$CommitMessage = "",
  [switch]$Push = $true,

  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipLint,
  [switch]$SkipTests,
  [switch]$SkipDb,
  [switch]$SkipFunctions,
  [int]$TimeoutSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Section([string]$Title) {
  Write-Host ""
  Write-Host ("=" * 60) -ForegroundColor Cyan
  Write-Host $Title -ForegroundColor Cyan
  Write-Host ("=" * 60) -ForegroundColor Cyan
}

function HasCommand([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function InGitRepo() {
  if (-not (HasCommand "git")) { return $false }
  try {
    $out = (git rev-parse --is-inside-work-tree 2>$null)
    return ($out -eq "true")
  } catch {
    return $false
  }
}

function HasOriginRemote() {
  try {
    $null = (git remote get-url origin 2>$null)
    return $true
  } catch {
    return $false
  }
}

function Run([string]$Cmd, [string]$WorkDir = $PWD.Path, [int]$Timeout = 0) {
  Write-Host ">> $Cmd" -ForegroundColor Gray

  if ($Timeout -le 0) {
    Push-Location $WorkDir
    try {
      iex $Cmd
      if ($LASTEXITCODE -ne 0) { throw "Falhou ($LASTEXITCODE): $Cmd" }
    } finally {
      Pop-Location
    }
    return
  }

  $job = Start-Job -ScriptBlock {
    param($c, $wd)
    Set-Location $wd
    iex $c 2>&1
    return $LASTEXITCODE
  } -ArgumentList $Cmd, $WorkDir

  $completed = Wait-Job $job -Timeout $Timeout
  if (-not $completed) {
    Stop-Job $job | Out-Null
    Remove-Job $job -Force | Out-Null
    throw "TIMEOUT (${Timeout}s): $Cmd"
  }

  $exit = Receive-Job $job
  Remove-Job $job -Force | Out-Null
  if ($exit -ne 0) { throw "Falhou ($exit): $Cmd" }
}

Section "Atualização total - Wappal Connect"
Write-Host "Pasta: $($PWD.Path)" -ForegroundColor Gray

if (-not (Test-Path ".\package.json")) {
  throw "Execute este script na raiz do repo (onde existe package.json)."
}

if (-not (HasCommand "node")) { throw "Node.js não encontrado no PATH." }
if (-not (HasCommand "npm")) { throw "npm não encontrado no PATH." }
if (-not (HasCommand "npx")) { throw "npx não encontrado no PATH." }
if (-not $SkipGit -and -not (HasCommand "git")) { throw "git não encontrado no PATH (ou use -SkipGit)." }

# 0) GitHub (opcional)
if (-not $SkipGit) {
  Section "0) GitHub (git status/add/commit/push)"

  if (-not (InGitRepo)) {
    Write-Host "Não é um repositório Git (pulando etapa GitHub)." -ForegroundColor Yellow
  } else {
    Run "git status -sb"

    if ($CommitMessage -and $CommitMessage.Trim().Length -gt 0) {
      Run "git add ."

      # commit pode falhar (ex.: nada para commitar)
      try {
        Run ("git commit -m " + ('"' + $CommitMessage.Replace('"', '\"') + '"'))
      } catch {
        Write-Host "Commit não realizado (talvez não haja mudanças). Continuando..." -ForegroundColor Yellow
      }

      if ($Push) {
        if (-not (HasOriginRemote)) {
          Write-Host "Remote 'origin' não configurado. Pulando push." -ForegroundColor Yellow
        } else {
          try {
            Run "git push origin HEAD" $PWD.Path $TimeoutSeconds
            Write-Host "Push OK" -ForegroundColor Green
          } catch {
            Write-Host "Push falhou/timeout: $($_.Exception.Message)" -ForegroundColor Yellow
          }
        }
      } else {
        Write-Host "Push desativado (-Push:\$false)." -ForegroundColor Gray
      }
    } else {
      Write-Host "Sem -CommitMessage: não farei add/commit/push. (Passe -CommitMessage para publicar no GitHub.)" -ForegroundColor Gray
    }
  }
} else {
  Section "0) GitHub (pulado)"
}

# 1) Instalar dependências
if (-not $SkipInstall) {
  Section "1) Dependências (npm)"
  if (Test-Path ".\package-lock.json") {
    Run "npm ci"
  } else {
    Run "npm install"
  }
} else {
  Section "1) Dependências (pulado)"
}

# 2) Build / lint
if (-not $SkipBuild) {
  Section "2) Build"
  Run "npm run build"
} else {
  Section "2) Build (pulado)"
}

if (-not $SkipLint) {
  Section "3) Lint"
  Run "npm run lint"
} else {
  Section "3) Lint (pulado)"
}

# 3) Testes (pasta tests/)
if (-not $SkipTests) {
  Section "4) Testes (tests/)"
  if (Test-Path ".\tests\package.json") {
    Run "npm install" ".\tests"
    Run "npm run test" ".\tests"
  } else {
    Write-Host "Nenhuma pasta tests/ encontrada - pulando." -ForegroundColor Yellow
  }
} else {
  Section "4) Testes (pulado)"
}

# 4) Migrations / db push (Supabase)
if (-not $SkipDb) {
  Section "5) Supabase DB Push (migrations)"
  try {
    Run "npx supabase db push --linked" $PWD.Path $TimeoutSeconds
    Write-Host "DB push OK" -ForegroundColor Green
  } catch {
    Write-Host "DB push falhou/timeout: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Dica: confirme se o Supabase CLI está logado e o projeto está linked." -ForegroundColor Yellow
  }
} else {
  Section "5) DB Push (pulado)"
}

# 5) Deploy de todas as edge functions
if (-not $SkipFunctions) {
  Section "6) Deploy de TODAS as Edge Functions"

  if (-not (HasCommand "npx")) { throw "npx não encontrado no PATH." }

  $functionsDir = ".\supabase\functions"
  if (-not (Test-Path $functionsDir)) {
    throw "Pasta não encontrada: $functionsDir"
  }

  $funcFolders = Get-ChildItem -Path $functionsDir -Directory |
    Where-Object { $_.Name -ne "_shared" -and $_.Name -ne "temp" }

  if ($funcFolders.Count -eq 0) {
    Write-Host "Nenhuma function encontrada em supabase/functions" -ForegroundColor Yellow
  } else {
    $ok = 0
    $fail = 0

    foreach ($f in $funcFolders) {
      $name = $f.Name
      Write-Host "Deploy: $name" -ForegroundColor Yellow
      try {
        Run ("npx supabase functions deploy " + $name) $PWD.Path $TimeoutSeconds
        Write-Host "  OK" -ForegroundColor Green
        $ok++
      } catch {
        Write-Host "  FALHOU: $($_.Exception.Message)" -ForegroundColor Red
        $fail++
      }
    }

    Write-Host ""
    Write-Host "Resumo Functions: $ok OK, $fail falhas" -ForegroundColor Cyan
  }
} else {
  Section "6) Deploy Functions (pulado)"
}

Section "Fim"
Write-Host "Pronto. Se ainda 'parar', rode: node fetch_error_logs.cjs" -ForegroundColor Green
