import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import { note } from "../terminal/note.js";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 8_000;

export type HardwareInfo = {
  cpu: { name: string; cores: number; arch: string } | null;
  ram: { totalBytes: number } | null;
  gpu: { name: string; driverVersion: string; vramBytes: number | null }[];
  npu: NpuInfo | null;
};

export type NpuInfo = {
  name: string;
  vendor: "amd" | "intel" | "qualcomm" | "unknown";
  driverVersion: string | null;
  deviceClass: string | null;
  runtimeInstalled: boolean;
  runtimeVersion: string | null;
  tops: number | null;
};

// Known NPU TOPS ratings by CPU family
const NPU_TOPS_MAP: Record<string, number> = {
  "8945HS": 16,
  "8845HS": 16,
  "8840HS": 16,
  "7945HX3D": 10,
  "7945HX": 10,
  "7940HS": 10,
  "7840HS": 10,
  "7840U": 10,
  "AI 9 HX 370": 50,
  "AI 9 365": 50,
  "AI 9 HX 375": 55,
};

function estimateNpuTops(cpuName: string): number | null {
  for (const [key, tops] of Object.entries(NPU_TOPS_MAP)) {
    if (cpuName.includes(key)) {
      return tops;
    }
  }
  return null;
}

async function execPowershell(script: string): Promise<string> {
  try {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-EncodedCommand", encoded], {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function detectCpu(): Promise<HardwareInfo["cpu"]> {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      const raw = await execPowershell(
        "(Get-CimInstance Win32_Processor | Select-Object -First 1).Name",
      );
      const name = raw.replace(/<[^>]+>/g, "").trim();
      return name ? { name, cores: os.cpus().length, arch: os.arch() } : null;
    }
    if (platform === "darwin") {
      const { stdout } = await execFileAsync("sysctl", ["-n", "machdep.cpu.brand_string"], {
        encoding: "utf8",
        timeout: TIMEOUT_MS,
      });
      return { name: stdout.trim(), cores: os.cpus().length, arch: os.arch() };
    }
    // Linux: read /proc/cpuinfo
    if (fs.existsSync("/proc/cpuinfo")) {
      const content = fs.readFileSync("/proc/cpuinfo", "utf8");
      const match = content.match(/model name\s*:\s*(.+)/);
      return {
        name: match?.[1]?.trim() ?? "Unknown",
        cores: os.cpus().length,
        arch: os.arch(),
      };
    }
  } catch {
    // fall through
  }
  return { name: "Unknown", cores: os.cpus().length, arch: os.arch() };
}

async function detectGpus(): Promise<HardwareInfo["gpu"]> {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      const raw = await execPowershell(
        "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.DriverVersion + '|' + $_.AdapterRAM } | Out-String",
      );
      const lines = raw
        .replace(/<[^>]+>/g, "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      return lines.map((line) => {
        const [name, driverVersion, vramStr] = line.split("|");
        const vram = vramStr ? Number.parseInt(vramStr, 10) : null;
        return {
          name: name ?? "Unknown GPU",
          driverVersion: driverVersion ?? "",
          vramBytes: vram && !Number.isNaN(vram) ? vram : null,
        };
      });
    }
    if (platform === "darwin") {
      const { stdout } = await execFileAsync(
        "system_profiler",
        ["SPDisplaysDataType", "-json"],
        { encoding: "utf8", timeout: TIMEOUT_MS },
      );
      const data = JSON.parse(stdout);
      const displays = data?.SPDisplaysDataType ?? [];
      return displays.map((d: Record<string, string>) => ({
        name: d.sppci_model ?? "Unknown GPU",
        driverVersion: d.spdisplays_vendor ?? "",
        vramBytes: null,
      }));
    }
    if (platform === "linux") {
      const { stdout } = await execFileAsync("lspci", ["-mm"], {
        encoding: "utf8",
        timeout: TIMEOUT_MS,
      });
      const vgaLines = stdout.split("\n").filter((l) => l.includes("VGA") || l.includes("3D"));
      return vgaLines.map((line) => ({
        name: line.replace(/.*"([^"]+)".*"([^"]+)".*/, "$1 $2").trim(),
        driverVersion: "",
        vramBytes: null,
      }));
    }
  } catch {
    // fall through
  }
  return [];
}

async function detectNpu(cpuName: string): Promise<NpuInfo | null> {
  const platform = process.platform;

  if (platform === "win32") {
    return detectWindowsNpu(cpuName);
  }
  if (platform === "darwin") {
    return detectMacNpu(cpuName);
  }
  if (platform === "linux") {
    return detectLinuxNpu(cpuName);
  }
  return null;
}

