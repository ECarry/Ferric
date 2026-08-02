use std::collections::HashSet;

use russh::ChannelMsg;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::ssh::{connect_and_auth, ConnectConfig};

const REMOTE_COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const MAX_COMMAND_OUTPUT: usize = 5 * 1024 * 1024;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CpuMetrics {
    pub utilization: f64,
    pub logical_processors: usize,
    pub cores: Vec<f64>,
    pub processes: u32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMetrics {
    pub total_kb: u64,
    pub used_kb: u64,
    pub free_kb: u64,
    pub percent: f64,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiskMetrics {
    pub name: String,
    pub percent: f64,
    pub total_kb: u64,
    pub available_kb: u64,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NetworkMetrics {
    pub name: String,
    pub rx_kb: f64,
    pub tx_kb: f64,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSnapshot {
    pub cpu: CpuMetrics,
    pub memory: MemoryMetrics,
    pub disk: Vec<DiskMetrics>,
    pub network: Vec<NetworkMetrics>,
    pub uptime: f64,
}

async fn exec_on_session(
    session: &russh::client::Handle<crate::ssh::Client>,
    cmd: &str,
) -> Result<String, AppError> {
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| AppError::new("errSshChannel").detail(e))?;

    channel
        .exec(true, cmd)
        .await
        .map_err(|e| AppError::new("errDockerExec").detail(e))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_status: Option<u32> = None;

    let deadline = tokio::time::sleep(REMOTE_COMMAND_TIMEOUT);
    tokio::pin!(deadline);
    loop {
        let msg = tokio::select! {
            _ = &mut deadline => {
                return Err(AppError::new("errRemoteCommandTimeout"));
            }
            msg = channel.wait() => msg,
        };
        let Some(msg) = msg else { break };
        match msg {
            ChannelMsg::Data { data } => {
                if stdout.len().saturating_add(data.len()) > MAX_COMMAND_OUTPUT {
                    return Err(AppError::new("errRemoteOutputTooLarge"));
                }
                stdout.extend_from_slice(&data);
            }
            ChannelMsg::ExtendedData { data, ext } if ext == 1 => {
                if stderr.len().saturating_add(data.len()) > MAX_COMMAND_OUTPUT {
                    return Err(AppError::new("errRemoteOutputTooLarge"));
                }
                stderr.extend_from_slice(&data);
            }
            ChannelMsg::ExitStatus { exit_status: status } => exit_status = Some(status),
            _ => {}
        }
    }

    let stdout_str = String::from_utf8_lossy(&stdout).trim().to_string();
    let stderr_str = String::from_utf8_lossy(&stderr).trim().to_string();

    if matches!(exit_status, Some(status) if status != 0) {
        return Err(AppError::new("errDockerCommandFailed")
            .param("exit", exit_status.unwrap_or_default())
            .detail(format!("{stdout_str} {stderr_str}").trim()));
    }

    Ok(stdout_str)
}

async fn exec_remote_cmd(config: &ConnectConfig, cmd: &str) -> Result<String, AppError> {
    let session = connect_and_auth(config).await.map_err(AppError::from)?;
    let result = exec_on_session(&session, cmd).await?;
    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "English")
        .await;
    Ok(result)
}

const SNAPSHOT_SCRIPT: &str = r###"sh <<'PERF_EOF'
base=${TMPDIR:-/tmp}/perf.$$
cpu1=$base.cpu1
cpu2=$base.cpu2
net1=$base.net1
net2=$base.net2
netr=$base.netr
diskf=$base.disk

trap 'rm -f "$cpu1" "$cpu2" "$net1" "$net2" "$netr" "$diskf"' 0 HUP INT TERM

read upraw _ </proc/uptime
uptime_sec=${upraw%.*}

cpu_cores=$(awk '/^processor[[:space:]]*:/ { c++ } END { print c+0 }' /proc/cpuinfo 2>/dev/null)
case $cpu_cores in
  ""|0) cpu_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0) ;;
esac

awk '
/^cpu[0-9 ]/ {
  idle=$5+$6
  total=0
  for (i=2; i<=NF; i++) total+=$i
  print $1, idle, total
}' /proc/stat > "$cpu1"

