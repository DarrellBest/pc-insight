using Microsoft.Win32;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
namespace PCInsight;
public partial class MainWindow : Window
{
    private CancellationTokenSource? operation;
    private JsonElement? build;
    private readonly List<Sample> samples = new();
    private List<Finding> findings = new();
    private List<Offer> offers = new();
    private string benchmark = "Not run";
    public MainWindow() { InitializeComponent(); Closed += (_,_)=>operation?.Cancel(); }
    private async Task Run(string message, Func<CancellationToken,Task> action)
    {
        if(operation != null) return;
        operation = new CancellationTokenSource(TimeSpan.FromMinutes(2));
        ScanButton.IsEnabled=BenchButton.IsEnabled=WatchButton.IsEnabled=false;
        CancelButton.IsEnabled=true; Progress.Visibility=Visibility.Visible; Status.Text=message;
        try { await action(operation.Token); Status.Text="Complete. Review the evidence below."; }
        catch(OperationCanceledException) { Status.Text="Stopped or timed out. Partial captures are not used for recommendations."; }
        catch(Exception e) { Status.Text="Could not complete: " + e.Message; }
        finally { operation.Dispose(); operation=null; ScanButton.IsEnabled=BenchButton.IsEnabled=WatchButton.IsEnabled=true; CancelButton.IsEnabled=false; Progress.Visibility=Visibility.Collapsed; }
    }
    private async void Scan_Click(object sender,RoutedEventArgs e) => await Run("Reading hardware and configuration…", async token =>
    {
        using var doc = JsonDocument.Parse(await Services.PowerShell("Scan.ps1", token));
        build = doc.RootElement.Clone();
        samples.Clear(); findings.Clear(); Findings.ItemsSource=null; OffersText.Text="New scan loaded. Record an activity before ranking offers.";
        var b=build.Value;
        static string Join(JsonElement b,string key,Func<JsonElement,string> format) => string.Join("\n",b.GetProperty(key).EnumerateArray().Select(format));
        static double Number(JsonElement e,string key) => e.TryGetProperty(key,out var v) && v.ValueKind==JsonValueKind.Number ? v.GetDouble() : 0;
        BuildText.Text="CPU   " + Join(b,"Cpu",c=>$"{c.GetProperty("Name")} · {c.GetProperty("NumberOfCores")} cores / {c.GetProperty("NumberOfLogicalProcessors")} threads")
         +"\nGPU   "+Join(b,"Gpu",g=>$"{g.GetProperty("Name")} · driver {g.GetProperty("DriverVersion")}")
         +"\nRAM   "+Join(b,"Ram",r=>$"{Number(r,"Capacity")/1073741824:F0} GiB · configured {Number(r,"ConfiguredClockSpeed"):F0} MHz · SMBIOS type {Number(r,"SMBIOSMemoryType")}")
         +"\nBOARD   "+BoardName()
         +"\nSTORAGE   "+Join(b,"Disks",d=>$"{d.GetProperty("Model")} · {Number(d,"Size")/1e9:F0} GB")
         +"\nVOLUMES   "+Join(b,"Volumes",v=>$"{v.GetProperty("DeviceID")} · {Number(v,"FreeSpace")/1e9:F1} GB free / {Number(v,"Size")/1e9:F1} GB")
         +"\nPOWER   "+b.GetProperty("PowerPlan")
         +"\n"+string.Join("; ",b.GetProperty("Warnings").EnumerateArray().Select(w=>w.GetString()));
        foreach(var v in b.GetProperty("Volumes").EnumerateArray())
            if(Number(v,"Size")>0 && Number(v,"FreeSpace")/Number(v,"Size")<.1)
                findings.Add(new("Configuration","Low free space",$"{v.GetProperty("DeviceID")} has less than 10% free space.","Free space and repeat your activity before replacing hardware.","High confidence in free-space measurement; impact depends on workload",0));
        Findings.ItemsSource=findings.ToArray();
    });
    private string BoardName() => build is { } b ? string.Join("; ",b.GetProperty("Board").EnumerateArray().Select(v=>$"{v.GetProperty("Manufacturer")} {v.GetProperty("Product")}".Trim())) : "";
    private async void Bench_Click(object sender,RoutedEventArgs e)
    {
        if(MessageBox.Show(this,"This runs brief CPU and memory tests and writes a temporary 64 MiB file. Save active work first. Run tests?","Short performance tests",MessageBoxButton.OKCancel)!=MessageBoxResult.OK) return;
        await Run("Running short tests…", async token=> { benchmark=await Services.Benchmark(token); PerformanceText.Text=benchmark; });
    }
    private async void Watch_Click(object sender,RoutedEventArgs e) => await Run("Recording for 30 seconds. Switch to the activity that feels slow…",async token=>
    {
        samples.Clear(); findings.RemoveAll(f=>f.Category!="Configuration"); Findings.ItemsSource=findings.ToArray(); OffersText.Text="Recording new evidence…";
        var capture=new List<Sample>(); var watch=Stopwatch.StartNew();
        while(watch.Elapsed < TimeSpan.FromSeconds(30))
        {
            var sample=JsonSerializer.Deserialize<Sample>(await Services.PowerShell("Sample.ps1",token),Services.Json) ?? throw new InvalidDataException("Empty sample");
            capture.Add(sample);
            Status.Text=$"Recording · {watch.Elapsed.TotalSeconds:F0}s · {capture.Count} samples. Switch to your slow activity.";
            await Task.Delay(1000,token);
        }
        samples.AddRange(capture); findings.AddRange(Diagnosis.Analyze(samples)); Findings.ItemsSource=findings.ToArray();
        string Avg(Func<Sample,double?> selector) { var a=samples.Select(selector).Where(v=>v.HasValue).ToArray(); return a.Length==0 ? "unavailable" : $"{a.Average(v=>v!.Value):F1}%"; }
        var processEvidence=samples.SelectMany(s=>s.TopProcesses.ValueKind==JsonValueKind.Array?s.TopProcesses.EnumerateArray().ToArray():Array.Empty<JsonElement>())
          .GroupBy(p=>$"{p.GetProperty("Name")} (PID {p.GetProperty("IDProcess")})")
          .Select(g=>new { Name=g.Key,Peak=g.Max(p=>p.GetProperty("PercentProcessorTime").GetDouble())/Environment.ProcessorCount })
          .OrderByDescending(p=>p.Peak).Take(5).Select(p=>$"{p.Name}: peak {p.Peak:F1}% of total CPU");
        PerformanceText.Text=$"{samples.Count} samples over {watch.Elapsed.TotalSeconds:F0}s\nMean CPU {Avg(s=>s.Cpu)} · RAM {Avg(s=>s.Memory)} · disk {Avg(s=>s.Disk)} · GPU {Avg(s=>s.Gpu)}\nTop observed processes (may include the activity itself):\n"+string.Join("\n",processEvidence)+"\n\n"+benchmark;
        RankOffers();
    });
    private void Cancel_Click(object sender,RoutedEventArgs e) => operation?.Cancel();
    private void Export_Click(object sender,RoutedEventArgs e)
    {
        var dialog=new SaveFileDialog { Filter="JSON report|*.json",FileName="pc-insight-report.json" };
        if(dialog.ShowDialog()!=true) return;
        try { File.WriteAllText(dialog.FileName,JsonSerializer.Serialize(new { CreatedAt=DateTimeOffset.UtcNow, Build=build, Samples=samples, Findings=findings, Benchmark=benchmark },Services.Json)); Status.Text="Report saved locally. It includes hardware and process names; review before sharing."; }
        catch(Exception ex) { Status.Text="Export failed: "+ex.Message; }
    }
    private void Offers_Click(object sender,RoutedEventArgs e)
    {
        var dialog=new OpenFileDialog { Filter="Offer catalog|*.json" };
        if(dialog.ShowDialog()!=true) return;
        try { if(new FileInfo(dialog.FileName).Length>2_000_000) throw new InvalidDataException("Catalog exceeds 2 MB limit."); LoadOffers(File.ReadAllText(dialog.FileName)); }
        catch(Exception ex) { Status.Text="Catalog failed: "+ex.Message; }
    }
    private async void Feed_Click(object sender,RoutedEventArgs e) => await Run("Fetching current offers…",async token=>
    {
        if(!Uri.TryCreate(FeedUrl.Text,UriKind.Absolute,out var uri) || uri.Scheme!="https") throw new InvalidDataException("Enter an HTTPS JSON feed URL.");
        using var handler=new HttpClientHandler { AllowAutoRedirect=false };
        using var client=new HttpClient(handler) { Timeout=TimeSpan.FromSeconds(20) };
        using var response=await client.GetAsync(uri,HttpCompletionOption.ResponseHeadersRead,token); response.EnsureSuccessStatusCode();
        using var stream=await response.Content.ReadAsStreamAsync(token); using var buffer=new MemoryStream(); var chunk=new byte[8192]; int count;
        while((count=await stream.ReadAsync(chunk,token))>0) { if(buffer.Length+count>2_000_000) throw new InvalidDataException("Catalog exceeds 2 MB limit."); buffer.Write(chunk,0,count); }
        LoadOffers(System.Text.Encoding.UTF8.GetString(buffer.ToArray()));
    });
    private void LoadOffers(string json) { offers=JsonSerializer.Deserialize<List<Offer>>(json,Services.Json) ?? throw new InvalidDataException("Expected an array of offers."); if(offers.Any(o=>o is null)) { offers.Clear(); throw new InvalidDataException("Null offer entries are invalid."); } RankOffers(); }
    private void Rank_Click(object sender,RoutedEventArgs e) => RankOffers();
    private void RankOffers()
    {
        if(!decimal.TryParse(Budget.Text,out var budget) || budget<=0) { OffersText.Text="Enter a positive USD budget."; return; }
        var ranked=Diagnosis.Rank(offers,findings,BoardName(),budget,DateTimeOffset.UtcNow);
        OffersText.Text=ranked.Count==0 ? $"No qualifying offers ({offers.Count} loaded). A recorded pressure signal, exact board match, USD price checked within 48 hours, and source evidence are required. No purchase recommendation yet."
          : string.Join("\n\n",ranked.Select((r,i)=>$"{i+1}. {r.Offer.Name} — {r.Offer.Price:C2} USD\nTargets {r.Offer.Category} pressure · conditional candidate, low confidence in benefit\nPrice checked: {r.Offer.CheckedAt:u}\nRetailer: {r.Offer.Url}\nCompatibility claim: {r.Offer.CompatibilitySource}\nConfirm before buying: {r.Offer.Requirements}\nBenefit evidence supplied by feed: {r.Offer.BenefitEvidence}"))
          +"\n\nRanking uses observed pressure / price, not a predicted FPS gain. Feed claims are not independently verified. Tax, shipping and fit are not included.";
    }
}
