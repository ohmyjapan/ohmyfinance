# Run this script as Administrator in PowerShell
# Right-click PowerShell -> Run as Administrator
# Then: Set-ExecutionPolicy Bypass -Scope Process -Force; .\setup-wsl-access.ps1

Write-Host "Setting up WSL2 port forwarding..." -ForegroundColor Cyan

# Get WSL IP
$wslIP = (wsl hostname -I).Trim().Split()[0]
Write-Host "WSL IP: $wslIP" -ForegroundColor Yellow

# Remove old rule if exists
netsh interface portproxy delete v4tov4 listenport=6100 listenaddress=0.0.0.0 2>$null

# Add port forwarding
netsh interface portproxy add v4tov4 listenport=6100 listenaddress=0.0.0.0 connectport=6100 connectaddress=$wslIP
Write-Host "Port forwarding added" -ForegroundColor Green

# Add firewall rule
Remove-NetFirewallRule -DisplayName "WSL2 Nuxt Dev Server" -ErrorAction SilentlyContinue 2>$null
New-NetFirewallRule -DisplayName "WSL2 Nuxt Dev Server" -Direction Inbound -LocalPort 6100 -Protocol TCP -Action Allow | Out-Null
Write-Host "Firewall rule added" -ForegroundColor Green

# Show current forwarding
Write-Host "`nCurrent port forwarding:" -ForegroundColor Cyan
netsh interface portproxy show v4tov4

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "Setup complete! Open http://localhost:6100/" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# Try to open browser
Start-Process "http://localhost:6100/"
