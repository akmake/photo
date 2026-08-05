# Restart the local engine -- kill what is already serving, then start fresh.
#
# WHY THIS EXISTS. Python reads a module once, when the process starts. Editing
# engine/*.py does nothing to an engine that is already running, so a fix that
# is verified on disk keeps failing in the app -- and the error even MOVES from
# one tool to the next as the recipe changes, which reads exactly like a
# half-finished fix. It cost a round trip of "it is fixed" / "no it is not".
#
# WHAT IT WILL NOT DO. It never kills python.exe by name. This machine runs
# other Python, and a restart script that takes the whole language down with it
# is a worse bug than the one it is fixing. Only two things are targeted:
#
#   1. whatever process is LISTENING on the engine's port
#   2. python processes whose command line points at THIS repository's server.py
#
# Anything it kills, it names first.
#
# ASCII ONLY, and saved with a BOM. Windows PowerShell 5.1 reads a .ps1 by the
# system codepage unless the file carries one, so a single em-dash in a comment
# arrived as three bytes of mojibake, broke the string it sat in, and took the
# block structure with it -- five parse errors, none of them where the problem
# was. See CLAUDE.md section 4: never assume UTF-8 at a boundary between
# processes on this machine.

$ErrorActionPreference = 'Stop'

# Read the port from server.py rather than repeating it here -- a copy would
# drift the moment the port moves, and then this script would helpfully restart
# nothing while reporting success.
$engineDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPy = Join-Path $engineDir 'server.py'
if (-not (Test-Path $serverPy)) {
    Write-Host "server.py not found next to this script ($engineDir)" -ForegroundColor Red
    exit 1
}
$portLine = Select-String -Path $serverPy -Pattern '^PORT\s*=\s*(\d+)' | Select-Object -First 1
if (-not $portLine) {
    Write-Host "could not read PORT from server.py" -ForegroundColor Red
    exit 1
}
$port = [int]$portLine.Matches[0].Groups[1].Value
Write-Host "engine port $port  ($serverPy)" -ForegroundColor DarkGray

# ---- 1. whoever is holding the port ---------------------------------------
$targets = @{}
try {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
        ForEach-Object { $targets[[int]$_.OwningProcess] = "listening on $port" }
} catch {
    # No listener is the normal case on a cold machine, not a failure.
}

# ---- 2. a python still holding THIS server.py ------------------------------
# Belt and braces: rule 1 misses an engine that crashed while still holding the
# module, and this one catches an engine that has not bound the port yet.
#
# Matched TWO ways, because matching one was measured to catch nothing: the
# running engine was launched as `python server.py` from inside engine\, so its
# command line says "server.py" and never the full path. So: the full path, OR
# the bare script name together with an interpreter that lives in THIS repo's
# virtualenv. Both are specific to this checkout -- another clone of the project
# on the same machine keeps running.
$venvRoot = Join-Path $engineDir '.venv'
Get-CimInstance Win32_Process -Filter "Name like '%python%'" -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -and (
            $_.CommandLine -like "*$serverPy*" -or
            ($_.CommandLine -like '*server.py*' -and $_.ExecutablePath -like "$venvRoot*")
        )
    } |
    ForEach-Object { $targets[[int]$_.ProcessId] = 'running this server.py' }

if ($targets.Count -eq 0) {
    Write-Host "nothing to stop -- no engine was running" -ForegroundColor DarkGray
} else {
    foreach ($pidKey in $targets.Keys) {
        $proc = Get-Process -Id $pidKey -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { '(gone)' }
        Write-Host ("stopping pid {0}  {1}  -- {2}" -f $pidKey, $name, $targets[$pidKey]) -ForegroundColor Yellow
        try { Stop-Process -Id $pidKey -Force -ErrorAction Stop } catch {
            Write-Host "  could not stop it: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

# ---- 3. wait for the port to actually come free ----------------------------
# Starting immediately is how you get "address already in use" from a socket
# that is still closing, and then a dead engine plus a confusing error.
for ($i = 0; $i -lt 40; $i++) {
    $held = $null
    try { $held = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop } catch {}
    if (-not $held) { break }
    Start-Sleep -Milliseconds 250
}

# ---- 4. up again -----------------------------------------------------------
$python = Join-Path $engineDir '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    Write-Host "no virtualenv at $python -- run the project setup first" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "starting the engine -- leave this window open, its log lives here" -ForegroundColor Green
Write-Host "  Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

# In THIS window, deliberately. Launching it detached is how the log ends up
# nowhere and the next failure is invisible.
Set-Location $engineDir
& $python 'server.py'