awk '
NR>2 {
  line=$0
  sub(/^[ \t]+/, "", line)
  split(line, a, ":")
  nic=a[1]
  gsub(/^[ \t]+|[ \t]+$/, "", nic)
  gsub(/^[ \t]+/, "", a[2])
  split(a[2], f, /[ \t]+/)
  print nic "\t" f[1] "\t" f[9]
}' /proc/net/dev > "$net1"

interval=0.2
sleep "$interval" 2>/dev/null || { interval=1; sleep 1; }

awk '
/^cpu[0-9 ]/ {
  idle=$5+$6
  total=0
  for (i=2; i<=NF; i++) total+=$i
  print $1, idle, total
}' /proc/stat > "$cpu2"

awk '
NR>2 {
  line=$0
  sub(/^[ \t]+/, "", line)
  split(line, a, ":")
  nic=a[1]
  gsub(/^[ \t]+|[ \t]+$/, "", nic)
  gsub(/^[ \t]+/, "", a[2])
  split(a[2], f, /[ \t]+/)
  print nic "\t" f[1] "\t" f[9]
}' /proc/net/dev > "$net2"

printf "SYSTEM\t%s\n" "$uptime_sec"

procs=$(ps -e --no-headers 2>/dev/null | wc -l)
[ "$procs" -eq 0 ] 2>/dev/null && procs=$(ls /proc/[0-9]* 2>/dev/null | wc -l)
printf "PROCESS\t%s\n" "$procs"

