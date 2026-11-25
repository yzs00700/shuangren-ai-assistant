using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using pfcls;

// BomTree.exe - recursive assembly BOM helper for CreoAiAsk.
//
// The packaged CreoBridge only exposes the top-level components of the active
// assembly (/assembly/info).  This helper connects to the same Creo session
// through the VB API, walks sub-assemblies to a requested depth and serves the
// result as JSON on http://127.0.0.1:18767/tree?depth=N.
//
// The connection is intentionally kept open for the lifetime of the process:
// disconnecting a second client makes the bridge's cached connection fail
// until its next retry.  The bridge recovers on its own, but keeping the
// session avoids the hiccup.
class BomTree
{
    const int DefaultPort = 18767;
    const int MaxDepth = 12;
    const int MaxNodes = 20000;

    static readonly object gate = new object();
    static IpfcAsyncConnection conn;
    static string logPath;

    class Node
    {
        public string name = "";
        public string file = "";
        public string path = "";
        public string material = "";
        public bool isAssembly;
        public int qty = 1;
        public double mass;
        public double density;
        public double[] size;
        public List<Node> children = new List<Node>();
    }

    static void Main(string[] args)
    {
        int port = DefaultPort;
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--port") int.TryParse(args[i + 1], out port);
        }

        string dir = AppDomain.CurrentDomain.BaseDirectory;
        logPath = Path.Combine(dir, "bomtree.log");

        TcpListener listener;
        try
        {
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
        }
        catch (Exception ex)
        {
            Log("listen failed on " + port + ": " + ex.Message);
            return;
        }

        Log("BomTree listening on http://127.0.0.1:" + port + "/");

