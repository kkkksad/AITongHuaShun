# AI量化 持续开发循环 v2
# 功能: 检测变更 → 自动推送 → 每10分钟触发AI继续开发 → 循环

$projectDir = "C:\Users\kjq\Desktop\AI量化"
$hermesCli = "C:\Users\kjq\AppData\Local\Hermes Agent CN Desktop\data\versions\0.17.0-cn.5\hermes-agent-cn-runtime-win32-x64.exe"
$lastAgentRun = [DateTime]::MinValue
$AgentIntervalMinutes = 10

Write-Host "========================================"
Write-Host " AI量化 持续开发循环 v2"
Write-Host " 自动推送cron: 每2分钟"
Write-Host " AI开发触发: 每${AgentIntervalMinutes}分钟"
Write-Host " 启动时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "========================================"

while ($true) {
    Set-Location $projectDir
    
    # 检查是否需要触发AI agent
    $elapsed = [DateTime]::Now - $lastAgentRun
    if ($elapsed.TotalMinutes -ge $AgentIntervalMinutes) {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Write-Host "[$ts] === 触发AI agent ==="
        
        git pull 2>&1 | Out-Null
        
        $prompt = "继续开发AI量化项目。先查看当前项目代码状态和最新提交，然后选择最重要的功能实现。完成后git add -A && git commit -m 'feat: 描述' && git push。目标实盘交易。不要停止。"
        
        # 后台启动，不等待
        $args = @('chat', '-q', $prompt, '-t', 'terminal,file,web', '-w')
        Start-Process -FilePath $hermesCli -ArgumentList $args -WindowStyle Minimized
        $lastAgentRun = [DateTime]::Now
        Write-Host "[$ts] Agent已触发 (后台)"
    } else {
        $remain = $AgentIntervalMinutes - [math]::Floor($elapsed.TotalMinutes)
        Write-Host "$(Get-Date -Format 'HH:mm:ss') 等待... (下次agent: ${remain}分钟后)"
    }
    
    Start-Sleep -Seconds 60
}