function resolveRyzenAiSdkPath(): string | null {
  // Check RYZEN_AI_INSTALLATION_PATH env var first, then known install dirs
  const envPath = process.env.RYZEN_AI_INSTALLATION_PATH?.trim();
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }
  const candidates = [
    "C:\\Program Files\\RyzenAI\\1.7.0",
    "C:\\Program Files\\RyzenAI\\1.6.0",
    "C:\\Program Files\\RyzenAI\\1.5.0",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function detectWindowsNpu(cpuName: string): Promise<NpuInfo | null> {
  // Search PnP devices for NPU/AI accelerators
  const raw = await execPowershell(
    "Get-PnpDevice -Status OK | Where-Object { $_.FriendlyName -match 'NPU|XDNA|Neural' -and $_.Class -match 'Compute|System' } | Select-Object -First 1 | ForEach-Object { $_.FriendlyName + '|' + $_.Class + '|' + $_.InstanceId } | Out-String",
  );

  const cleaned = raw.replace(/<[^>]+>/g, "").trim();
  if (!cleaned) {
    return null;
  }

  const [name, deviceClass, instanceId] = cleaned.split("|");
  const vendor = resolveNpuVendor(instanceId ?? "", cpuName);

  // Get driver version from signed drivers
  const driverRaw = await execPowershell(
    "Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -match 'NPU|XDNA|Neural' } | Select-Object -First 1 | ForEach-Object { $_.DriverVersion } | Out-String",
  );
  const driverVersion = driverRaw.replace(/<[^>]+>/g, "").trim() || null;

  // Check if XDNA runtime is installed (Vitis AI EP via Ryzen AI SDK or system DLLs)
  const ryzenAiSdkPath = resolveRyzenAiSdkPath();
  const runtimeInstalled =
    ryzenAiSdkPath !== null ||
    fs.existsSync("C:\\Windows\\System32\\AMD\\onnxruntime_vitisai_ep.dll") ||
    fs.existsSync("C:\\Windows\\System32\\AMD\\xrt-smi.exe");

  // Resolve runtime version: prefer Ryzen AI SDK version, fall back to XRT version
  let runtimeVersion: string | null = null;
  if (ryzenAiSdkPath) {
    // Extract version from path (e.g. "C:\Program Files\RyzenAI\1.7.0" -> "1.7.0")
    const versionMatch = ryzenAiSdkPath.match(/(\d+\.\d+\.\d+)/);
    runtimeVersion = versionMatch ? `Ryzen AI ${versionMatch[1]}` : null;
  }
  if (!runtimeVersion && fs.existsSync("C:\\Windows\\System32\\AMD\\xbutil.exe")) {
    try {
      const xbRaw = await execPowershell(
        "& 'C:\\Windows\\System32\\AMD\\xbutil.exe' examine 2>&1 | Out-String",
      );
      const xrtSection = xbRaw.match(/XRT[\s\S]*?Version\s*:\s*([\d.]+)/);
      runtimeVersion = xrtSection?.[1] ? `XRT ${xrtSection[1]}` : null;
    } catch {
      // xbutil may fail; that's fine
    }
  }

  return {
    name: name ?? "NPU",
    vendor,
    driverVersion,
    deviceClass: deviceClass ?? null,
    runtimeInstalled,
    runtimeVersion,
    tops: estimateNpuTops(cpuName),
  };
}

async function detectMacNpu(cpuName: string): Promise<NpuInfo | null> {
  // Apple Silicon always has the Neural Engine
  if (!cpuName.toLowerCase().includes("apple")) {
    return null;
  }

  let tops: number | null = null;
  if (cpuName.includes("M4")) {
    tops = 38;
  } else if (cpuName.includes("M3")) {
    tops = 18;
  } else if (cpuName.includes("M2")) {
    tops = 15;
  } else if (cpuName.includes("M1")) {
    tops = 11;
  }

  return {
    name: "Apple Neural Engine",
    vendor: "unknown",
    driverVersion: null,
    deviceClass: "neural-engine",
    runtimeInstalled: true, // CoreML always available on Apple Silicon
    runtimeVersion: null,
    tops,
  };
}

async function detectLinuxNpu(_cpuName: string): Promise<NpuInfo | null> {
  // Check for /dev/accel* (generic NPU device nodes)
  try {
    const { stdout } = await execFileAsync("ls", ["/dev/accel0"], {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
    });
    if (stdout.includes("accel")) {
      return {
        name: "Compute Accelerator",
        vendor: "unknown",
        driverVersion: null,
        deviceClass: "accel",
        runtimeInstalled: false,
        runtimeVersion: null,
        tops: null,
      };
    }
  } catch {
    // no accel devices
  }
  return null;
}

function resolveNpuVendor(
  instanceId: string,
  cpuName: string,
): NpuInfo["vendor"] {
  const id = instanceId.toUpperCase();
  if (id.includes("VEN_1022") || id.includes("VEN_1002")) return "amd";
  if (id.includes("VEN_8086")) return "intel";
  if (id.includes("VEN_17CB")) return "qualcomm";
  if (cpuName.toLowerCase().includes("amd")) return "amd";
  if (cpuName.toLowerCase().includes("intel")) return "intel";
  if (cpuName.toLowerCase().includes("qualcomm") || cpuName.toLowerCase().includes("snapdragon"))
    return "qualcomm";
  return "unknown";
}

export async function detectHardware(): Promise<HardwareInfo> {
  const cpu = await detectCpu();
  const [ram, gpu, npu] = await Promise.all([
    detectRam(),
    detectGpus(),
    detectNpu(cpu?.name ?? ""),
  ]);
  return { cpu, ram, gpu, npu };
}

async function detectRam(): Promise<HardwareInfo["ram"]> {
  const totalBytes = os.totalmem();
  return totalBytes > 0 ? { totalBytes } : null;
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

export function formatHardwareSummary(hw: HardwareInfo): string {
  const lines: string[] = [];

  if (hw.cpu) {
    lines.push(`- CPU: ${hw.cpu.name} (${hw.cpu.cores} threads, ${hw.cpu.arch})`);
  }
  if (hw.ram) {
    lines.push(`- RAM: ${formatBytes(hw.ram.totalBytes)}`);
  }
  for (const gpu of hw.gpu) {
    const vram = gpu.vramBytes ? ` (${formatBytes(gpu.vramBytes)} VRAM)` : "";
    const driver = gpu.driverVersion ? ` [driver ${gpu.driverVersion}]` : "";
    lines.push(`- GPU: ${gpu.name}${vram}${driver}`);
  }

  if (hw.npu) {
    const tops = hw.npu.tops ? ` (${hw.npu.tops} TOPS)` : "";
    const vendor = hw.npu.vendor !== "unknown" ? ` [${hw.npu.vendor.toUpperCase()}]` : "";
    const driver = hw.npu.driverVersion ? ` driver ${hw.npu.driverVersion}` : "";
    lines.push(`- NPU: ${hw.npu.name}${tops}${vendor}${driver}`);

    if (hw.npu.runtimeInstalled) {
      const ver = hw.npu.runtimeVersion ? ` (${hw.npu.runtimeVersion})` : "";
      lines.push(`  Runtime: installed${ver}`);
    } else {
      lines.push("  Runtime: not installed");
      if (hw.npu.vendor === "amd") {
        lines.push("  Install Ryzen AI Software: https://www.amd.com/en/developer/resources/ryzen-ai-software.html");
      }
    }
  }

  return lines.join("\n");
}

function detectAvailableExecutionProviders(): string[] {
  if (process.platform !== "win32") return [];
  const providers: string[] = [];
  if (fs.existsSync("C:\\Windows\\System32\\AMD\\onnxruntime_vitisai_ep.dll")) {
    providers.push("vitisai");
  }
  if (fs.existsSync("C:\\Windows\\System32\\AMD\\RadeonML_DirectML.dll")) {
    providers.push("directml");
  }
  return providers;
}

export async function noteHardwareInfo(): Promise<HardwareInfo> {
  const hw = await detectHardware();
  const summary = formatHardwareSummary(hw);

  if (summary) {
    const warnings: string[] = [];

    if (hw.npu && !hw.npu.runtimeInstalled) {
      warnings.push("NPU detected but runtime is not installed. Install the vendor SDK to enable AI acceleration.");
    }

    if (hw.npu?.runtimeVersion && hw.npu.vendor === "amd") {
      const versionMatch = hw.npu.runtimeVersion.match(/(\d+)\.(\d+)/);
      if (versionMatch) {
        const major = Number.parseInt(versionMatch[1], 10);
        const minor = Number.parseInt(versionMatch[2], 10);
        // Ryzen AI SDK: warn if < 1.7; XRT standalone: warn if < 2.18
        const isOld = hw.npu.runtimeVersion.includes("Ryzen AI")
          ? major < 1 || (major === 1 && minor < 7)
          : major < 2 || (major === 2 && minor < 18);
        if (isOld) {
          warnings.push("NPU runtime is outdated. Update Ryzen AI Software for best performance.");
        }
      }
    }

    if (hw.npu?.runtimeInstalled && process.platform === "win32") {
      const availableEps = detectAvailableExecutionProviders();
      const explicit = process.env.SHERPA_ONNX_PROVIDER?.trim();
      const activeProvider = explicit || (availableEps.length > 0 ? availableEps[0] : "cpu");
      warnings.push(
        `ONNX providers: ${availableEps.length > 0 ? availableEps.join(", ") : "cpu only"} (active: ${activeProvider})`,
      );
    }

    const message = warnings.length > 0
      ? `${summary}\n\n${warnings.join("\n")}`
      : summary;

    note(message, "Hardware");
  }

  return hw;
}
