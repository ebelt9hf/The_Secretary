<#
.SYNOPSIS
Secretary Local Calendar Sync Helper for Windows (Zero-Dependency PowerShell Script)

.DESCRIPTION
Extracts upcoming calendar events from local Microsoft Outlook on Windows
into Secretary's planner-proposals.json.

Runs natively on 100% of Windows 10/11 machines out-of-the-box using built-in
PowerShell and Outlook MAPI COM automation. Zero cloud access required.

.PARAMETER Workspace
Path to the Secretary workspace root folder. Defaults to the parent folder of this script.

.PARAMETER Days
Number of days to look ahead (default: 14).
#>

param(
    [string]$Workspace = "",
    [int]$Days = 14,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Determine Workspace Directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($Workspace)) {
    $Candidate = Split-Path -Parent $ScriptDir
    if (Test-Path -LiteralPath (Join-Path $Candidate "app.html")) {
        $WorkspaceDir = $Candidate
    } else {
        $WorkspaceDir = (Get-Location).Path
    }
} else {
    $WorkspaceDir = (Resolve-Path -LiteralPath $Workspace).Path
}

$ProposalsFile = Join-Path $WorkspaceDir "planner-proposals.json"
$PlannerFile   = Join-Path $WorkspaceDir "planner.json"

Write-Host "🗓️ Secretary Calendar Sync Helper (Windows PowerShell)" -ForegroundColor Cyan
Write-Host "📂 Workspace: $WorkspaceDir"
Write-Host "📄 Target:    $ProposalsFile"

# Helper to infer event type from title and description
function Get-SecretaryEventType([string]$Title, [string]$Desc) {
    $c = "$Title $Desc".ToLower()
    if ($c -match '\b(prep|briefing|preparation|vorbereitung)\b') { return "prep" }
    if ($c -match '\b(call|meeting|zoom|teams|meet|webex|conference|huddle|1:1|1-on-1|interview|demo|client)\b') { return "call" }
    if ($c -match '\b(sync|standup|daily|retrospective|check-in)\b') { return "sync" }
    if ($c -match '\b(todo|task|action item)\b') { return "todo" }
    if ($c -match '\b(personal|lunch|gym|doctor|dentist|break|vacation|holiday|arzt)\b') { return "personal" }
    if ($c -match '\b(ooo|out of office|leave|urlaub|conges)\b') { return "ooo" }
    return "work"
}

# Determine System Timezone
function Get-SystemTimezoneString {
    try {
        $offset = [System.TimeZoneInfo]::Local.GetUtcOffset([DateTime]::Now)
        $sign = if ($offset.Ticks -ge 0) { "+" } else { "-" }
        $offsetStr = "{0}{1:D2}:{2:D2}" -f $sign, [Math]::Abs($offset.Hours), [Math]::Abs($offset.Minutes)
        
        # If IanaId is supported in current .NET runtime, prefer it
        $ianaProp = [System.TimeZoneInfo]::Local.GetType().GetProperty("IanaId")
        if ($ianaProp) {
            $ianaVal = $ianaProp.GetValue([System.TimeZoneInfo]::Local, $null)
            if (-not [string]::IsNullOrWhiteSpace($ianaVal)) {
                return $ianaVal
            }
        }
        return $offsetStr
    } catch {
        return "UTC"
    }
}

$TimezoneStr = Get-SystemTimezoneString

# Load Existing Proposals
$ExistingData = $null
$ExistingIds = @{}

if (Test-Path -LiteralPath $ProposalsFile) {
    try {
        $raw = Get-Content -LiteralPath $ProposalsFile -Raw -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            $ExistingData = ConvertFrom-Json $raw
            if ($ExistingData -and $ExistingData.proposals) {
                foreach ($p in $ExistingData.proposals) {
                    if ($p.id) { $ExistingIds[$p.id] = $true }
                }
            }
        }
    } catch {
        Write-Warning "Could not read existing proposals file: $($_.Exception.Message)"
    }
}

# Check planner.json for already accepted events
if (Test-Path -LiteralPath $PlannerFile) {
    try {
        $rawPlanner = Get-Content -LiteralPath $PlannerFile -Raw -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($rawPlanner)) {
            $plannerJson = ConvertFrom-Json $rawPlanner
            if ($plannerJson -and $plannerJson.events) {
                foreach ($ev in $plannerJson.events) {
                    if ($ev.proposalId) { $ExistingIds[$ev.proposalId] = $true }
                }
            }
        }
    } catch {
        # ignore planner read error
    }
}

if ($null -eq $ExistingData -or -not (Get-Member -InputObject $ExistingData -Name "proposals")) {
    $ExistingData = [PSCustomObject]@{
        _notice = "IMPORTANT FOR AGENTS: Do NOT delete or overwrite existing proposed events in this file. Only append new proposals. Secretary tracks processed/accepted proposals by their unique 'id' to prevent duplicate entries and calendar overlaps. External agents should provide the event's source timezone (e.g. 'timezone': 'America/New_York', 'UTC', '+02:00'). Secretary automatically converts proposals across timezones and midnight boundaries into the user's local timezone."
        version = 1
        proposals = @()
    }
}

