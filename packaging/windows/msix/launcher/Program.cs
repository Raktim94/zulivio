// Zulivio — MSIX foreground app.
//
// Modeled directly on nodedr-pos's open-pos.exe launcher
// (packaging/windows/msix/launcher/Program.cs in that repo) — same overall
// shape: a WinForms window hosts a WebView2 control, spawns the app's own
// backend/frontend as plain child processes when opened, and tears them
// down when closed. No Windows Service, no SCM registration; the MSIX
// manifest only declares runFullTrust.
//
// What's different from nodedr-pos, and why: Zulivio's Prisma schema is
// hard-wired to PostgreSQL (nodedr-pos uses SQLite, a single file with no
// server process). A standalone desktop build therefore also needs to run
// a real embedded PostgreSQL instance — this file owns that lifecycle too:
// initialize the data directory on first run, start it before the backend,
// and shut it down gracefully (pg_ctl stop, not a hard kill) before the
// node.exe children are torn down. See StartPostgresAsync/StopPostgres.
//
// Both the backend and frontend bind to 127.0.0.1 only, and so does
// PostgreSQL — this build is single-machine, foreground-only. No firewall
// rules are opened for any of the three.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Zulivio.Launcher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            // Single-instance guard: without this, opening the Start Menu
            // tile a second time while Zulivio is already running would spawn
            // a second Postgres/backend/frontend trio trying to bind the same
            // ports and the same data directory — the second Postgres
            // instance would fail outright (another postmaster already holds
            // the data directory's lock file), producing a confusing crash
            // instead of just focusing the already-open window.
            bool createdNew;
            using (var singleInstance = new Mutex(true, "Local\\ZulivioCRM_SingleInstance", out createdNew))
            {
                if (!createdNew)
                {
                    MessageBox.Show(
                        "Zulivio is already open.",
                        "Zulivio",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
        }
    }

    internal sealed class MainForm : Form
    {
        // Token-substituted by build-msix.ps1.
        private const int BackendPort = @BACKEND_PORT@;
        private const int FrontendPort = @FRONTEND_PORT@;
        private const int PostgresPort = @POSTGRES_PORT@;
        // Forward-slash relative path from the "frontend\" payload folder to
        // the actual Next.js standalone server.js — NOT always "server.js"
        // directly, because in this pnpm/Turborepo monorepo Next preserves
        // the workspace-relative path (e.g. "apps/web/server.js") inside
        // .next/standalone rather than flattening it. build-msix.ps1
        // discovers the real path at build time (Get-ChildItem -Recurse for
        // server.js) rather than assuming a fixed depth, since that nesting
        // is a Next.js implementation detail that could change between
        // versions. See its "Staging the frontend" step.
        private const string FrontendEntryRelative = "@FRONTEND_ENTRY@";
        private const int MaxWaitAttempts = 60;

        private static readonly string DataDir = @"C:\ProgramData\Zulivio";
        private static readonly string PgDataDir = Path.Combine(DataDir, "pgdata");
        private static readonly string LogsDir = Path.Combine(DataDir, "logs");

        private readonly Label _statusLabel;
        private WebView2 _webView;
        private JobObject _jobObject;
        private Process _backendProcess;
        private Process _frontendProcess;
        private Process _postgresProcess;
        private StreamWriter _launcherLog;

        public MainForm()
        {
            Text = "Zulivio";
            Width = 1360;
            Height = 860;
            StartPosition = FormStartPosition.CenterScreen;

            _statusLabel = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = System.Drawing.ContentAlignment.MiddleCenter,
                Font = new System.Drawing.Font("Segoe UI", 14F),
                Text = "Starting Zulivio…",
            };
            Controls.Add(_statusLabel);

            Load += async (_, __) => await StartAsync();
            // Only tears everything down on a real close (the X button, Alt+F4,
            // Application.Exit). Minimizing the window is plain WinForms default
            // behavior — it does not raise FormClosing, so the backend/frontend/
            // Postgres child processes keep running untouched and the window
            // simply reappears from the taskbar with the same live session.
            FormClosing += (_, __) => ShutDownChildProcesses();
        }

        // Logs the launcher's own lifecycle stages — separate from
        // backend.log/frontend.log/postgres.log (those are the child
        // processes' own output). See nodedr-pos's identical Log() method
        // for the full rationale (a startup failure inside this exe needs a
        // durable trail even if the window is closed before anyone reads it,
        // and CI polls this file for the READY line as a stronger signal
        // than the HTTP health check alone).
        private void Log(string message)
        {
            try { _launcherLog?.WriteLine(DateTime.Now.ToString("s") + "  " + message); } catch { /* best-effort */ }
        }

        private async Task StartAsync()
        {
            try
            {
                var baseDir = AppDomain.CurrentDomain.BaseDirectory;
                Directory.CreateDirectory(DataDir);
                Directory.CreateDirectory(LogsDir);
                Directory.CreateDirectory(Path.Combine(DataDir, "uploads"));
                Directory.CreateDirectory(Path.Combine(DataDir, "secrets"));
                _launcherLog = new StreamWriter(Path.Combine(LogsDir, "launcher.log"), append: true) { AutoFlush = true };
                Log("Launcher starting");

                // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: every process assigned to
                // this job is force-terminated the instant this process exits
                // or crashes — the backstop for the (should be impossible) case
                // where a graceful shutdown never runs. The normal shutdown path
                // (ShutDownChildProcesses) stops everything cleanly first,
                // including a real `pg_ctl stop` for Postgres; this job object
                // is purely the crash/kill safety net, same technique Electron
                // uses on Windows and the same one nodedr-pos's launcher uses.
                _jobObject = new JobObject();

                _statusLabel.Text = "Starting Zulivio…\n\nPreparing the local database…";
                var databaseUrl = await StartPostgresAsync();
                Log("PostgreSQL ready, database URL resolved");

                _statusLabel.Text = "Starting Zulivio…";
                _backendProcess = StartChild(
                    exe: Path.Combine(baseDir, "runtime", "node.exe"),
                    args: "\"" + Path.Combine(baseDir, "msix-wrappers", "backend-service.js") + "\"",
                    workingDir: Path.Combine(baseDir, "backend", "apps", "backend"),
                    logName: "backend",
                    env: new System.Collections.Generic.Dictionary<string, string>
                    {
                        ["PORT"] = BackendPort.ToString(),
                        // Loopback only, deliberately — this Store build has no
                        // firewall rule opening any port to the LAN. See this
                        // file's header comment.
                        ["HOST"] = "127.0.0.1",
                        ["NODE_ENV"] = "production",
                        ["DATABASE_URL"] = databaseUrl,
                        ["CORS_ORIGIN"] = "http://localhost:" + FrontendPort,
                        ["COOKIE_SECURE"] = "false",
                        ["BOOTSTRAP_DISABLED"] = "false",
                        ["UPLOADS_DIR"] = Path.Combine(DataDir, "uploads"),
                        ["FIELD_ENCRYPTION_KEY_PATH"] = Path.Combine(DataDir, "secrets", "field-encryption.key"),
                        ["CHECKPOINT_DISABLE"] = "1",
                        ["PRISMA_HIDE_UPDATE_MESSAGE"] = "1",
                    });
                TryAddToJobObject(_backendProcess, "backend");
                Log("Backend child process started (pid=" + _backendProcess.Id + ")");

                var frontendEntry = Path.Combine(baseDir, "frontend", FrontendEntryRelative.Replace('/', Path.DirectorySeparatorChar));
                _frontendProcess = StartChild(
                    exe: Path.Combine(baseDir, "runtime", "node.exe"),
                    args: "\"" + frontendEntry + "\"",
                    workingDir: Path.GetDirectoryName(frontendEntry),
                    logName: "frontend",
                    env: new System.Collections.Generic.Dictionary<string, string>
                    {
                        ["PORT"] = FrontendPort.ToString(),
                        ["NODE_ENV"] = "production",
                        ["HOSTNAME"] = "127.0.0.1",
                        ["NEXT_TELEMETRY_DISABLED"] = "1",
                    });
                TryAddToJobObject(_frontendProcess, "frontend");
                Log("Frontend child process started (pid=" + _frontendProcess.Id + ")");

                // Distinct from the frontend-port wait below: this specifically
                // proves the backend answered with the database reachable
                // (HealthController.ready() runs `SELECT 1`), i.e. that
                // `prisma migrate deploy` inside backend-service.js actually
                // succeeded against the embedded Postgres instance — not just
                // that the node.exe process is alive.
                _statusLabel.Text = "Starting Zulivio…\n\nWaiting for the backend to come up…";
                var backendReady = await WaitForHttpOkAsync("http://127.0.0.1:" + BackendPort + "/api/health/ready", MaxWaitAttempts);
                if (!backendReady)
                {
                    Log("STARTUP FAILED: backend never answered /api/health/ready within " + MaxWaitAttempts + "s");
                    _statusLabel.Text =
                        "Zulivio's backend didn't start in time.\n\n" +
                        "Check C:\\ProgramData\\Zulivio\\logs\\backend.log for errors, then try again.";
                    return;
                }
                Log("Backend healthy");

                var frontendReady = await WaitForPortAsync(FrontendPort, MaxWaitAttempts);
                if (!frontendReady)
                {
                    Log("STARTUP FAILED: frontend port " + FrontendPort + " never accepted a connection within " + MaxWaitAttempts + "s");
                    _statusLabel.Text =
                        "Zulivio didn't start in time.\n\n" +
                        "Check C:\\ProgramData\\Zulivio\\logs\\frontend.log for errors, then try again.";
                    return;
                }
                Log("Frontend port ready");

                await InitializeWebViewAsync();
            }
            catch (Exception ex)
            {
                // See nodedr-pos's Program.cs for why BadImageFormatException
                // gets its own branch: it's the signature of the x64/Prefer32Bit
                // architecture mismatch this project's .csproj pins against
                // (0x8007000B "incorrect format"), so it's worth a distinct,
                // actionable log line if it ever recurs some other way.
                Log("STARTUP FAILED: " + ex.GetType().FullName + ": " + ex.Message + "\n" + ex.StackTrace);
                _statusLabel.Text = (ex is BadImageFormatException)
                    ? "Zulivio couldn't start a required component (architecture mismatch).\n\nPlease restart the application. If the problem continues, contact support with the details in C:\\ProgramData\\Zulivio\\logs\\launcher.log."
                    : "Zulivio couldn't start.\n\nPlease restart the application. If the problem continues, contact support with the details in C:\\ProgramData\\Zulivio\\logs\\launcher.log.";
            }
        }

        // ---------------------------------------------------------------
        // Embedded PostgreSQL lifecycle.
        //
        // Bundled under <install root>\pgsql\bin\{initdb,pg_ctl,postgres,
        // createdb}.exe — real, unmodified upstream binaries (see
        // build-msix.ps1's "Embedding PostgreSQL" step), not a reimplementation.
        // Trust auth is used deliberately (no superuser password to generate,
        // store, or rotate): PostgreSQL listens on 127.0.0.1 only, on a
        // non-default port, reachable from nowhere but this single desktop
        // app on this single machine — the same threat model that already
        // lets nodedr-pos's SQLite file have no credential at all.
        // ---------------------------------------------------------------
        // Real, CI-confirmed failure this works around: running initdb.exe
        // directly from the MSIX install root (C:\Program Files\WindowsApps\
        // ...) failed with "Access is denied" the moment initdb tried to
        // spawn postgres.exe -V as an internal sanity check — even though
        // postgres.exe genuinely exists right next to it, and even though
        // this package declares runFullTrust. PostgreSQL's own Windows
        // privilege-dropping mechanism (postgres/initdb re-executing
        // themselves under a restricted token when launched by an admin —
        // see packaging/windows/README.md's "PostgreSQL running under an
        // Administrator account" note) apparently does not tolerate being
        // invoked from inside a packaged app's install directory, whatever
        // the exact low-level reason. The fix: copy the ~300MB pgsql\ tree
        // out to a normal, unpackaged, writable location on first run —
        // once initdb/pg_ctl/postgres run from an ordinary ProgramData
        // path, they behave exactly as they would for a manual install.
        private string EnsureWritablePostgresBinaries(string baseDir)
        {
            var pgRuntimeDir = Path.Combine(DataDir, "pgsql");
            var pgBin = Path.Combine(pgRuntimeDir, "bin");
            if (!File.Exists(Path.Combine(pgBin, "postgres.exe")))
            {
                Log("Copying embedded PostgreSQL binaries out of the read-only MSIX install root to " + pgRuntimeDir + " (first run) — required for initdb/postgres to run without \"Access is denied\"");
                CopyDirectoryRecursive(Path.Combine(baseDir, "pgsql"), pgRuntimeDir);
            }
            return pgBin;
        }

        private static void CopyDirectoryRecursive(string sourceDir, string destDir)
        {
            Directory.CreateDirectory(destDir);
            foreach (var file in Directory.GetFiles(sourceDir))
            {
                File.Copy(file, Path.Combine(destDir, Path.GetFileName(file)), overwrite: true);
            }
            foreach (var dir in Directory.GetDirectories(sourceDir))
            {
                CopyDirectoryRecursive(dir, Path.Combine(destDir, Path.GetFileName(dir)));
            }
        }

        private async Task<string> StartPostgresAsync()
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var pgBin = EnsureWritablePostgresBinaries(baseDir);
            var pgLog = Path.Combine(LogsDir, "postgres.log");
            const string SuperUser = "zulivio_admin";
            const string DbName = "zulivio";

            // A data directory with no PG_VERSION marker is either genuinely
            // fresh or a leftover from an initdb that was interrupted midway
            // (e.g. the app was killed mid-first-run) — either way, initdb
            // requires an empty target directory, so clear it before running.
            var isFirstRun = !File.Exists(Path.Combine(PgDataDir, "PG_VERSION"));
            if (isFirstRun && Directory.Exists(PgDataDir))
            {
                Log("PostgreSQL data directory exists but has no PG_VERSION (interrupted previous init) — clearing it before re-initializing");
                Directory.Delete(PgDataDir, recursive: true);
            }

            if (isFirstRun)
            {
                Log("Initializing PostgreSQL data directory (first run)");
                RunToolOrThrow(
                    Path.Combine(pgBin, "initdb.exe"),
                    "-D \"" + PgDataDir + "\" -U " + SuperUser + " -A trust --locale=C -E UTF8",
                    "initdb", pgLog);
            }

            // Deliberately NOT using pg_ctl's own `-w` (wait) flag — real
            // CI failure: `pg_ctl start -w -t 60` never returned even though
            // postgres.log showed the server came up and was accepting
            // connections seconds later (confirmed by a checkpoint completing
            // normally 5 minutes after "ready to accept connections", while
            // pg_ctl itself was still blocked). Whatever the exact cause of
            // pg_ctl's own wait-detection hanging on this runner, RunTool's
            // WaitForExit has no timeout, so that hang froze the entire
            // launcher indefinitely. Fixed by having pg_ctl just fork
            // postgres and return immediately (it does this quickly
            // regardless), then polling for the port ourselves below with
            // WaitForPortAsync — the same proven technique already used for
            // the frontend — which gives us our own bounded timeout instead
            // of trusting pg_ctl's internal one.
            var startArgs = "start -D \"" + PgDataDir + "\" -o \"-p " + PostgresPort + " -c listen_addresses=127.0.0.1\" -l \"" + pgLog + "\"";
            var startResult = RunTool(Path.Combine(pgBin, "pg_ctl.exe"), startArgs, timeoutMs: 30000);
            if (startResult.ExitCode != 0)
            {
                // A stale postmaster.pid from an unclean previous shutdown (e.g.
                // the launcher was killed via Task Manager rather than closed
                // normally) makes pg_ctl refuse to start, believing another
                // instance already owns the data directory. Confirm the PID it
                // names is not actually running, then clear the lock files and
                // retry exactly once — pg_ctl/postgres itself replays the WAL
                // on the next start, so this is safe even after a hard kill.
                Log("pg_ctl start failed (exit " + startResult.ExitCode + "), checking for a stale lock file:\n" + startResult.Output);
                var pidFile = Path.Combine(PgDataDir, "postmaster.pid");
                var staleLockCleared = false;
                if (File.Exists(pidFile))
                {
                    var firstLine = File.ReadLines(pidFile).FirstOrDefaultCompat();
                    if (int.TryParse(firstLine, out var stalePid))
                    {
                        var stillRunning = false;
                        try { Process.GetProcessById(stalePid); stillRunning = true; } catch (ArgumentException) { stillRunning = false; }
                        if (!stillRunning)
                        {
                            Log("postmaster.pid names pid " + stalePid + ", which is not running — treating as a stale lock and clearing it");
                            File.Delete(pidFile);
                            staleLockCleared = true;
                        }
                    }
                }
                if (!staleLockCleared)
                {
                    throw new InvalidOperationException("pg_ctl start failed and no stale lock file was found to clear. Log tail:\n" + startResult.Output);
                }
                startResult = RunTool(Path.Combine(pgBin, "pg_ctl.exe"), startArgs, timeoutMs: 30000);
                if (startResult.ExitCode != 0)
                {
                    throw new InvalidOperationException("pg_ctl start failed even after clearing a stale lock file. Log tail:\n" + startResult.Output);
                }
            }
            Log("pg_ctl start command issued (exit " + startResult.ExitCode + "), waiting for PostgreSQL to accept connections on 127.0.0.1:" + PostgresPort);

            var pgReady = await WaitForPortAsync(PostgresPort, 60);
            if (!pgReady)
            {
                throw new InvalidOperationException(
                    "PostgreSQL did not accept a connection on 127.0.0.1:" + PostgresPort + " within 60s of pg_ctl start. pg_ctl output:\n" +
                    startResult.Output + "\nSee " + pgLog + " for the server's own log.");
            }
            Log("PostgreSQL accepting connections on 127.0.0.1:" + PostgresPort);

            // pg_ctl start does not hand back postgres's own Process object
            // (it forks and detaches) — read the PID it just wrote so the
            // running postgres.exe can be tracked for the job object /
            // graceful stop.
            var pidPath = Path.Combine(PgDataDir, "postmaster.pid");
            if (File.Exists(pidPath))
            {
                var pidLine = File.ReadLines(pidPath).FirstOrDefaultCompat();
                if (int.TryParse(pidLine, out var pgPid))
                {
                    try
                    {
                        _postgresProcess = Process.GetProcessById(pgPid);
                        TryAddToJobObject(_postgresProcess, "postgres");
                    }
                    catch (Exception ex)
                    {
                        // Non-fatal: worst case, the crash-path job-object
                        // backstop won't cover Postgres specifically, but the
                        // normal shutdown path's explicit `pg_ctl stop` below
                        // does not depend on this handle at all.
                        Log("Could not attach to running postgres.exe (pid " + pgPid + ") for job-object tracking: " + ex.Message);
                    }
                }
            }

            if (isFirstRun)
            {
                Log("Creating the \"" + DbName + "\" database (first run)");
                RunToolOrThrow(
                    Path.Combine(pgBin, "createdb.exe"),
                    "-h 127.0.0.1 -p " + PostgresPort + " -U " + SuperUser + " " + DbName,
                    "createdb", pgLog);
            }

            return "postgresql://" + SuperUser + "@127.0.0.1:" + PostgresPort + "/" + DbName + "?schema=public";
        }

        // Graceful shutdown — NOT a job-object kill. Killing postgres.exe
        // outright is not corruption-guaranteed-safe (WAL replay recovers it
        // on next start regardless), but there is no reason to rely on that
        // recovery path on every single normal close when a clean shutdown is
        // one command away. `-m fast` rolls back any in-flight transactions
        // and disconnects clients immediately rather than waiting for them —
        // appropriate here since the backend has already been stopped by the
        // time this runs (see ShutDownChildProcesses's ordering).
        private void StopPostgresGracefully()
        {
            try
            {
                // Must match StartPostgresAsync's EnsureWritablePostgresBinaries
                // location, not the read-only install root — see that
                // method's comment for why pg_ctl can't run from there.
                var pgCtl = Path.Combine(DataDir, "pgsql", "bin", "pg_ctl.exe");
                if (!File.Exists(pgCtl)) return;
                Log("Stopping PostgreSQL gracefully (pg_ctl stop -m fast)");
                var result = RunTool(pgCtl, "stop -D \"" + PgDataDir + "\" -m fast -w -t 30");
                Log("pg_ctl stop exit code " + result.ExitCode + (result.ExitCode != 0 ? ("\n" + result.Output) : ""));
            }
            catch (Exception ex)
            {
                // Fall through to the job-object kill in ShutDownChildProcesses
                // — logged so an unexpectedly hard shutdown is still visible.
                Log("StopPostgresGracefully threw, falling back to job-object kill: " + ex.Message);
            }
        }

        private struct ToolResult { public int ExitCode; public string Output; }

        // Reads stdout/stderr via the async event API, not sequential
        // ReadToEnd() calls — a tool (initdb in particular, which is fairly
        // chatty) can produce enough combined output to fill the OS pipe
        // buffer before WaitForExit() is reached, and blocking on
        // stdout.ReadToEnd() while the child is itself blocked writing to a
        // full stderr pipe is a classic redirected-process deadlock. This
        // pattern (BeginOutputReadLine/BeginErrorReadLine + WaitForExit) is
        // the standard safe one, same as StartChild uses for the long-lived
        // backend/frontend processes.
        // timeoutMs is a hard backstop, not a normal-path concern for most
        // callers (initdb/createdb/pg_ctl stop all return in well under a
        // second to a few seconds) — added after a real CI hang where
        // `pg_ctl start -w` never returned even though the server it
        // started came up fine underneath it (see StartPostgresAsync's
        // comment). A hung external tool with no timeout here would freeze
        // this entire launcher indefinitely; ExitCode -1 is a sentinel (real
        // process exit codes are never negative) that flows into the same
        // "non-zero means failure" handling every caller already has.
        private static ToolResult RunTool(string exe, string args, int timeoutMs = 120000)
        {
            var psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = args,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            var output = new System.Text.StringBuilder();
            using (var p = new Process { StartInfo = psi })
            {
                p.OutputDataReceived += (_, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
                p.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutMs))
                {
                    try { p.Kill(); } catch { /* best-effort */ }
                    try { p.WaitForExit(5000); } catch { /* best-effort */ }
                    return new ToolResult { ExitCode = -1, Output = output.ToString() + "\n[TIMED OUT after " + timeoutMs + "ms — process was killed]" };
                }
                return new ToolResult { ExitCode = p.ExitCode, Output = output.ToString() };
            }
        }

        private void RunToolOrThrow(string exe, string args, string toolName, string logPath)
        {
            var result = RunTool(exe, args);
            Log(toolName + " exit code " + result.ExitCode + "\n" + result.Output);
            if (result.ExitCode != 0)
            {
                throw new InvalidOperationException(toolName + " failed (exit " + result.ExitCode + "). See " + logPath + " and launcher.log for details.\n" + result.Output);
            }
        }

        private async Task InitializeWebViewAsync()
        {
            // WebView2's default user-data-folder location is next to the exe,
            // which under MSIX is the package's read-only install root — that
            // fails outright. Point it at the writable ProgramData root instead
            // (same fix nodedr-pos's launcher uses).
            var userDataFolder = Path.Combine(DataDir, "webview2-data");
            Directory.CreateDirectory(userDataFolder);

            CoreWebView2Environment environment;
            try
            {
                environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
                Log("WebView2 environment created");
            }
            catch (WebView2RuntimeNotFoundException)
            {
                Log("STARTUP FAILED: WebView2RuntimeNotFoundException — Edge WebView2 Runtime not installed");
                _statusLabel.Text =
                    "Zulivio needs the Microsoft Edge WebView2 Runtime, which is not installed.\n\n" +
                    "It ships with Windows 11 and current Windows 10 by default. If missing, install it " +
                    "from https://developer.microsoft.com/microsoft-edge/webview2/ and reopen Zulivio.";
                return;
            }

            _webView = new WebView2 { Dock = DockStyle.Fill };
            Controls.Add(_webView);
            await _webView.EnsureCoreWebView2Async(environment);
            _webView.BringToFront();
            _statusLabel.Visible = false;

            _webView.CoreWebView2.Navigate("http://localhost:" + FrontendPort);
            // The definitive "the launcher itself came up correctly" signal —
            // CI polls for this exact line rather than trusting the HTTP health
            // check alone, which stays blind to a WebView2-layer failure (the
            // catch block in StartAsync swaps a label instead of crashing the
            // process on that failure).
            Log("WebView2 navigated to http://localhost:" + FrontendPort + " — READY");
        }

        private static Process StartChild(
            string exe,
            string args,
            string workingDir,
            string logName,
            System.Collections.Generic.Dictionary<string, string> env)
        {
            var logPath = Path.Combine(LogsDir, logName + ".log");
            var psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = args,
                WorkingDirectory = workingDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var kv in env)
            {
                psi.EnvironmentVariables[kv.Key] = kv.Value;
            }

            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            var logWriter = new StreamWriter(logPath, append: true) { AutoFlush = true };
            process.OutputDataReceived += (_, e) => { if (e.Data != null) logWriter.WriteLine(e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data != null) logWriter.WriteLine(e.Data); };
            process.Exited += (_, __) => logWriter.Dispose();

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            return process;
        }

        private static async Task<bool> WaitForPortAsync(int port, int maxAttempts)
        {
            for (var i = 0; i < maxAttempts; i++)
            {
                try
                {
                    using (var client = new TcpClient())
                    {
                        var connectTask = client.ConnectAsync("127.0.0.1", port);
                        if (await Task.WhenAny(connectTask, Task.Delay(1000)) == connectTask && client.Connected)
                        {
                            return true;
                        }
                    }
                }
                catch { /* not up yet */ }
                await Task.Delay(1000);
            }
            return false;
        }

        private static async Task<bool> WaitForHttpOkAsync(string url, int maxAttempts)
        {
            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) })
            {
                for (var i = 0; i < maxAttempts; i++)
                {
                    try
                    {
                        var response = await http.GetAsync(url);
                        if (response.IsSuccessStatusCode) return true;
                    }
                    catch { /* not up yet */ }
                    await Task.Delay(1000);
                }
            }
            return false;
        }

        // Real CI failure this works around: assigning a freshly-spawned
        // child node.exe to our own Job Object failed with
        // AssignProcessToJobObject error 5 (ERROR_ACCESS_DENIED), even
        // though the process was spawned directly by this app and normally
        // has full access. Most likely explanation: Desktop Bridge (MSIX)
        // apps and their process trees can already be members of a
        // Windows-managed job object for packaged-app lifecycle tracking,
        // and nesting an app-created job assignment on top of that isn't
        // always permitted. The job object here is a crash-path backstop,
        // not the primary cleanup mechanism (ShutDownChildProcesses's
        // explicit Kill()/pg_ctl-stop calls are) — so a failure to add a
        // process to it must not crash startup; log and continue instead.
        private void TryAddToJobObject(Process process, string label)
        {
            try
            {
                _jobObject.AddProcess(process);
            }
            catch (Exception ex)
            {
                Log("Could not add " + label + " process (pid " + process.Id + ") to the job object — crash-path cleanup backstop won't cover it, but the normal shutdown path's explicit kill does not depend on this: " + ex.Message);
            }
        }

        private void ShutDownChildProcesses()
        {
            Log("Shutting down");
            // Deliberate order: stop the Node processes FIRST (they hold the
            // only open connections to Postgres), THEN stop Postgres
            // gracefully, THEN dispose the job object as a final backstop for
            // anything still alive (e.g. StopPostgresGracefully itself threw,
            // or a grandchild process job-object assignment missed). This is
            // the one place nodedr-pos's shutdown sequence doesn't apply
            // as-is — that app has no database server process to shut down
            // cleanly, only a SQLite file that needs no shutdown step at all.
            try { if (_backendProcess != null && !_backendProcess.HasExited) _backendProcess.Kill(); } catch { }
            try { if (_frontendProcess != null && !_frontendProcess.HasExited) _frontendProcess.Kill(); } catch { }
            StopPostgresGracefully();
            try { _jobObject?.Dispose(); } catch { /* best-effort */ }
            try { if (_postgresProcess != null && !_postgresProcess.HasExited) _postgresProcess.Kill(); } catch { }
            try { _launcherLog?.Dispose(); } catch { /* best-effort */ }
        }
    }

    // Minimal LINQ-free helper — avoids adding System.Linq purely for one
    // FirstOrDefault call on an IEnumerable<string>.
    internal static class EnumerableExtensions
    {
        public static string FirstOrDefaultCompat(this IEnumerable<string> lines)
        {
            foreach (var line in lines) return line;
            return null;
        }
    }

    /// <summary>
    /// Thin wrapper around the Win32 Job Object APIs, configured with
    /// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE so every process assigned to it is
    /// forcibly terminated the moment the job handle closes (including on an
    /// unhandled crash of this app, not only a clean exit). Identical to
    /// nodedr-pos's JobObject helper.
    /// </summary>
    internal sealed class JobObject : IDisposable
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(
            IntPtr hJob, JobObjectInfoType infoType, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        private enum JobObjectInfoType
        {
            ExtendedLimitInformation = 9,
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

        private readonly IntPtr _handle;

        public JobObject()
        {
            _handle = CreateJobObject(IntPtr.Zero, null);
            if (_handle == IntPtr.Zero)
            {
                throw new InvalidOperationException("CreateJobObject failed: " + Marshal.GetLastWin32Error());
            }

            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
            {
                BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
                {
                    LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                },
            };
            var length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            var ok = SetInformationJobObject(_handle, JobObjectInfoType.ExtendedLimitInformation, ref info, (uint)length);
            if (!ok)
            {
                throw new InvalidOperationException("SetInformationJobObject failed: " + Marshal.GetLastWin32Error());
            }
        }

        public void AddProcess(Process process)
        {
            if (!AssignProcessToJobObject(_handle, process.Handle))
            {
                throw new InvalidOperationException("AssignProcessToJobObject failed: " + Marshal.GetLastWin32Error());
            }
        }

        public void Dispose()
        {
            CloseHandle(_handle);
        }
    }
}
