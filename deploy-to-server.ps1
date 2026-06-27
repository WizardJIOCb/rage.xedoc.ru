# Helper script to set up git remote and push to production server
# Run this from PowerShell in the project folder

$ServerIP = "82.146.42.213"
$ServerUser = "root"   # Change if you use another user
$RemotePath = "/var/www/rage.xedoc.ru.git"
$RemoteName = "production"

$RemoteUrl = "ssh://${ServerUser}@${ServerIP}${RemotePath}"

Write-Host "=== RAGE ARENA Deploy Helper ===" -ForegroundColor Cyan
Write-Host "Target: $RemoteUrl"
Write-Host ""

# Check if remote already exists
$existing = git remote | Select-String $RemoteName
if ($existing) {
    Write-Host "Remote '$RemoteName' already exists. Updating URL..." -ForegroundColor Yellow
    git remote set-url $RemoteName $RemoteUrl
} else {
    Write-Host "Adding git remote '$RemoteName'..." -ForegroundColor Green
    git remote add $RemoteName $RemoteUrl
}

Write-Host ""
Write-Host "Current remotes:" -ForegroundColor Gray
git remote -v

Write-Host ""
$confirm = Read-Host "Push to production now? (y/N)"

if ($confirm -eq 'y' -or $confirm -eq 'Y') {
    Write-Host "Pushing to production..." -ForegroundColor Green
    git push $RemoteName main
    Write-Host ""
    Write-Host "✅ Pushed! Now check the server for deployment logs." -ForegroundColor Green
    Write-Host "On the server run: pm2 logs rage-arena" -ForegroundColor Gray
} else {
    Write-Host "Push skipped. You can run manually:" -ForegroundColor Yellow
    Write-Host "  git push $RemoteName main" -ForegroundColor White
}