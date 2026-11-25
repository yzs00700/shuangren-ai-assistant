using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace AiAsk
{
    /// <summary>
    /// Portable launcher for the Creo AI chat window.
    ///
    /// The chat UI is served by CreoBridge at /app/index.html, so no Python
    /// static server and no file:// URL is used.  The browser profile is kept
    /// inside the package (temp\edge_profile) so browsing data does not land
    /// on the C: drive.
    /// </summary>
    internal static class Program
    {
        private const string BridgeHealth = "http://127.0.0.1:18766/health";
        private const string AppUrl = "http://127.0.0.1:18766/app/index.html";

        private static string _baseDir;
        private static string _logPath;

        [STAThread]
        private static void Main(string[] args)
        {
            _baseDir = AppDomain.CurrentDomain.BaseDirectory;
            _logPath = Path.Combine(_baseDir, "CreoAiAsk.log");

            try
            {
                string url = AppUrl;
                if (args != null && args.Length > 0 && args[0].StartsWith("http", StringComparison.OrdinalIgnoreCase))
                    url = args[0];

                if (!BridgeReady())
                {
                    StartBridge();
                    for (int i = 0; i < 40 && !BridgeReady(); i++)
                        Thread.Sleep(1000);
                }

                string browser = FindBrowser();
                string profile = Path.Combine(_baseDir, "temp", "edge_profile");
                try { Directory.CreateDirectory(profile); } catch { }

                if (!string.IsNullOrEmpty(browser))
                {
                    string arguments = "--app=\"" + url + "\"" +
                        " --window-size=480,760" +
                        " --user-data-dir=\"" + profile + "\"" +
                        " --no-first-run --disable-features=msEdgeSidebarV2";
                    Process p = Process.Start(new ProcessStartInfo(browser, arguments)
                    {
                        UseShellExecute = false,
                        WorkingDirectory = _baseDir
                    });
                    Log("browser started ok, pid=" + (p == null ? 0 : p.Id) + ", url=" + url);
                }
                else
                {
                    // Last resort: hand the URL to the default browser.  This
                    // may use the system profile, but it still works on PCs
                    // without Edge/Chrome in the usual locations.
                    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                    Log("default browser started, url=" + url);
                }
            }
            catch (Exception ex)
            {
                Log("start failed: " + ex);
                MessageBox.Show(
                    "无法打开 AI 窗口：\n" + ex.Message +
                    "\n\n请确认 CreoBridge.exe 可以运行，日志：" + _logPath,
                    "Creo AI助手", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static bool BridgeReady()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(BridgeHealth);
                req.Timeout = 1500;
                req.ReadWriteTimeout = 1500;
                req.Proxy = null;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    return resp.StatusCode == HttpStatusCode.OK;
            }
            catch
            {
                return false;
            }
        }

        private static void StartBridge()
        {
            try
            {
                if (Process.GetProcessesByName("CreoBridge").Length > 0) return;
                string exe = Path.Combine(_baseDir, "bridge", "CreoBridge.exe");
                if (!File.Exists(exe)) return;
                Process.Start(new ProcessStartInfo(exe)
                {
                    WorkingDirectory = Path.GetDirectoryName(exe),
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
                Log("bridge started: " + exe);
            }
            catch (Exception ex)
            {
                Log("bridge start failed: " + ex.Message);
            }
        }

        private static string FindBrowser()
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            string[] candidates = new string[]
            {
                Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(local, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe")
            };
            foreach (string c in candidates)
            {
                try { if (File.Exists(c)) return c; }
                catch { }
            }
            return null;
        }

        private static void Log(string message)
        {
            try
            {
                File.AppendAllText(_logPath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + "\r\n",
                    Encoding.UTF8);
            }
            catch { }
        }
    }
}
