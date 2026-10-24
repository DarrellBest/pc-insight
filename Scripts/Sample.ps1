$ErrorActionPreference = 'Stop'
function Optional-Class($name) { try { @(Get-CimInstance $name -ErrorAction Stop) } catch { @() } }
$cpu = @(Optional-Class 'Win32_PerfFormattedData_PerfOS_Processor')
$total = $cpu | Where-Object Name -eq '_Total' | Select-Object -First 1
$cores = @($cpu | Where-Object Name -ne '_Total')
$os = Optional-Class 'Win32_OperatingSystem' | Select-Object -First 1
$mem = Optional-Class 'Win32_PerfFormattedData_PerfOS_Memory' | Select-Object -First 1
$disk = @(Optional-Class 'Win32_PerfFormattedData_PerfDisk_PhysicalDisk' | Where-Object Name -ne '_Total')
$gpu = @(Optional-Class 'Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine')
$proc = @(Optional-Class 'Win32_PerfFormattedData_PerfProc_Process' | Where-Object { $_.Name -notin @('_Total','Idle') } | Sort-Object PercentProcessorTime -Descending | Select-Object -First 5 Name,IDProcess,PercentProcessorTime)
$cpuValue = $null; $coreValue = $null; $memoryValue = $null; $diskValue = $null; $gpuValue = $null; $pages = $null
if ($total) { $cpuValue = [double]$total.PercentProcessorTime }
if ($cores.Count) { $coreValue = [double]($cores | Measure-Object PercentProcessorTime -Maximum).Maximum }
if ($os -and $os.TotalVisibleMemorySize -gt 0) { $memoryValue = 100.0 * (1.0 - $os.FreePhysicalMemory / $os.TotalVisibleMemorySize) }
if ($mem) { $pages = [double]$mem.PagesInputPersec }
if ($disk.Count) { $diskValue = [double]($disk | Measure-Object PercentDiskTime -Maximum).Maximum }
# Sum process contributions per physical engine, then take busiest engine; do not sum unrelated engines.
if ($gpu.Count) {
 $engines = $gpu | Group-Object { $_.Name -replace '^pid_\d+_', '' } | ForEach-Object { ($_.Group | Measure-Object UtilizationPercentage -Sum).Sum }
 $gpuValue = [math]::Min(100, [double]($engines | Measure-Object -Maximum).Maximum)
}
[pscustomobject]@{ At=[DateTimeOffset]::UtcNow.ToString('o'); Cpu=$cpuValue; BusiestCore=$coreValue; Memory=$memoryValue; PagesIn=$pages; Disk=$diskValue; Gpu=$gpuValue; TopProcesses=$proc } | ConvertTo-Json -Depth 5 -Compress
