# Auto-commit and push for AI量化
Set-Location "C:\Users\kjq\Desktop\AI量化"

# Check if this is a git repo
if (-not (Test-Path ".git")) {
    Write-Output "[SKIP] Not a git repo"
    exit 0
}

# Check for uncommitted changes
$status = git status --porcelain 2>&1
if (-not $status) {
    Write-Output "[OK] No changes"
    exit 0
}

# Commit and push
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
git add -A 2>&1 | Out-Null
git commit -m "auto: $timestamp" 2>&1 | Out-Null
git push 2>&1 | Out-Null

Write-Output "[PUSHED] $timestamp — changes pushed to origin/main"