        while (true)
        {
            TcpClient client = null;
            try
            {
                client = listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(HandleClient, client);
            }
            catch (Exception ex)
            {
                Log("accept failed: " + ex.Message);
                if (client != null) { try { client.Close(); } catch { } }
            }
        }
    }

    static void HandleClient(object state)
    {
        var client = (TcpClient)state;
        try
        {
            client.ReceiveTimeout = 120000;
            client.SendTimeout = 120000;
            var stream = client.GetStream();
            var reader = new StreamReader(stream, Encoding.ASCII, false, 4096, true);

            string requestLine = reader.ReadLine();
            if (string.IsNullOrEmpty(requestLine)) return;
            string header;
            while (!string.IsNullOrEmpty(header = reader.ReadLine())) { }

            string[] parts = requestLine.Split(' ');
            if (parts.Length < 2) return;
            string method = parts[0].ToUpperInvariant();
            string target = parts[1];

            if (method == "OPTIONS")
            {
                WriteResponse(stream, 204, "text/plain; charset=utf-8", "",
                    "Access-Control-Allow-Methods: GET, OPTIONS\r\n" +
                    "Access-Control-Allow-Headers: Content-Type\r\n");
                return;
            }
            if (method != "GET")
            {
                WriteResponse(stream, 405, "application/json; charset=utf-8",
                    "{\"ok\":false,\"error\":\"method not allowed\"}");
                return;
            }

            string path = target;
            string query = "";
            int q = target.IndexOf('?');
            if (q >= 0) { path = target.Substring(0, q); query = target.Substring(q + 1); }

            if (path == "/health")
            {
                bool alive = false;
                try { lock (gate) { alive = Connect().IsRunning(); } } catch { }
                WriteResponse(stream, 200, "application/json; charset=utf-8",
                    "{\"ok\":true,\"service\":\"BomTree\",\"port\":" + DefaultPort +
                    ",\"creo\":" + (alive ? "true" : "false") + "}");
                return;
            }

            if (path == "/tree" || path == "/assembly/tree")
            {
                int depth = 99;
                foreach (string kv in query.Split('&'))
                {
                    int eq = kv.IndexOf('=');
                    if (eq <= 0) continue;
                    string k = kv.Substring(0, eq);
                    string v = kv.Substring(eq + 1);
                    if (k == "depth" || k == "levels")
                    {
                        int.TryParse(v, out depth);
                        if (depth <= 0) depth = 99;
                    }
                }
                if (depth > MaxDepth) depth = MaxDepth;

                string json;
                lock (gate)
                {
                    try
                    {
                        json = BuildTreeJson(depth);
                    }
                    catch (Exception ex)
                    {
                        conn = null; // force a fresh connection next time
                        json = ErrorJson(ex);
                        Log("tree failed: " + ex.Message);
                    }
                }
                WriteResponse(stream, 200, "application/json; charset=utf-8", json);
                return;
            }

            WriteResponse(stream, 404, "application/json; charset=utf-8",
                "{\"ok\":false,\"error\":\"not found\"}");
        }
        catch (Exception ex)
        {
            Log("client failed: " + ex.Message);
        }
        finally
        {
            try { client.Close(); } catch { }
        }
    }

    static IpfcAsyncConnection Connect()
    {
        if (conn != null)
        {
            try
            {
                if (conn.IsRunning()) return conn;
            }
            catch { }
            conn = null;
        }
        var factory = new CCpfcAsyncConnectionClass();
        conn = factory.Connect(null, null, null, null);
        return conn;
    }

    static string BuildTreeJson(int depth)
    {
        var connection = Connect();
        var sess = (IpfcBaseSession)connection.Session;
        var model = sess.GetActiveModel();
        if (model == null)
            return "{\"ok\":false,\"error\":\"Creo 褰撳墠娌℃湁鎵撳紑妯″瀷\"}";

        var ctx = new BuildContext();
        ctx.session = sess;
        ctx.depth = depth;
        ctx.stack = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        Node root = BuildNode(model, depth, ctx);

        var sb = new StringBuilder(8192);
        sb.Append("{\"ok\":true,\"service\":\"BomTree\",\"model\":");
        JsonString(sb, root.file);
        sb.Append(",\"path\":");
        JsonString(sb, root.path);
        sb.Append(",\"dir\":");
        JsonString(sb, DirOf(root.path));
        sb.Append(",\"depth\":").Append(depth);
        sb.Append(",\"count\":").Append(ctx.count);
        sb.Append(",\"truncated\":").Append(ctx.truncated ? "true" : "false");
        sb.Append(",\"tree\":");
        WriteNode(sb, root);
        sb.Append('}');
        return sb.ToString();
    }

    class BuildContext
    {
        public IpfcBaseSession session;
        public int depth;
        public int count;
        public bool truncated;
        public HashSet<string> stack;
    }

    static Node BuildNode(IpfcModel model, int depth, BuildContext ctx)
    {
        var node = new Node();
        node.file = SafeFileName(model);
        node.name = StripExt(node.file);
        node.path = FullPath(model);
        node.isAssembly = model is IpfcAssembly;
        ctx.count++;
        if (ctx.count > MaxNodes) ctx.truncated = true;

        var solid = model as IpfcSolid;
        if (solid != null)
        {
            try
            {
                var outline = (IpfcOutline3D)solid.EvalOutline(null, null);
                double[] min = null, max = null;
                var en = outline.GetEnumerator();
                int idx = 0;
                while (en.MoveNext())
                {
                    var pt = (IpfcPoint3D)en.Current;
                    double[] v = new double[] { pt[0], pt[1], pt[2] };
                    if (idx == 0) min = v;
                    else if (idx == 1) max = v;
                    idx++;
                }
                if (min != null && max != null)
                {
                    node.size = new double[] {
                        max[0] - min[0], max[1] - min[1], max[2] - min[2]
                    };
                }
            }
            catch { }
        }

        var part = model as IpfcPart;
        if (part != null)
        {
            try
            {
                var mat = part.get_CurrentMaterial();
                if (mat != null && !string.IsNullOrEmpty(mat.Name) &&
                    mat.Name != "PTC_SYSTEM_MTRL_PROPS")
                {
                    node.material = mat.Name;
                    try { node.density = mat.MassDensity; } catch { }
                }
            }
            catch { }
            try
            {
                var mp = solid.GetMassProperty(null);
                if (mp != null)
                {
                    node.mass = mp.Mass;
                    if (node.density <= 0) node.density = mp.Density;
                }
            }
            catch { }
        }

        if (!node.isAssembly || depth <= 0 || ctx.truncated) return node;

        string key = node.file.ToLowerInvariant();
        if (ctx.stack.Contains(key)) return node; // cyclic reference guard
        ctx.stack.Add(key);

        var groups = new List<Node>();
        var byFile = new Dictionary<string, Node>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var comps = (IpfcFeatures)solid.ListFeaturesByType(false,
                EpfcFeatureType.EpfcFEATTYPE_COMPONENT);
            for (int i = 0; i < comps.Count; i++)
            {
                IpfcComponentFeat comp = null;
                try { comp = comps[i] as IpfcComponentFeat; } catch { }
                if (comp == null) continue;

                IpfcModelDescriptor descr = null;
                try { descr = comp.ModelDescr; } catch { }
                if (descr == null) continue;

                string file = "";
                try { file = descr.GetFileName(); } catch { }
                if (string.IsNullOrEmpty(file)) continue;

                Node existing;
                if (byFile.TryGetValue(file, out existing))
                {
                    existing.qty++;
                    continue;
                }

                IpfcModel childModel = null;
                try { childModel = ctx.session.GetModelFromDescr(descr); } catch { }
                if (childModel == null)
                {
                    try { childModel = ctx.session.RetrieveModel(descr); } catch { }
                }

                Node child;
                if (childModel != null)
                {
                    child = BuildNode(childModel, depth - 1, ctx);
                }
                else
                {
                    child = new Node();
                    child.path = CombinePath(descr.Path, file);
                    child.isAssembly = file.EndsWith(".asm", StringComparison.OrdinalIgnoreCase);
                }
                // FileName on a retrieved child can be normalized to lower case;
                // keep the spelling used by the assembly descriptor.
                child.file = file;
                child.name = StripExt(file);
                child.qty = 1;
                byFile[file] = child;
                groups.Add(child);
                if (ctx.count > MaxNodes) { ctx.truncated = true; break; }
            }
        }
        catch (Exception ex)
        {
            Log("list components failed for " + node.file + ": " + ex.Message);
        }

        node.children = groups;
        ctx.stack.Remove(key);
        return node;
    }

    static string SafeFileName(IpfcModel model)
    {
        try
        {
            string name = model.FileName;
            if (!string.IsNullOrEmpty(name)) return name;
        }
        catch { }
        try { return model.Descr.GetFileName(); } catch { }
        return "";
    }

    static string FullPath(IpfcModel model)
    {
        try
        {
            var d = model.Descr;
            if (d == null) return "";
            return CombinePath(d.Path, d.GetFileName());
        }
        catch { return ""; }
    }

    static string CombinePath(string dir, string file)
    {
        if (string.IsNullOrEmpty(file)) return "";
        if (string.IsNullOrEmpty(dir)) return file;
        try { return Path.Combine(dir, file); } catch { return dir + file; }
    }

    static string DirOf(string path)
    {
        try { return string.IsNullOrEmpty(path) ? "" : Path.GetDirectoryName(path); }
        catch { return ""; }
    }

    static string StripExt(string file)
    {
        if (string.IsNullOrEmpty(file)) return "";
        int dot = file.LastIndexOf('.');
        return dot > 0 ? file.Substring(0, dot) : file;
    }

    static string ErrorJson(Exception ex)
    {
        var sb = new StringBuilder();
        sb.Append("{\"ok\":false,\"error\":");
        JsonString(sb, ex.Message);
        sb.Append("}");
        return sb.ToString();
    }

    static void WriteNode(StringBuilder sb, Node n)
    {
        sb.Append("{\"name\":");
        JsonString(sb, n.name);
        sb.Append(",\"file\":");
        JsonString(sb, n.file);
        sb.Append(",\"path\":");
        JsonString(sb, n.path);
        sb.Append(",\"material\":");
        JsonString(sb, n.material);
        sb.Append(",\"isAssembly\":").Append(n.isAssembly ? "true" : "false");
        sb.Append(",\"qty\":").Append(n.qty);
        sb.Append(",\"mass\":").Append(Num(n.mass));
        sb.Append(",\"density\":").Append(Num(n.density));
        sb.Append(",\"size\":");
        if (n.size == null)
        {
            sb.Append("null");
        }
        else
        {
            sb.Append('[').Append(Num(n.size[0])).Append(',')
              .Append(Num(n.size[1])).Append(',')
              .Append(Num(n.size[2])).Append(']');
        }
        sb.Append(",\"children\":[");
        for (int i = 0; i < n.children.Count; i++)
        {
            if (i > 0) sb.Append(',');
            WriteNode(sb, n.children[i]);
        }
        sb.Append("]}");
    }

    static string Num(double v)
    {
        if (double.IsNaN(v) || double.IsInfinity(v)) return "0";
        return v.ToString("0.####", CultureInfo.InvariantCulture);
    }

    static void JsonString(StringBuilder sb, string s)
    {
        if (s == null) { sb.Append("null"); return; }
        sb.Append('"');
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
    }

    static void WriteResponse(NetworkStream stream, int status, string contentType,
        string body, string extraHeaders = null)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(body ?? "");
        string reason = status == 200 ? "OK" : status == 204 ? "No Content" :
                        status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : "OK";
        var sb = new StringBuilder();
        sb.Append("HTTP/1.1 ").Append(status).Append(' ').Append(reason).Append("\r\n");
        sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
        sb.Append("Content-Length: ").Append(bytes.Length).Append("\r\n");
        sb.Append("Access-Control-Allow-Origin: *\r\n");
        sb.Append("Cache-Control: no-store\r\n");
        sb.Append("Connection: close\r\n");
        if (!string.IsNullOrEmpty(extraHeaders)) sb.Append(extraHeaders);
        sb.Append("\r\n");
        byte[] head = Encoding.ASCII.GetBytes(sb.ToString());
        stream.Write(head, 0, head.Length);
        if (bytes.Length > 0) stream.Write(bytes, 0, bytes.Length);
        stream.Flush();
    }

    static void Log(string msg)
    {
        try
        {
            File.AppendAllText(logPath,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + msg + Environment.NewLine,
                Encoding.UTF8);
        }
        catch { }
    }
}


