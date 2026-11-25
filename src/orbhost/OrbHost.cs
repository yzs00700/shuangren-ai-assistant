using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace CreoAiOrb
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new OrbForm());
        }
    }

    /// <summary>
    /// 收起态：只显示 Logo 的分层透明窗口。
    /// 使用 UpdateLayeredWindow 做逐像素透明，边缘由 GDI+ 抗锯齿，
    /// 因此不需要白色底板，也不会有 SetWindowRgn 造成的锯齿。
    /// </summary>
    internal sealed class OrbIconForm : Form
    {
        private const int IconWindowSize = 84;
        private const int IconPixels = 72;

        private Bitmap surface;
        private bool dragging;
        private bool moved;
        private Point downScreen;
        private Point downLocation;

        public event EventHandler Clicked;

        [StructLayout(LayoutKind.Sequential)]
        private struct NativePoint
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeSize
        {
            public int Width;
            public int Height;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct BlendFunction
        {
            public byte BlendOp;
            public byte BlendFlags;
            public byte SourceConstantAlpha;
            public byte AlphaFormat;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateCompatibleDC(IntPtr hDC);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        private static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteObject(IntPtr hObject);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst,
            ref NativePoint pptDst, ref NativeSize psize, IntPtr hdcSrc,
            ref NativePoint pptSrc, int crKey, ref BlendFunction pblend, int dwFlags);

        private const int ULW_ALPHA = 2;
        private const byte AC_SRC_OVER = 0;
        private const byte AC_SRC_ALPHA = 1;

        public Point AnchorCenter
        {
            get { return new Point(Left + Width / 2, Top + Height / 2); }
        }

        public OrbIconForm(string iconPath)
        {
            Text = "霜刃 AI";
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            MinimumSize = new Size(1, 1);
            Size = new Size(IconWindowSize, IconWindowSize);
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer, true);

            surface = BuildSurface(iconPath);
            MouseDown += OnIconMouseDown;
            MouseMove += OnIconMouseMove;
            MouseUp += OnIconMouseUp;
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x00080000; // WS_EX_LAYERED
                cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
                cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            ApplySurface();
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            // The layered surface is painted by UpdateLayeredWindow.
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            ApplySurface();
        }

        public void ShowAt(Point center)
        {
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            int x = Math.Max(wa.Left, Math.Min(center.X - Width / 2, wa.Right - Width));
            int y = Math.Max(wa.Top, Math.Min(center.Y - Height / 2, wa.Bottom - Height));
            Location = new Point(x, y);
            if (!Visible) Show();
            ApplySurface();
        }

        private void ApplySurface()
        {
            if (!IsHandleCreated || surface == null) return;
            IntPtr screenDc = GetDC(IntPtr.Zero);
            IntPtr memDc = CreateCompatibleDC(screenDc);
            IntPtr hBitmap = IntPtr.Zero;
            IntPtr oldBitmap = IntPtr.Zero;
            try
            {
                hBitmap = surface.GetHbitmap(Color.FromArgb(0));
                oldBitmap = SelectObject(memDc, hBitmap);
                var size = new NativeSize { Width = surface.Width, Height = surface.Height };
                var src = new NativePoint { X = 0, Y = 0 };
                var dst = new NativePoint { X = Left, Y = Top };
                var blend = new BlendFunction
                {
                    BlendOp = AC_SRC_OVER,
                    BlendFlags = 0,
                    SourceConstantAlpha = 255,
                    AlphaFormat = AC_SRC_ALPHA
                };
                UpdateLayeredWindow(Handle, screenDc, ref dst, ref size,
                    memDc, ref src, 0, ref blend, ULW_ALPHA);
            }
            finally
            {
                if (oldBitmap != IntPtr.Zero) SelectObject(memDc, oldBitmap);
                if (hBitmap != IntPtr.Zero) DeleteObject(hBitmap);
                if (memDc != IntPtr.Zero) DeleteDC(memDc);
                if (screenDc != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screenDc);
            }
        }

        private static Bitmap BuildSurface(string iconPath)
        {
            var bmp = new Bitmap(IconWindowSize, IconWindowSize, PixelFormat.Format32bppPArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;

                // 很轻的投影，保证浅色桌面上也能看清轮廓。
                int shadowSize = IconPixels + 8;
                var shadowRect = new Rectangle(
                    (IconWindowSize - shadowSize) / 2 + 1,
                    (IconWindowSize - shadowSize) / 2 + 2,
                    shadowSize - 2, shadowSize - 2);
                using (var path = new GraphicsPath())
                {
                    path.AddEllipse(shadowRect);
                    using (var brush = new PathGradientBrush(path))
                    {
                        brush.CenterColor = Color.FromArgb(70, 0, 0, 0);
                        brush.SurroundColors = new[] { Color.FromArgb(0, 0, 0, 0) };
                        g.FillPath(brush, path);
                    }
                }

                int x = (IconWindowSize - IconPixels) / 2;
                int y = (IconWindowSize - IconPixels) / 2;
                if (File.Exists(iconPath))
                {
                    using (var src = new Bitmap(iconPath))
                    {
                        g.DrawImage(src, new Rectangle(x, y, IconPixels, IconPixels));
                    }
                }
                else
                {
                    using (var brush = new SolidBrush(Color.FromArgb(59, 130, 246)))
                    {
                        g.FillEllipse(brush, x, y, IconPixels, IconPixels);
                    }
                }
            }
            return bmp;
        }

        private void OnIconMouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            dragging = true;
            moved = false;
            downScreen = Cursor.Position;
            downLocation = Location;
        }

        private void OnIconMouseMove(object sender, MouseEventArgs e)
        {
            if (!dragging) return;
            Point p = Cursor.Position;
            if (!moved && Math.Abs(p.X - downScreen.X) + Math.Abs(p.Y - downScreen.Y) < 4) return;
            moved = true;
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            int x = downLocation.X + p.X - downScreen.X;
            int y = downLocation.Y + p.Y - downScreen.Y;
            x = Math.Max(wa.Left, Math.Min(x, wa.Right - Width));
            y = Math.Max(wa.Top, Math.Min(y, wa.Bottom - Height));
            Location = new Point(x, y);
        }

        private void OnIconMouseUp(object sender, MouseEventArgs e)
        {
            if (!dragging || e.Button != MouseButtons.Left) return;
            dragging = false;
            if (!moved && Clicked != null) Clicked(this, EventArgs.Empty);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && surface != null)
            {
                surface.Dispose();
                surface = null;
            }
            base.Dispose(disposing);
        }
    }

    internal sealed class OrbForm : Form
    {
        private readonly WebView2 view;
        private readonly OrbIconForm iconForm;
        private string userDataFolder;
        private bool ready;
        private bool pageReady;
        private Point orbAnchor;
        private string currentShape = "square";
        private bool collapsed = true;

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height);

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateEllipticRgn(int left, int top, int right, int bottom);

        [DllImport("user32.dll")]
        private static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool redraw);

        private static void Log(string text)
        {
            try
            {
                string dir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "temp");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "orb.log"),
                    DateTime.Now.ToString("HH:mm:ss.fff") + " " + text + Environment.NewLine);
            }
            catch { }
        }

        public OrbForm()
        {
            Log("constructor start");
            Text = "霜刃 AI";
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Color.White;
            MinimumSize = new Size(1, 1);
            Size = new Size(96, 96);
            // 初始化 WebView2 期间主窗口停在屏幕外，桌面只显示分层 Logo。
            Location = new Point(-4000, -4000);

            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            // 与旧 96px 窗口保持同一个中心点，避免悬浮图标位置跳动。
            orbAnchor = new Point(
                Math.Max(0, wa.Right - 78),
                Math.Max(0, wa.Bottom - 108));

            iconForm = new OrbIconForm(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "orb_icon.png"));
            iconForm.Clicked += delegate { OpenWheelFromIcon(); };

            view = new WebView2();
            view.Dock = DockStyle.Fill;
            view.BackColor = Color.White;
            // The page background stays transparent so the host can paint the
            // crisp white wheel / dark dialog shell behind it.
            try { view.DefaultBackgroundColor = Color.Transparent; } catch { }
            Controls.Add(view);

            SetRegion("square");
            Log("constructor end size=" + Width + "x" + Height + " anchor=" + orbAnchor);

            EventHandler firstShown = null;
            firstShown = async delegate
            {
                Shown -= firstShown;
                Log("shown event");
                iconForm.ShowAt(orbAnchor);
                await InitAsync();
                Hide();
                Log("main window hidden, icon at " + iconForm.AnchorCenter);
            };
            Shown += firstShown;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            SetRegion("square");
        }

        private async Task InitAsync()
        {
            try
            {
                Log("init start");
                userDataFolder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "temp", "webview2");
                Directory.CreateDirectory(userDataFolder);
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, null);
                Log("environment ready");
                await view.EnsureCoreWebView2Async(env);
                try { view.DefaultBackgroundColor = Color.Transparent; } catch { }
                Log("webview ready");

                CoreWebView2 core = view.CoreWebView2;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.WebMessageReceived += OnWebMessage;
                core.NavigationCompleted += delegate
                {
                    pageReady = true;
                    Log("navigation completed");
                };
                core.Navigate("http://127.0.0.1:18766/app/index.html?orb=1");
                Log("navigate");
                ready = true;
            }
            catch (Exception ex)
            {
                Log("init error: " + ex);
                MessageBox.Show("无法启动霜刃 AI 悬浮窗口：\n" + ex.Message,
                    "霜刃 AI", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!ready) return;
            try
            {
                var ser = new JavaScriptSerializer();
                var msg = ser.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                if (msg == null || !msg.ContainsKey("type")) return;
                string type = Convert.ToString(msg["type"]);
                if (type == "resize")
                {
                    int w = ToInt(msg, "width", Width);
                    int h = ToInt(msg, "height", Height);
                    string shape = msg.ContainsKey("shape") ? Convert.ToString(msg["shape"]) : "rect";
                    if (string.Equals(shape, "square", StringComparison.OrdinalIgnoreCase))
                    {
                        CollapseToIcon();
                        return;
                    }
                    ResizeTo(w, h, shape);
                }
                else if (type == "collapse")
                {
                    CollapseToIcon();
                }
                else if (type == "openWheel")
                {
                    if (collapsed) OpenWheelFromIcon();
                }
                else if (type == "moveBy")
                {
                    int dx = ToInt(msg, "dx", 0);
                    int dy = ToInt(msg, "dy", 0);
                    Left += dx;
                    Top += dy;
                    ClampToScreen();
                    orbAnchor = new Point(Left + Width / 2, Top + Height / 2);
                    Log("moveBy " + dx + "," + dy + " -> " + Left + "," + Top + " anchor=" + orbAnchor);
                }
                else if (type == "close")
                {
                    Close();
                }
            }
            catch
            {
                // Ignore malformed messages from the page.
            }
        }

        private static int ToInt(Dictionary<string, object> msg, string key, int fallback)
        {
            object v;
            if (!msg.TryGetValue(key, out v) || v == null) return fallback;
            try { return Convert.ToInt32(v); } catch { return fallback; }
        }

        private void OpenWheelFromIcon()
        {
            if (!ready)
            {
                Log("icon click ignored: webview not ready");
                return;
            }
            Point center = iconForm.AnchorCenter;
            orbAnchor = center;
            iconForm.Hide();
            collapsed = false;

            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            int w = Math.Min(340, wa.Width - 10);
            int h = Math.Min(340, wa.Height - 10);
            Size = new Size(w, h);
            Location = new Point(center.X - w / 2, center.Y - h / 2);
            SetRegion("circle");
            ClampToScreen();
            BackColor = Color.White;
            if (view != null) view.BackColor = Color.White;
            currentShape = "wheel";

            Show();
            Activate();
            Log("open wheel from icon at " + center);
            PostOpenWheelWhenReady();
        }

        private async void PostOpenWheelWhenReady()
        {
            for (int i = 0; i < 50; i++)
            {
                if (pageReady && view.CoreWebView2 != null)
                {
                    try
                    {
                        view.CoreWebView2.PostWebMessageAsJson("{\"type\":\"hostOpenWheel\"}");
                        return;
                    }
                    catch { }
                }
                await Task.Delay(100);
            }
        }

        private void CollapseToIcon()
        {
            if (collapsed) return;
            collapsed = true;
            Hide();
            iconForm.ShowAt(orbAnchor);
            currentShape = "square";
            Log("collapsed to icon at " + orbAnchor);
        }

        private void ResizeTo(int w, int h, string shape)
        {
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            w = Math.Max(90, Math.Min(w, wa.Width - 10));
            h = Math.Max(90, Math.Min(h, wa.Height - 10));

            string state = string.Equals(shape, "circle", StringComparison.OrdinalIgnoreCase)
                ? "wheel"
                : "dialog";

            // The wheel/dialog open around their current center.  Returning to the
            // square state is handled by CollapseToIcon(), which uses orbAnchor.
            int cx = Left + Width / 2;
            int cy = Top + Height / 2;

            Size = new Size(w, h);
            Location = new Point(cx - w / 2, cy - h / 2);
            SetRegion(shape);
            ClampToScreen();
            currentShape = state;

            // 全部使用白色外壳：轮盘和领域对话框都不再出现黑色/磨砂边框。
            BackColor = Color.White;
            if (view != null) view.BackColor = Color.White;
        }

        private void ClampToScreen()
        {
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            int x = Math.Max(wa.Left, Math.Min(Left, wa.Right - Width));
            int y = Math.Max(wa.Top, Math.Min(Top, wa.Bottom - Height));
            if (x != Left || y != Top) Location = new Point(x, y);
        }

        private void SetRegion(string shape)
        {
            if (IsHandleCreated)
            {
                IntPtr rgn;
                if (string.Equals(shape, "circle", StringComparison.OrdinalIgnoreCase))
                {
                    rgn = CreateEllipticRgn(0, 0, Width + 1, Height + 1);
                }
                else
                {
                    int radius = string.Equals(shape, "square", StringComparison.OrdinalIgnoreCase)
                        ? Math.Min(26, Width / 4)
                        : Math.Min(18, Width / 8);
                    rgn = CreateRoundRectRgn(0, 0, Width + 1, Height + 1, radius * 2, radius * 2);
                }
                SetWindowRgn(Handle, rgn, true);
            }

            using (var path = new GraphicsPath())
            {
                if (string.Equals(shape, "circle", StringComparison.OrdinalIgnoreCase))
                {
                    path.AddEllipse(0, 0, Width, Height);
                }
                else if (string.Equals(shape, "square", StringComparison.OrdinalIgnoreCase))
                {
                    AddRoundRect(path, new Rectangle(0, 0, Width, Height), Math.Min(26, Width / 4));
                }
                else
                {
                    AddRoundRect(path, new Rectangle(0, 0, Width, Height), Math.Min(18, Width / 8));
                }
                Region = new Region(path);
            }
        }

        private static void AddRoundRect(GraphicsPath path, Rectangle r, int radius)
        {
            int d = Math.Max(2, radius * 2);
            if (d > r.Width) d = r.Width;
            if (d > r.Height) d = r.Height;
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (iconForm != null && !iconForm.IsDisposed) iconForm.Close();
            base.OnFormClosing(e);
        }
    }
}
