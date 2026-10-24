# PC Insight

A local Windows desktop app that helps you investigate a slow PC before buying parts. **Early preview (v0.1.0)** built with WPF and .NET 8. No administrator privileges, cloud diagnostics, or telemetry service.

## Download

Download `PCInsight-win-x64.zip` from [Releases](https://github.com/DarrellBest/pc-insight/releases), extract the entire archive, then open `PCInsight.exe`. Keep the `Scripts` folder beside the executable. Release builds include the .NET runtime. Windows 10/11 x64 is the target; other architectures are not tested. Builds are currently unsigned.

## Use

1. Select **Check my PC** to read CPU, GPU, installed memory modules, disks, volumes, motherboard, driver version and active power plan.
2. Select **Run short tests** for a three-second single-worker SHA-256 test, a two-second buffer-copy test and a bounded 64 MiB temporary-file write. The file is removed afterward. These are local comparison measurements, not standardized scores or GPU benchmarks.
3. Select **Watch slow activity · 30s**, then switch to your slow app or game. Sampling runs for approximately 30 seconds; query time can extend it. CPU, busiest core, memory, paging, drive activity, GPU engine activity and top CPU processes are retained in memory.
4. Read the findings. Sustained pressure requires at least five valid samples, 80% counter coverage, and at least half of valid samples above threshold. A single spike never justifies a purchase. Low free space is reported separately.
5. Load a price catalog or refresh an HTTPS feed, set a USD budget, and rank conditional upgrade candidates.
6. Optionally export a JSON report. Reports contain hardware and process names; review them before sharing. No report is saved automatically.

## What this preview can and cannot conclude

It identifies measured resource pressure and competing explanations, **not a definitive root cause**. Background processes may include your intended workload. Close unnecessary applications and repeat to test the hypothesis. Disk busy time does not measure latency; paging and background I/O can produce the same symptom. GPU telemetry uses the busiest physical engine and may reflect video decoding or compute rather than rendering. Synthetic results are sensitive to caching, power settings and other activity.

Temperature and thermal throttling remain **unknown** in this release. No kernel sensor driver is installed. The app explicitly tells you to check vendor telemetry before treating pressure as a hardware limit. It does not automatically identify BIOS settings, CPU support lists, PSU capacity, connector availability or case clearance. Serial numbers and user names are not requested.

## Price and compatibility feeds

**No retailer feed or live product catalog is bundled.** This preview implements the ingestion, freshness and evidence gates; a maintained retailer/affiliate feed and independently curated compatibility data are needed for useful buying recommendations. It never substitutes made-up prices. You can load a JSON file or enter an HTTPS endpoint serving the same array (maximum 2 MB, 20-second timeout, no redirects). Only the feed request leaves the machine; hardware details are not sent.

Offer schema (illustrative data only, deliberately dated so this example is excluded):

```json
[
  {
    "name": "Exact manufacturer and part number",
    "category": "RAM",
    "price": 99.99,
    "currency": "USD",
    "checkedAt": "2020-01-01T00:00:00Z",
    "url": "https://retailer.example/product",
    "supportedBoards": ["Exact manufacturer and product shown in YOUR BUILD"],
    "compatibilitySource": "https://manufacturer.example/support/memory-list",
    "requirements": "Confirm DDR generation, form factor, capacity, BIOS and available slots.",
    "benefitEvidence": "Describe workload evidence and its source. Do not invent a percentage gain."
  }
]
```

Categories are `CPU`, `GPU`, `RAM`, and `Storage`. An offer must have a positive USD price within budget, a timestamp no more than 48 hours old and not in the future, HTTPS product and support links, exact detected motherboard match, requirements and benefit evidence. It must also target pressure observed in the current capture. The rank is observed pressure fraction divided by price; it is an explainable prioritization heuristic, **not predicted benefit or performance per dollar**. The entire budget is applied separately to each candidate; this is not a multi-part build optimizer. Shipping and tax are excluded.

Compatibility and benefit statements are supplied by the feed and displayed as unverified claims. The board match is a conservative filter, not proof of physical or electrical compatibility. Independently check the linked support list, BIOS, power, cooling, dimensions and slots before purchase. No affiliate links or sponsored ranking are bundled. Automatic, validated compatible-part recommendations and quantitative uplift estimates are future work.

## Build and test

Install the .NET 8 SDK on Windows:

```powershell
dotnet build PCInsight.csproj -c Release
dotnet run --project Tests/PCInsight.Tests.csproj -c Release
dotnet publish PCInsight.csproj -c Release -r win-x64 --self-contained true -o artifacts/PCInsight-win-x64 -p:PublishSingleFile=true
```

The dependency-free regression executable tests missing counters, short captures, transient spikes, price freshness, currency, budget, board support and the no-evidence/no-purchase rule. CIM queries may return partial results on managed machines. Windows PowerShell must be available; enterprise application control can block scripts. Script execution policy is set only for each child process and is never changed globally.

## Releases

GitHub Actions builds and tests every main push and pull request. Push a `v*` tag (for example `git tag v0.1.0; git push origin v0.1.0`) or publish a GitHub release to attach the standalone x64 ZIP and SHA-256 checksum. CI artifacts are also available on successful builds. Release uploads use a separate job with `contents: write`; build jobs have read-only repository access.

## Architecture

- `MainWindow.xaml`: native desktop UI and workflow.
- `Scripts/Scan.ps1`: read-only CIM inventory, no identifying serial numbers.
- `Scripts/Sample.ps1`: optional Windows performance counters; missing values stay null.
- `Services.cs`: cancellable child processes, bounded local microbenchmarks.
- `Models.cs`: deterministic diagnosis and conservative offer filters.
- `Tests/`: offline regression checks, no hardware or network required.

References: [Microsoft performance counters](https://learn.microsoft.com/windows/win32/perfctrs), [WMI performance data](https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/WmiSdk/monitoring-performance-data.md), [GitHub Actions permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
