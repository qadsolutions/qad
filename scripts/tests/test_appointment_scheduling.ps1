$Webhook = "http://localhost:5678/webhook/appointment"
$Fixtures = Get-Content ".\automations\appointment_scheduling_v1\test_fixtures.json" | ConvertFrom-Json
$Tests = $Fixtures.tests

# Clean test data from previous runs
Write-Host "Clearing appointment_log test data..." -ForegroundColor DarkGray
docker exec qad_postgres psql -U qad_user -d qad -c "TRUNCATE appointment_log RESTART IDENTITY;" 2>&1 | Out-Null

$Pass = 0
$Fail = 0
$Skip = 0

# Track IDs created during this run for reschedule/cancel tests
$CreatedIds = @{}

foreach ($t in $Tests) {
    # Auto-fill previous_appointment_id for reschedule/cancel from TC-APT-01
    if ($t.payload.PSObject.Properties.Match('previous_appointment_id') -and
        $t.payload.previous_appointment_id -eq 'REPLACE_WITH_EXISTING_ID') {
        if ($CreatedIds.ContainsKey('TC-APT-01')) {
            $t.payload.previous_appointment_id = $CreatedIds['TC-APT-01']
            $existingId = $CreatedIds['TC-APT-01']
            Write-Host "  INFO  $($t.id) - using appointment_id $existingId from TC-APT-01" -ForegroundColor DarkCyan
        } else {
            Write-Host "  SKIP  $($t.id) - $($t.name) (TC-APT-01 has no appointment_id yet)" -ForegroundColor Yellow
            $Skip++
            continue
        }
    }

    $body = $t.payload | ConvertTo-Json -Depth 5
    $code = 200
    $resp = $null

    try {
        $resp = Invoke-RestMethod -Uri $Webhook -Method POST -Body $body -ContentType "application/json"
    } catch {
        $code = $_.Exception.Response.StatusCode.Value__
        try { $resp = $_.ErrorDetails.Message | ConvertFrom-Json } catch { $resp = $null }
    }

    $expect = $t.expect
    $ok = $true
    $reason = ""

    if ($expect.http_status -and $code -ne [int]$expect.http_status) {
        $ok = $false
        $reason += "HTTP want=$($expect.http_status) got=$code. "
    }

    if ($resp) {
        if ($null -ne $resp.appointment_id -and $resp.appointment_id -ne "") {
            $CreatedIds[$t.id] = $resp.appointment_id
        }

        if ($expect.status -and $resp.status -ne $expect.status) {
            $ok = $false
            $reason += "status want=$($expect.status) got=$($resp.status). "
        }
        if ($expect.status_in) {
            $statusList = @($expect.status_in)
            if ($resp.status -notin $statusList) {
                $ok = $false
                $reason += "status=$($resp.status) not in [$($statusList -join '|')]. "
            }
        }
        if ($expect.has_appointment_id -and (-not $resp.appointment_id -or $resp.appointment_id -eq "")) {
            $ok = $false
            $reason += "Missing appointment_id. "
        }
        if ($expect.has_errors_field) {
            $hasErrors = ($resp.errors -and $resp.errors.Count -gt 0)
            if (-not $hasErrors) {
                $ok = $false
                $reason += "Expected errors field but none found. "
            }
        }
    } else {
        if ($expect.no_server_error) {
            # Just check we got a non-5xx code — crash = fail
            if ($code -ge 500) {
                $ok = $false
                $reason += "Server error HTTP $code. "
            }
        } elseif (-not $expect.http_status) {
            $ok = $false
            $reason += "No response body received. "
        }
    }

    if ($ok) {
        $statusNote = if ($resp -and $resp.status) { " [$($resp.status)]" } else { "" }
        Write-Host "  PASS  $($t.id) - $($t.name)$statusNote" -ForegroundColor Green
        $Pass++
    } else {
        Write-Host "  FAIL  $($t.id) - $($t.name)" -ForegroundColor Red
        Write-Host "        $reason" -ForegroundColor DarkRed
        if ($resp) {
            $respJson = $resp | ConvertTo-Json -Depth 3 -Compress
            $preview = $respJson.Substring(0, [Math]::Min(400, $respJson.Length))
            Write-Host "        $preview" -ForegroundColor DarkGray
        }
        $Fail++
    }
}

Write-Host ""
$total = $Tests.Count
Write-Host "Results: $Pass passed, $Fail failed, $Skip skipped of $total tests." -ForegroundColor Cyan
