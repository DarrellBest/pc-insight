using System.Text.Json;
namespace PCInsight;
public record Sample(DateTimeOffset At, double? Cpu, double? BusiestCore, double? Memory, double? PagesIn, double? Disk, double? Gpu, JsonElement TopProcesses);
public record Finding(string Category, string Title, string Evidence, string Action, string Confidence, double Priority);
public record Offer(string Name, string Category, decimal Price, string Currency, DateTimeOffset CheckedAt, string Url, string[] SupportedBoards, string CompatibilitySource, string Requirements, string BenefitEvidence);
public record RankedOffer(Offer Offer, double Score);
public static class Diagnosis
{
    public static List<Finding> Analyze(IReadOnlyList<Sample> samples)
    {
        var results = new List<Finding>();
        if (samples.Count < 5) { results.Add(new("Unknown", "More evidence needed", "Fewer than five samples recorded.", "Record a full activity before considering upgrades.", "Insufficient evidence", 0)); return results; }
        void Pressure(string category, string title, Func<Sample,double?> select, double threshold, string action)
        {
            var values = samples.Select(select).Where(v => v.HasValue).Select(v => v!.Value).ToArray();
            if (values.Length < 5 || values.Length < samples.Count * .8) return;
            var fraction = values.Count(v => v >= threshold) / (double)values.Length;
            if (fraction >= .5) results.Add(new(category, title, $"{fraction:P0} of {values.Length} samples at or above {threshold:0}% (mean {values.Average():F1}%).", action, "Medium confidence in pressure; low confidence in root cause. Correlation is not proof.", fraction));
        }
        Pressure("CPU", "Sustained CPU pressure", s=>s.Cpu, 90, "Check the recorded processes, then repeat with unnecessary apps closed before choosing a CPU.");
        Pressure("CPU", "A CPU core is frequently busy", s=>s.BusiestCore, 95, "A thread may limit this workload even when total CPU use is low. Confirm with application profiling.");
        Pressure("RAM", "Memory capacity pressure", s=>s.Memory, 90, "Close unused apps and repeat. Persistent pressure plus paging makes more RAM a stronger candidate.");
        Pressure("Storage", "A drive is frequently busy", s=>s.Disk, 90, "Check copying, antivirus and paging first. Busy time alone does not prove a slow drive.");
        Pressure("GPU", "GPU engine pressure", s=>s.Gpu, 95, "Lower graphics settings and repeat. The busiest engine may be rendering, compute or video.");
        if (results.Count == 0) results.Add(new("Unknown", "No sustained saturation identified", "No available metric crossed its threshold in at least half the samples.", "Try a longer representative activity; latency, network, drivers and app behavior can still cause slowdowns.", "Low confidence; no upgrade justified by this capture", 0));
        var missing = new List<string>();
        if (samples.Any(s=>s.Cpu is null)) missing.Add("CPU");
        if (samples.Any(s=>s.Memory is null)) missing.Add("memory");
        if (samples.Any(s=>s.Disk is null)) missing.Add("disk");
        if (samples.Any(s=>s.Gpu is null)) missing.Add("GPU");
        if(missing.Count > 0) results.Add(new("Unknown", "Some counters unavailable", string.Join(", ", missing), "Unavailable values are excluded, never treated as zero.", "Incomplete coverage", 0));
        results.Add(new("Thermal", "Temperature and throttling are unverified", "Standard Windows counters do not reliably expose CPU/GPU temperatures across hardware.", "Check vendor temperature and throttling telemetry before buying. This app cannot rule out overheating.", "Unknown — no temperature sensor provider connected", 0));
        return results;
    }
    public static List<RankedOffer> Rank(IEnumerable<Offer> offers, IEnumerable<Finding> findings, string board, decimal budget, DateTimeOffset now)
    {
        var priorities = findings.GroupBy(f=>f.Category).ToDictionary(g=>g.Key,g=>g.Max(f=>f.Priority));
        return offers.Where(o => !string.IsNullOrWhiteSpace(o.Name) && o.Price > 0 && o.Price <= budget && o.Currency == "USD"
          && o.CheckedAt <= now && now - o.CheckedAt <= TimeSpan.FromHours(48)
          && Https(o.Url) && Https(o.CompatibilitySource) && !string.IsNullOrWhiteSpace(o.Requirements) && !string.IsNullOrWhiteSpace(o.BenefitEvidence)
          && !string.IsNullOrWhiteSpace(board) && o.SupportedBoards != null && o.SupportedBoards.Contains(board, StringComparer.OrdinalIgnoreCase)
          && o.Category != null && priorities.GetValueOrDefault(o.Category) > 0)
          .Select(o=>new RankedOffer(o, priorities[o.Category] / (double)o.Price)).OrderByDescending(o=>o.Score).ToList();
    }
    private static bool Https(string? url) => Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == "https";
}