# Extract events from Outlook Desktop via MAPI COM
$NewEvents = [System.Collections.Generic.List[PSCustomObject]]::new()
$now = Get-Date
$startBoundary = $now.AddDays(-1)
$endBoundary   = $now.AddDays($Days)

Write-Host "🔍 Querying Microsoft Outlook from $($startBoundary.ToString('yyyy-MM-dd')) to $($endBoundary.ToString('yyyy-MM-dd'))..."

$outlook = $null
$calendar = $null

try {
    $outlook = New-Object -ComObject Outlook.Application -ErrorAction Stop
    $namespace = $outlook.GetNamespace("MAPI")
    # OlDefaultFolders.olFolderCalendar = 9
    $calendar = $namespace.GetDefaultFolder(9)
    $items = $calendar.Items
    $items.IncludeRecurrences = $true
    $items.Sort("[Start]")

    foreach ($item in $items) {
        try {
            if ($null -eq $item) { continue }
            
            $startVal = $item.Start
            if ($null -eq $startVal) { continue }
            $sDate = [datetime]$startVal
            
            if ($sDate -lt $startBoundary) { continue }
            if ($sDate -gt $endBoundary) { break }

            $title = if (-not [string]::IsNullOrWhiteSpace($item.Subject)) { [string]$item.Subject } else { "Outlook Meeting" }
            if ($title.Length -gt 300) { $title = $title.Substring(0, 300) }

            $isAllDay = [bool]$item.AllDayEvent
            $eDateVal = $item.End
            $eDate = if ($eDateVal) { [datetime]$eDateVal } else { $sDate.AddMinutes(60) }

            $dateStr   = $sDate.ToString("yyyy-MM-dd")
            $startTime = if ($isAllDay) { "00:00" } else { $sDate.ToString("HH:mm") }
            $endTime   = if ($isAllDay) { "23:59" } else { $eDate.ToString("HH:mm") }
            $duration  = if ($isAllDay) { 1440 } else { [Math]::Max(15, [int][Math]::Round(($eDate - $sDate).TotalMinutes)) }

            $desc = if (-not [string]::IsNullOrWhiteSpace($item.Body)) { [string]$item.Body } else { "" }
            $location = if (-not [string]::IsNullOrWhiteSpace($item.Location)) { [string]$item.Location } else { "" }
            if (-not [string]::IsNullOrWhiteSpace($location) -and -not $desc.Contains($location)) {
                $desc = "Location: $location`n$desc".Trim()
            }
            if ($desc.Length -gt 1000) { $desc = $desc.Substring(0, 1000) }

            $entryId = if (-not [string]::IsNullOrWhiteSpace($item.EntryID)) { [string]$item.EntryID } else { "" }
            if ($entryId) {
                $cleanId = ($entryId -replace '[^a-zA-Z0-9_-]', '')
                if ($cleanId.Length -gt 32) { $cleanId = $cleanId.Substring(0, 32) }
                $propId = "local-outlook-win-$cleanId"
            } else {
                $hash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$title$dateStr$startTime"))).Replace("-","").Substring(0,16).ToLower()
                $propId = "local-outlook-win-$hash"
            }

            if ($ExistingIds.ContainsKey($propId)) {
                continue
            }

            $proposal = [PSCustomObject]@{
                id          = $propId
                title       = $title
                date        = $dateStr
                startTime   = $startTime
                endTime     = $endTime
                duration    = $duration
                timezone    = $TimezoneStr
                type        = (Get-SecretaryEventType $title $desc)
                description = $desc
                source      = "Local: Microsoft Outlook (Windows)"
                status      = "pending"
            }

            $NewEvents.Add($proposal)
            $ExistingIds[$propId] = $true
        } catch {
            # Skip invalid item
            continue
        }
    }
} catch {
    Write-Host "ℹ️ Could not query local Microsoft Outlook COM object: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "   (Note: If Outlook is not installed, you can use WebCal/iCal URL subscriptions in Secretary Settings)"
} finally {
    if ($null -ne $calendar) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($calendar) | Out-Null }
    if ($null -ne $outlook)  { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook) | Out-Null }
    [System.GC]::Collect()
}

Write-Host "  • Microsoft Outlook (Windows): $($NewEvents.Count) new event(s) found."

if ($DryRun) {
    Write-Host "[Dry Run] Found $($NewEvents.Count) new proposals to add." -ForegroundColor Yellow
    exit 0
}

if ($NewEvents.Count -gt 0) {
    # Append to existing proposals array
    $currentProposalsList = [System.Collections.Generic.List[object]]::new()
    if ($ExistingData.proposals) {
        foreach ($p in $ExistingData.proposals) {
            $currentProposalsList.Add($p)
        }
    }
    foreach ($np in $NewEvents) {
        $currentProposalsList.Add($np)
    }
    $ExistingData.proposals = $currentProposalsList.ToArray()

    $jsonOutput = ConvertTo-Json $ExistingData -Depth 10
    [System.IO.File]::WriteAllText($ProposalsFile, $jsonOutput, [System.Text.Encoding]::UTF8)
    Write-Host "✓ Successfully synchronized $($NewEvents.Count) new calendar events into planner-proposals.json" -ForegroundColor Green
} else {
    Write-Host "✓ Calendar is up to date. No new proposals found." -ForegroundColor Green
}

Write-Host "✨ Sync complete!"
