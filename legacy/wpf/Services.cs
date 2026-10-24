using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
namespace PCInsight;
public static class Services
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true, WriteIndented = true };
    public static async Task<string> PowerShell(string script, CancellationToken token)
    {
        var exe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
        var info = new ProcessStartInfo(exe) { UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true };
        foreach(var arg in new[]{"-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",Path.Combine(AppContext.BaseDirectory,"Scripts",script)}) info.ArgumentList.Add(arg);
        using var process = Process.Start(info) ?? throw new InvalidOperationException("Could not start Windows PowerShell.");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        try { await process.WaitForExitAsync(token); }
        catch { if(!process.HasExited) process.Kill(true); await process.WaitForExitAsync(); throw; }
        if(process.ExitCode != 0) throw new InvalidOperationException(await error);
        return await output;
    }
    public static Task<string> Benchmark(CancellationToken token) => Task.Run(() =>
    {
        var data = new byte[4*1024*1024]; RandomNumberGenerator.Fill(data);
        var watch = Stopwatch.StartNew(); long hashed=0;
        while(watch.Elapsed < TimeSpan.FromSeconds(3)) { token.ThrowIfCancellationRequested(); SHA256.HashData(data); hashed += data.Length; }
        var hashRate = hashed / watch.Elapsed.TotalSeconds / 1048576;
        var copy = new byte[data.Length]; watch.Restart(); long copied=0;
        while(watch.Elapsed < TimeSpan.FromSeconds(2)) { token.ThrowIfCancellationRequested(); Buffer.BlockCopy(data,0,copy,0,data.Length); copied += data.Length; }
        var copyRate=copied/watch.Elapsed.TotalSeconds/1048576;
        // Unique bounded scratch file; never open an existing user file for write.
        var path=Path.Combine(Path.GetTempPath(),"PCInsight-"+Guid.NewGuid()+".tmp");
        double writeRate;
        try {
            using var file=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough);
            watch.Restart();
            for(var i=0;i<16;i++) { token.ThrowIfCancellationRequested(); file.Write(data); }
            file.Flush(true); writeRate=64/watch.Elapsed.TotalSeconds;
        } finally { if(File.Exists(path)) File.Delete(path); }
        GC.KeepAlive(copy);
        return $"Single-worker SHA-256: {hashRate:F0} MiB/s\n4 MiB buffer copy: {copyRate:F0} MiB/s (cache-sensitive, not total RAM bandwidth)\n64 MiB sequential write: {writeRate:F0} MiB/s on temporary drive {Path.GetPathRoot(path)} (cache/controller effects possible)\nNo GPU benchmark run. Compare repeated tests on this PC; these are not cross-PC scores.";
    }, token);
}