cpu_usage=$(awk '
NR==FNR {
  id[$1]=$2
  tot[$1]=$3
  next
}
$1=="cpu" {
  didle=$2-id[$1]
  dtotal=$3-tot[$1]
  cpu=(dtotal>0) ? (1-didle/dtotal)*100 : 0
  printf "%.1f", cpu
}' "$cpu1" "$cpu2")

printf "CPU\t%s\t%s\n" "$cpu_cores" "$cpu_usage"

awk '
NR==FNR {
  id[$1]=$2
  tot[$1]=$3
  next
}
/^cpu[0-9]/ {
  didle=$2-id[$1]
  dtotal=$3-tot[$1]
  cpu=(dtotal>0) ? (1-didle/dtotal)*100 : 0
  n=substr($1,4)
  printf "CPUCORE\t%s\t%.1f\n", n, cpu
}' "$cpu1" "$cpu2"

awk '
/MemTotal:/ { t=$2 }
/MemAvailable:/ { a=$2 }
/MemFree:/ { f=$2 }
/^Cached:/ { c=$2 }
/SReclaimable:/ { s=$2 }
END {
  if (!a) a=f
  used=(t-a)*1024
  avail=a*1024
  cache=(c+s)*1024
  printf "MEMORY\t%.0f\t%.0f\t%.0f\n", used, avail, cache
}' /proc/meminfo

awk -v s="$interval" '
BEGIN { OFS="\t" }
FNR==NR {
  rx[$1]=$2
  tx[$1]=$3
  next
}
{
  nic=$1
  if (nic=="" || nic=="lo") next
  if (nic ~ /^(docker|veth|br-|virbr|flannel|cali|tunl|kube-ipvs0|cni|zt|tailscale|wg|tap|vnet)/) next
  rxv=($2-rx[nic])/s
  txv=($3-tx[nic])/s
  if (rxv<0) rxv=0
  if (txv<0) txv=0
  printf "%s\t%.0f\t%.0f\n", nic, rxv, txv
}' "$net1" "$net2" > "$netr"

while IFS="$(printf '\t')" read -r nic rx tx; do
  [ -n "$nic" ] || continue
  state=$(cat "/sys/class/net/$nic/operstate" 2>/dev/null || echo unknown)
  [ "$state" = "up" ] || continue
  printf "NETWORK\t%s\t%s\t%s\n" "$nic" "$rx" "$tx"
done < "$netr"

: > "$diskf"

if command -v df >/dev/null 2>&1; then
  df -k 2>/dev/null | awk '
  BEGIN { OFS="\t" }
  NR>1 {
    src=$1; total=$2; used=$3; available=$4
    usep=""
    lastp=0
    for (i=2; i<=NF; i++) {
      if ($i ~ /%$/) {
        if (usep=="") usep=$i
        lastp=i
      }
    }
    if (usep=="") next
    gsub(/%/, "", usep)
    mp=""
    for (i=lastp+1; i<=NF; i++) mp=(mp ? mp " " : "") $i
    if (src !~ "^/dev/") next
    if (mp=="" || mp=="-") next
    if (seen[mp]++) next
    printf "DISK\t%s\t%s\t%s\t%s\t%s\n", src, mp, usep, total, available
  }' > "$diskf"
fi

if [ -s "$diskf" ]; then
  cat "$diskf"
fi
PERF_EOF
"###;

fn parse_stats_output(output: &str) -> PerformanceSnapshot {
    let mut logical_processors: usize = 0;
    let mut utilization: f64 = 0.0;
    let mut processes: u32 = 0;
    let mut cores: Vec<f64> = Vec::new();
    let mut mem_used: u64 = 0;
    let mut mem_avail: u64 = 0;
    let mut uptime: f64 = 0.0;
    let mut networks: Vec<NetworkMetrics> = Vec::new();
    let mut disks: Vec<DiskMetrics> = Vec::new();
    let mut seen_mounts = HashSet::new();

    for line in output.lines() {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.is_empty() {
            continue;
        }

        match cols[0] {
            "SYSTEM" if cols.len() >= 2 => {
                uptime = cols[1].parse().unwrap_or(0.0);
            }
            "PROCESS" if cols.len() >= 2 => {
                processes = cols[1].parse().unwrap_or(0);
            }
            "CPU" if cols.len() >= 3 => {
                logical_processors = cols[1].parse().unwrap_or(0);
                utilization = cols[2].parse().unwrap_or(0.0);
            }
            "CPUCORE" if cols.len() >= 3 => {
                if let Ok(n) = cols[1].parse::<usize>() {
                    let usage = cols[2].parse().unwrap_or(0.0);
                    if n >= cores.len() {
                        cores.resize(n + 1, 0.0);
                    }
                    cores[n] = usage;
                }
            }
            "MEMORY" if cols.len() >= 3 => {
                mem_used = cols[1].parse().unwrap_or(0);
                mem_avail = cols[2].parse().unwrap_or(0);
            }
            "NETWORK" if cols.len() >= 4 => {
                let rx: f64 = cols[2].parse().unwrap_or(0.0);
                let tx: f64 = cols[3].parse().unwrap_or(0.0);
                networks.push(NetworkMetrics {
                    name: cols[1].to_string(),
                    rx_kb: rx / 1024.0,
                    tx_kb: tx / 1024.0,
                });
            }
            "DISK" if cols.len() >= 6 => {
                let mount = cols[2].trim();
                if !mount.is_empty()
                    && mount != "-"
                    && seen_mounts.insert(mount.to_string())
                {
                    let percent = cols[3].parse().unwrap_or(0.0);
                    let total_kb = cols[4].parse().unwrap_or(0);
                    let available_kb = cols[5].parse().unwrap_or(0);
                    disks.push(DiskMetrics {
                        name: mount.to_string(),
                        percent,
                        total_kb,
                        available_kb,
                    });
                }
            }
            _ => {}
        }
    }

    let total = mem_used + mem_avail;
    let memory = MemoryMetrics {
        total_kb: total / 1024,
        used_kb: mem_used / 1024,
        free_kb: mem_avail / 1024,
        percent: if total > 0 {
            100.0 * mem_used as f64 / total as f64
        } else {
            0.0
        },
    };

    PerformanceSnapshot {
        cpu: CpuMetrics {
            utilization,
            logical_processors,
            cores,
            processes,
        },
        memory,
        disk: disks,
        network: networks,
        uptime,
    }
}

#[tauri::command]
pub async fn get_performance_snapshot(config: ConnectConfig) -> Result<PerformanceSnapshot, AppError> {
    let raw = exec_remote_cmd(&config, SNAPSHOT_SCRIPT).await?;
    Ok(parse_stats_output(&raw))
}
