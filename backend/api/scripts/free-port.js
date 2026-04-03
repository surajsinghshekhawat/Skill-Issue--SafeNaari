/**
 * Kill whatever is listening on PORT (default 3001).
 * Runs before each ts-node start (nodemon --exec) so the port is free on Windows.
 */
const { execSync } = require("child_process");

const port = String(process.argv[2] || process.env.PORT || "3001").trim();

function sleepMs(ms) {
  try {
    if (process.platform === "win32") {
      execSync(`ping 127.0.0.1 -n ${Math.max(2, Math.ceil(ms / 1000) + 1)} >nul 2>&1`, {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      execSync(`sleep ${Math.ceil(ms / 1000)}`, { stdio: "ignore" });
    }
  } catch {
    // ignore
  }
}

function killWindowsPowerShell() {
  const ps = `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`;
  try {
    execSync(`powershell -NoProfile -NonInteractive -Command ${JSON.stringify(ps)}`, {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    // ignore
  }
}

function killWindowsNetstat() {
  try {
    const out = execSync("netstat -ano", { encoding: "utf8" });
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      const re = new RegExp(`:${port}(?:\\s|$)`);
      if (!re.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (!/^\d+$/.test(pid) || pid === "0") continue;
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore", windowsHide: true });
        process.stdout.write(`[free-port] freed ${port} (PID ${pid})\n`);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

function killWindows() {
  killWindowsPowerShell();
  killWindowsNetstat();
  sleepMs(400);
}

function killUnix() {
  try {
    execSync(`lsof -ti:${port} | xargs -r kill -9`, { stdio: "ignore" });
  } catch {
    try {
      execSync(`kill -9 $(lsof -ti:${port})`, { stdio: "ignore", shell: "/bin/bash" });
    } catch {
      // ignore
    }
  }
}

if (process.platform === "win32") killWindows();
else killUnix();
