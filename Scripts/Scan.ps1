$ErrorActionPreference = 'Stop'
$warnings = [System.Collections.Generic.List[string]]::new()
function Read-Class($name) {
    try { @(Get-CimInstance -ClassName $name -ErrorAction Stop) }
    catch { $warnings.Add("${name}: unavailable"); @() }
}
$cpu = @(Read-Class 'Win32_Processor' | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed)
$gpu = @(Read-Class 'Win32_VideoController' | Select-Object Name,DriverVersion)
$ram = @(Read-Class 'Win32_PhysicalMemory' | Select-Object Capacity,Speed,ConfiguredClockSpeed,SMBIOSMemoryType,FormFactor)
$board = @(Read-Class 'Win32_BaseBoard' | Select-Object Manufacturer,Product,Version)
$disk = @(Read-Class 'Win32_DiskDrive' | Select-Object Model,Size,InterfaceType,MediaType)
$volume = @(Read-Class 'Win32_LogicalDisk' | Where-Object DriveType -eq 3 | Select-Object DeviceID,Size,FreeSpace)
$os = Read-Class 'Win32_OperatingSystem' | Select-Object -First 1 TotalVisibleMemorySize,FreePhysicalMemory,Caption
$power = (& powercfg.exe /getactivescheme 2>$null | Out-String).Trim()
[pscustomobject]@{ Cpu=$cpu; Gpu=$gpu; Ram=$ram; Board=$board; Disks=$disk; Volumes=$volume; Os=$os; PowerPlan=$power; Warnings=@($warnings) } | ConvertTo-Json -Depth 6 -Compress
