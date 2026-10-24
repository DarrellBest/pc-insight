param([ValidateSet(30,60,120)][int]$Seconds=30)
$ErrorActionPreference='Stop'
$timer=[Diagnostics.Stopwatch]::StartNew()
while($timer.Elapsed.TotalSeconds -lt $Seconds) {
    & "$PSScriptRoot\Sample.ps1"
    Start-Sleep -Milliseconds 750
}
