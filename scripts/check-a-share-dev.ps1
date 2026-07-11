param(
    [string]$WebUrl = "http://127.0.0.1:4173",
    [string]$ApiUrl = "http://127.0.0.1:8787",
    [string]$BridgeUrl = "http://127.0.0.1:8800"
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

function Test-JsonEndpoint {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Url
    )

    try {
        $response = Invoke-WebRequest `
            -Uri $Url `
            -Headers @{ Accept = "application/json" } `
            -UseBasicParsing `
            -TimeoutSec 20

        $contentType = [string]$response.Headers["Content-Type"]
        if ($contentType -notmatch "application/json") {
            $preview = $response.Content.Trim() -replace "\s+", " "
            if ($preview.Length -gt 180) {
                $preview = $preview.Substring(0, 180)
            }
            throw "$Name returned non-JSON content: $contentType; preview: $preview"
        }

        $json = $response.Content | ConvertFrom-Json
        [PSCustomObject]@{
            Name = $Name
            Ok = $true
            Url = $Url
            Detail = $json
        }
    }
    catch {
        [PSCustomObject]@{
            Name = $Name
            Ok = $false
            Url = $Url
            Detail = $_.Exception.Message
        }
    }
}

$checks = @(
    Test-JsonEndpoint -Name "Fastify API" -Url "$ApiUrl/api/health"
    Test-JsonEndpoint -Name "AkShare Bridge" -Url "$BridgeUrl/api/health"
    Test-JsonEndpoint -Name "Vite API Proxy" -Url "$WebUrl/api/health"
    Test-JsonEndpoint -Name "A-share Index Quotes" -Url "$BridgeUrl/api/market/indices?symbols=SH000001,SZ399001,SZ399006,SH000300"
    Test-JsonEndpoint -Name "A-share Stock Quotes" -Url "$BridgeUrl/api/market/quotes?symbols=600519,000001,300750"
    Test-JsonEndpoint -Name "KAIROS Market Snapshot" -Url "$ApiUrl/api/market/snapshot"
)

$checks | ForEach-Object {
    if ($_.Ok) {
        Write-Host "[OK] $($_.Name) -> $($_.Url)" -ForegroundColor Green
    }
    else {
        Write-Host "[FAIL] $($_.Name) -> $($_.Url)" -ForegroundColor Red
        Write-Host "       $($_.Detail)" -ForegroundColor DarkYellow
    }
}

$failed = @($checks | Where-Object { -not $_.Ok })
if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "$($failed.Count) checks failed. Common causes: stale processes still own 4173/8787/8800, or the AkShare upstream is temporarily unavailable." -ForegroundColor Yellow
    Write-Host "Stop the old terminals or old node/python processes on those fixed ports, then run npm run dev:a-share again." -ForegroundColor Yellow
    exit 1
}

$apiHealth = ($checks | Where-Object { $_.Name -eq "Fastify API" }).Detail
$snapshot = ($checks | Where-Object { $_.Name -eq "KAIROS Market Snapshot" }).Detail
$indexQuotes = @($snapshot.quotes | Where-Object { $_.tradable -eq $false -and $_.price -gt 0 })

Write-Host ""
Write-Host "Read-only real market data path is healthy." -ForegroundColor Green
Write-Host "Backend mode: $($apiHealth.mode); provider: $($apiHealth.marketDataProvider); live index quotes: $($indexQuotes.Count)" -ForegroundColor Green
