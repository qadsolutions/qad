$fixtures = Get-Content "C:\qad\automations\document_intake_v1\test_fixtures.json" | ConvertFrom-Json
$url = "http://localhost:5678/webhook/document-intake"
$pass = 0
$fail = 0

foreach ($fixture in $fixtures) {
    Write-Host "`n--- $($fixture.name) ---" -ForegroundColor Cyan
    Write-Host $fixture.description -ForegroundColor Gray
    try {
        $body = $fixture.payload | ConvertTo-Json -Depth 5
        $response = Invoke-RestMethod -Uri $url -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
        $json = $response | ConvertTo-Json -Depth 5
        Write-Host "PASS" -ForegroundColor Green
        Write-Host $json
        $pass++
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $errBody = $_.ErrorDetails.Message
        if ($statusCode -eq 400) {
            Write-Host "PASS (validation rejection 400)" -ForegroundColor Green
            Write-Host $errBody
            $pass++
        } else {
            Write-Host "FAIL [$statusCode]: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host $errBody
            $fail++
        }
    }
    Start-Sleep -Seconds 2
}

Write-Host "`n================================" -ForegroundColor White
Write-Host "Results: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Yellow" })
