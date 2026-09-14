using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
namespace LdBrowserRemote
{
internal sealed class BridgeConfig
{
public string TailscaleIP;
public int HttpPort;
public int ForwardPort;
public string AccessPassword;
public string Pin;
public string BridgeKey;
public string LDConsole;
public string AdbExe;
public string ScrcpyServer;
public string Scid;
public int InstanceIndex;
public int MaxSize;
public int MaxFps;
public int VideoBitRate;
public static BridgeConfig Load(string path)
{
var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
foreach (var raw in File.ReadAllLines(path, Encoding.UTF8))
{
var line = raw.Trim();
if (line.Length == 0 || line.StartsWith("#")) continue;
int pos = line.IndexOf('=');
if (pos <= 0) continue;
map[line.Substring(0, pos).Trim()] = line.Substring(pos + 1).Trim();
}
var c = new BridgeConfig();
c.TailscaleIP = Get(map, "TailscaleIP");
c.HttpPort = GetInt(map, "HttpPort", 17920);
c.ForwardPort = GetInt(map, "ForwardPort", 27183);
c.AccessPassword = Get(map, "AccessPassword");
c.Pin = Get(map, "Pin");
c.BridgeKey = Get(map, "BridgeKey");
if (String.IsNullOrEmpty(c.AccessPassword)) c.AccessPassword = c.Pin;
if (String.IsNullOrEmpty(c.Pin)) c.Pin = c.AccessPassword;
c.LDConsole = Get(map, "LDConsole");
c.AdbExe = Get(map, "AdbExe");
c.ScrcpyServer = Get(map, "ScrcpyServer");
c.Scid = Get(map, "Scid");
c.InstanceIndex = GetInt(map, "InstanceIndex", 0);
c.MaxSize = GetInt(map, "MaxSize", 1280);
c.MaxFps = GetInt(map, "MaxFps", 30);
c.VideoBitRate = GetInt(map, "VideoBitRate", 3000000);
return c;
}
private static string Get(Dictionary<string, string> map, string key)
{
string v;
return map.TryGetValue(key, out v) ? v : "";
}
private static int GetInt(Dictionary<string, string> map, string key, int fallback)
{
string v;
int x;
return map.TryGetValue(key, out v) && int.TryParse(v, out x) ? x : fallback;
}
}
internal sealed class ScrcpySession : IDisposable
{
private readonly BridgeConfig cfg;
private readonly Action<string> log;
private readonly object controlLock = new object();
private Process serverProcess;
private TcpClient videoClient;
private TcpClient controlClient;
private NetworkStream videoStream;
private NetworkStream controlStream;
private string serial;
public bool IsStarted { get { return videoStream != null && controlStream != null; } }
public string Serial { get { return serial ?? ""; } }
public NetworkStream VideoStream { get { return videoStream; } }
public ScrcpySession(BridgeConfig config, Action<string> logger)
{
cfg = config;
log = logger;
}
public void Start()
{
Stop();
try
{
if (IsInstanceRunning())
{
log("LDPlayer instance is already running; launch skipped to avoid bringing its window to foreground.");
}
else
{
log("LDPlayer instance is not running; starting index " + cfg.InstanceIndex.ToString(CultureInfo.InvariantCulture) + ".");
RunProcess(cfg.LDConsole, "launch --index " + cfg.InstanceIndex.ToString(CultureInfo.InvariantCulture), 15000);
}
}
catch (Exception ex)
{
log("LDPlayer state/launch warning: " + ex.Message);
}
serial = WaitForDevice(45);
if (String.IsNullOrEmpty(serial))
throw new Exception("No online LDPlayer ADB device was found.");
string remote = "/data/local/tmp/ldbr-scrcpy-server-v4.1.jar";
RunProcess(cfg.AdbExe, "-s " + Q(serial) + " push " + Q(cfg.ScrcpyServer) + " " + remote, 30000);
try
{
RunProcess(cfg.AdbExe, "-s " + Q(serial) + " forward --remove tcp:" + cfg.ForwardPort, 5000);
}
catch { }
string abstractName = "scrcpy_" + cfg.Scid;
RunProcess(cfg.AdbExe, "-s " + Q(serial) + " forward tcp:" + cfg.ForwardPort + " localabstract:" + abstractName, 10000);
string args =
"-s " + Q(serial) +
" shell CLASSPATH=" + remote +
" app_process / com.genymobile.scrcpy.Server 4.1" +
" scid=" + cfg.Scid +
" log_level=info" +
" video=true" +
" audio=false" +
" control=true" +
" video_codec=h264" +
" max_size=" + cfg.MaxSize.ToString(CultureInfo.InvariantCulture) +
" max_fps=" + cfg.MaxFps.ToString(CultureInfo.InvariantCulture) +
" video_bit_rate=" + cfg.VideoBitRate.ToString(CultureInfo.InvariantCulture) +
" video_codec_options=profile:int=1,level:int=512,frame-rate:int=30,i-frame-interval:int=1" +
" tunnel_forward=true" +
" send_device_meta=false" +
" send_dummy_byte=true" +
" cleanup=false";
var psi = new ProcessStartInfo();
psi.FileName = cfg.AdbExe;
psi.Arguments = args;
psi.UseShellExecute = false;
psi.CreateNoWindow = true;
psi.RedirectStandardOutput = true;
psi.RedirectStandardError = true;
serverProcess = new Process();
serverProcess.StartInfo = psi;
serverProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
{
if (!String.IsNullOrWhiteSpace(e.Data)) log("scrcpy: " + e.Data);
};
serverProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
{
if (!String.IsNullOrWhiteSpace(e.Data)) log("scrcpy: " + e.Data);
};
serverProcess.EnableRaisingEvents = true;
serverProcess.Exited += delegate(object sender, EventArgs e)
{
try { log("scrcpy server process exited, code=" + serverProcess.ExitCode.ToString(CultureInfo.InvariantCulture)); }
catch { log("scrcpy server process exited."); }
};
serverProcess.Start();
serverProcess.BeginOutputReadLine();
serverProcess.BeginErrorReadLine();
videoClient = ConnectVideoSocketAndConsumeDummy(cfg.ForwardPort, 12000);
videoClient.NoDelay = true;
videoStream = videoClient.GetStream();
controlClient = ConnectWithRetry(cfg.ForwardPort, 7000);
controlClient.NoDelay = true;
controlStream = controlClient.GetStream();
log("scrcpy sockets ready: video dummy byte received, control connected; " + serial + " -> 127.0.0.1:" + cfg.ForwardPort);
}
public void Stop()
{
try { if (videoStream != null) videoStream.Close(); } catch { }
try { if (controlStream != null) controlStream.Close(); } catch { }
try { if (videoClient != null) videoClient.Close(); } catch { }
try { if (controlClient != null) controlClient.Close(); } catch { }
videoStream = null;
controlStream = null;
videoClient = null;
controlClient = null;
try
{
if (serverProcess != null && !serverProcess.HasExited)
{
serverProcess.Kill();
serverProcess.WaitForExit(2000);
}
}
catch { }
try { if (serverProcess != null) serverProcess.Dispose(); } catch { }
serverProcess = null;
if (!String.IsNullOrEmpty(serial))
{
try
{
RunProcess(cfg.AdbExe, "-s " + Q(serial) + " forward --remove tcp:" + cfg.ForwardPort, 5000);
}
catch { }
}
}
public void SendTouch(byte action, ulong pointerId, int x, int y, int width, int height, double pressure)
{
byte[] b = new byte[32];
b[0] = 2; // INJECT_TOUCH_EVENT
b[1] = action;
W64(b, 2, pointerId);
W32(b, 10, unchecked((uint)x));
W32(b, 14, unchecked((uint)y));
W16(b, 18, (ushort)Math.Max(1, Math.Min(65535, width)));
W16(b, 20, (ushort)Math.Max(1, Math.Min(65535, height)));
ushort p;
if (pressure <= 0) p = 0;
else if (pressure >= 1) p = 65535;
else p = (ushort)Math.Max(0, Math.Min(65535, (int)Math.Round(pressure * 65535.0)));
W16(b, 22, p);
W32(b, 24, 0);
W32(b, 28, 0);
WriteControl(b);
}
public void SendKey(int keyCode)
{
WriteControl(BuildKey(0, keyCode));
WriteControl(BuildKey(1, keyCode));
}
public void SendBackOrScreenOn()
{
WriteControl(new byte[] { 4, 0 });
WriteControl(new byte[] { 4, 1 });
}
public void SendRotate()
{
WriteControl(new byte[] { 11 });
}
public void SendResetVideo()
{
WriteControl(new byte[] { 17 });
}
public void SendClipboardPaste(string text)
{
if (text == null) text = "";
byte[] data = Encoding.UTF8.GetBytes(text);
if (data.Length > 200000)
{
byte[] trimmed = new byte[200000];
Buffer.BlockCopy(data, 0, trimmed, 0, trimmed.Length);
data = trimmed;
}
byte[] b = new byte[14 + data.Length];
b[0] = 9; // SET_CLIPBOARD
W64(b, 1, 0);
b[9] = 1; // paste
W32(b, 10, (uint)data.Length);
Buffer.BlockCopy(data, 0, b, 14, data.Length);
WriteControl(b);
}
private byte[] BuildKey(byte action, int code)
{
byte[] b = new byte[14];
b[0] = 0; // INJECT_KEYCODE
b[1] = action;
W32(b, 2, unchecked((uint)code));
W32(b, 6, 0);
W32(b, 10, 0);
return b;
}
private void WriteControl(byte[] data)
{
lock (controlLock)
{
if (controlStream == null) throw new IOException("Control stream is not connected.");
controlStream.Write(data, 0, data.Length);
controlStream.Flush();
}
}
private string WaitForDevice(int seconds)
{
DateTime until = DateTime.UtcNow.AddSeconds(seconds);
while (DateTime.UtcNow < until)
{
string output = "";
try { output = RunProcess(cfg.AdbExe, "devices", 5000); } catch { }
string fallback = null;
foreach (var raw in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
{
string line = raw.Trim();
if (!line.EndsWith("\tdevice", StringComparison.OrdinalIgnoreCase) &&
!line.EndsWith(" device", StringComparison.OrdinalIgnoreCase))
continue;
string s = line.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries)[0];
if (s.StartsWith("emulator-", StringComparison.OrdinalIgnoreCase))
return s;
if (fallback == null && (s.StartsWith("127.0.0.1:", StringComparison.OrdinalIgnoreCase) || s.Contains(":")))
fallback = s;
}
if (fallback != null) return fallback;
Thread.Sleep(1000);
}
return null;
}
private bool IsInstanceRunning()
{
string output = RunProcess(cfg.LDConsole, "list2", 5000);
foreach (string raw in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
{
string[] parts = raw.Trim().Split(',');
if (parts.Length < 5) continue;
int idx;
if (!Int32.TryParse(parts[0].Trim(), out idx)) continue;
if (idx != cfg.InstanceIndex) continue;
return parts[4].Trim() == "1";
}
return false;
}
private TcpClient ConnectVideoSocketAndConsumeDummy(int port, int timeoutMs)
{
Stopwatch sw = Stopwatch.StartNew();
Exception last = null;
while (sw.ElapsedMilliseconds < timeoutMs)
{
TcpClient c = new TcpClient();
try
{
var task = c.ConnectAsync(IPAddress.Loopback, port);
if (!task.Wait(1200) || !c.Connected)
{
try { c.Close(); } catch { }
Thread.Sleep(120);
continue;
}
c.NoDelay = true;
NetworkStream s = c.GetStream();
s.ReadTimeout = 1800;
int dummy = s.ReadByte();
s.ReadTimeout = Timeout.Infinite;
if (dummy >= 0)
{
log("scrcpy forward is ready; received first-socket dummy byte=" + dummy.ToString(CultureInfo.InvariantCulture));
return c;
}
last = new IOException("scrcpy video socket closed before dummy byte.");
}
catch (Exception ex)
{
last = ex;
}
try { c.Close(); } catch { }
Thread.Sleep(160);
}
throw new Exception("Could not establish ready scrcpy video socket (dummy byte was not received).", last);
}
private TcpClient ConnectWithRetry(int port, int timeoutMs)
{
Stopwatch sw = Stopwatch.StartNew();
Exception last = null;
while (sw.ElapsedMilliseconds < timeoutMs)
{
var c = new TcpClient();
try
{
var task = c.ConnectAsync(IPAddress.Loopback, port);
if (task.Wait(1200) && c.Connected) return c;
}
catch (Exception ex) { last = ex; }
try { c.Close(); } catch { }
Thread.Sleep(120);
}
throw new Exception("Could not connect to scrcpy forwarded socket.", last);
}
private static string RunProcess(string file, string args, int timeoutMs)
{
var psi = new ProcessStartInfo();
psi.FileName = file;
psi.Arguments = args;
psi.UseShellExecute = false;
psi.CreateNoWindow = true;
psi.RedirectStandardOutput = true;
psi.RedirectStandardError = true;
using (var p = new Process())
{
p.StartInfo = psi;
p.Start();
string stdout = p.StandardOutput.ReadToEnd();
string stderr = p.StandardError.ReadToEnd();
if (!p.WaitForExit(timeoutMs))
{
try { p.Kill(); } catch { }
throw new TimeoutException(Path.GetFileName(file) + " timed out.");
}
if (p.ExitCode != 0)
throw new Exception(Path.GetFileName(file) + " exited " + p.ExitCode + ": " + stderr.Trim());
return stdout;
}
}
private static string Q(string s)
{
if (String.IsNullOrEmpty(s)) return "\"\"";
return "\"" + s.Replace("\"", "\\\"") + "\"";
}
private static void W16(byte[] b, int o, ushort v)
{
b[o] = (byte)(v >> 8);
b[o + 1] = (byte)v;
}
private static void W32(byte[] b, int o, uint v)
{
b[o] = (byte)(v >> 24);
b[o + 1] = (byte)(v >> 16);
b[o + 2] = (byte)(v >> 8);
b[o + 3] = (byte)v;
}
private static void W64(byte[] b, int o, ulong v)
{
for (int i = 7; i >= 0; i--)
{
b[o + (7 - i)] = (byte)(v >> (i * 8));
}
}
public void Dispose()
{
Stop();
}
}
public static class BridgeRuntime
{
private static BridgeConfig cfg;
private static string webRoot;
private static string logPath;
private static HttpListener listener;
private static readonly object sessionGate = new object();
private static ScrcpySession session;
private static WebSocket activeVideoSocket;
private static volatile bool stopping;
public static void Run(string configPath, string websiteRoot, string runtimeLogPath)
{
cfg = BridgeConfig.Load(configPath);
webRoot = websiteRoot;
logPath = runtimeLogPath;
stopping = false;
listener = new HttpListener();
listener.Prefixes.Add("http://127.0.0.1:" + cfg.HttpPort + "/");
listener.Start();
Log("Private scrcpy bridge listening on http://127.0.0.1:" + cfg.HttpPort + "/");
try
{
while (!stopping && listener.IsListening)
{
HttpListenerContext ctx;
try { ctx = listener.GetContext(); }
catch { break; }
Task.Run(async delegate { await HandleContext(ctx); });
}
}
finally
{
ShutdownCore();
}
}
private static async Task HandleContext(HttpListenerContext ctx)
{
try
{
string path = ctx.Request.Url.AbsolutePath.ToLowerInvariant();
if (path == "/" || path == "/index.html")
{
ServeFile(ctx, Path.Combine(webRoot, "index.html"), "text/html; charset=utf-8");
return;
}
if (path == "/manifest.webmanifest")
{
ServeFile(ctx, Path.Combine(webRoot, "manifest.webmanifest"), "application/manifest+json; charset=utf-8");
return;
}
if (path == "/api/health")
{
if (!Authorized(ctx.Request))
{
Reply(ctx, 401, "{\"ok\":false,\"error\":\"unauthorized\"}", "application/json; charset=utf-8");
return;
}
bool started = false;
string serial = "";
lock (sessionGate)
{
started = session != null && session.IsStarted;
if (session != null) serial = session.Serial;
}
string body = "{\"ok\":true,\"streaming\":" + (started ? "true" : "false") +
",\"serial\":\"" + JsonEscape(serial) + "\"}";
Reply(ctx, 200, body, "application/json; charset=utf-8");
return;
}
if (path == "/api/diag")
{
if (!Authorized(ctx.Request))
{
Reply(ctx, 401, "unauthorized", "text/plain; charset=utf-8");
return;
}
string diag = "";
try
{
if (File.Exists(logPath))
{
string all = File.ReadAllText(logPath, Encoding.UTF8);
if (all.Length > 12000) all = all.Substring(all.Length - 12000);
diag = all;
}
}
catch (Exception ex)
{
diag = "Could not read runtime log: " + ex.Message;
}
Reply(ctx, 200, diag, "text/plain; charset=utf-8");
return;
}
if (path == "/api/shutdown")
{
if (!Authorized(ctx.Request))
{
Reply(ctx, 401, "{\"ok\":false}", "application/json; charset=utf-8");
return;
}
Reply(ctx, 200, "{\"ok\":true}", "application/json; charset=utf-8");
Shutdown();
return;
}
if (path == "/ws/video" && ctx.Request.IsWebSocketRequest)
{
if (!Authorized(ctx.Request))
{
ctx.Response.StatusCode = 401;
ctx.Response.Close();
return;
}
var wsctx = await ctx.AcceptWebSocketAsync(null);
await HandleVideoSocket(wsctx.WebSocket);
return;
}
if (path == "/ws/control" && ctx.Request.IsWebSocketRequest)
{
if (!Authorized(ctx.Request))
{
ctx.Response.StatusCode = 401;
ctx.Response.Close();
return;
}
var wsctx = await ctx.AcceptWebSocketAsync(null);
await HandleControlSocket(wsctx.WebSocket);
return;
}
Reply(ctx, 404, "Not found", "text/plain; charset=utf-8");
}
catch (Exception ex)
{
Log("request error: " + ex);
try { Reply(ctx, 500, "Internal error", "text/plain; charset=utf-8"); } catch { }
}
}
private static async Task HandleVideoSocket(WebSocket ws)
{
WebSocket old = null;
lock (sessionGate)
{
old = activeVideoSocket;
activeVideoSocket = ws;
if (session != null)
{
try { session.Dispose(); } catch { }
session = null;
}
session = new ScrcpySession(cfg, Log);
}
if (old != null && old.State == WebSocketState.Open)
{
try { await old.CloseAsync(WebSocketCloseStatus.NormalClosure, "Replaced", CancellationToken.None); } catch { }
}
try
{
ScrcpySession local;
lock (sessionGate) { local = session; }
local.Start();
NetworkStream stream = local.VideoStream;
byte[] codecBytes = new byte[4];
if (!await ReadExactlyAsync(stream, codecBytes, 0, 4))
throw new IOException("Video socket ended before codec metadata.");
string codec = Encoding.ASCII.GetString(codecBytes);
Log("scrcpy video codec metadata: " + codec);
await SendTextAsync(ws, "CODEC|" + codec);
byte[] header = new byte[12];
bool firstPayloadLogged = false;
while (!stopping && ws.State == WebSocketState.Open)
{
if (!await ReadExactlyAsync(stream, header, 0, 12))
break;
bool isSessionPacket = (header[0] & 0x80) != 0;
if (isSessionPacket)
{
uint width = ReadU32BE(header, 4);
uint height = ReadU32BE(header, 8);
Log("scrcpy video session: " + width.ToString(CultureInfo.InvariantCulture) + "x" + height.ToString(CultureInfo.InvariantCulture));
await SendTextAsync(ws, "SESSION|" +
width.ToString(CultureInfo.InvariantCulture) + "|" +
height.ToString(CultureInfo.InvariantCulture));
continue;
}
bool isConfig = (header[0] & 0x40) != 0;
bool isKey = (header[0] & 0x20) != 0;
uint payloadSize32 = ReadU32BE(header, 8);
if (payloadSize32 == 0 || payloadSize32 > 16 * 1024 * 1024)
throw new IOException("Invalid scrcpy video payload size: " + payloadSize32.ToString(CultureInfo.InvariantCulture));
int payloadSize = (int)payloadSize32;
byte[] payload = new byte[payloadSize];
if (!await ReadExactlyAsync(stream, payload, 0, payloadSize))
throw new IOException("Video socket ended in the middle of a media packet.");
if (!firstPayloadLogged)
{
firstPayloadLogged = true;
Log("first H.264 payload: " + payloadSize.ToString(CultureInfo.InvariantCulture) +
" bytes, config=" + isConfig.ToString() + ", key=" + isKey.ToString());
}
byte[] framed = new byte[12 + payload.Length];
Buffer.BlockCopy(header, 0, framed, 0, 12);
Buffer.BlockCopy(payload, 0, framed, 12, payload.Length);
await ws.SendAsync(
new ArraySegment<byte>(framed, 0, framed.Length),
WebSocketMessageType.Binary,
true,
CancellationToken.None);
}
}
catch (Exception ex)
{
Log("video socket ended: " + ex.Message);
}
finally
{
lock (sessionGate)
{
if (activeVideoSocket == ws) activeVideoSocket = null;
if (session != null)
{
try { session.Dispose(); } catch { }
session = null;
}
}
try
{
if (ws.State == WebSocketState.Open || ws.State == WebSocketState.CloseReceived)
ws.Abort();
}
catch { }
try { ws.Dispose(); } catch { }
}
}
private static async Task<bool> ReadExactlyAsync(Stream stream, byte[] buffer, int offset, int count)
{
int done = 0;
while (done < count)
{
int n = await stream.ReadAsync(buffer, offset + done, count - done);
if (n <= 0) return false;
done += n;
}
return true;
}
private static uint ReadU32BE(byte[] b, int o)
{
return ((uint)b[o] << 24) |
((uint)b[o + 1] << 16) |
((uint)b[o + 2] << 8) |
(uint)b[o + 3];
}
private static async Task SendTextAsync(WebSocket ws, string text)
{
byte[] bytes = Encoding.UTF8.GetBytes(text);
await ws.SendAsync(
new ArraySegment<byte>(bytes, 0, bytes.Length),
WebSocketMessageType.Text,
true,
CancellationToken.None);
}
private static async Task HandleControlSocket(WebSocket ws)
{
byte[] buf = new byte[8192];
var ms = new MemoryStream();
try
{
while (!stopping && ws.State == WebSocketState.Open)
{
var res = await ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None);
if (res.MessageType == WebSocketMessageType.Close) break;
if (res.MessageType != WebSocketMessageType.Text) continue;
ms.Write(buf, 0, res.Count);
if (!res.EndOfMessage) continue;
string msg = Encoding.UTF8.GetString(ms.ToArray());
ms.SetLength(0);
try { HandleControlMessage(msg); }
catch (Exception ex) { Log("control message error: " + ex.Message); }
}
}
catch (Exception ex)
{
Log("control socket ended: " + ex.Message);
}
finally
{
try { ms.Dispose(); } catch { }
try
{
if (ws.State == WebSocketState.Open || ws.State == WebSocketState.CloseReceived)
ws.Abort();
}
catch { }
try { ws.Dispose(); } catch { }
}
}
private static void HandleControlMessage(string msg)
{
if (String.IsNullOrWhiteSpace(msg)) return;
string[] p = msg.Split('|');
if (p.Length == 0) return;
ScrcpySession s;
lock (sessionGate) { s = session; }
if (s == null || !s.IsStarted) return;
string type = p[0];
if (type == "touch" && p.Length >= 9)
{
byte action = byte.Parse(p[1], CultureInfo.InvariantCulture);
ulong pointer = unchecked((ulong)long.Parse(p[2], CultureInfo.InvariantCulture));
int x = int.Parse(p[3], CultureInfo.InvariantCulture);
int y = int.Parse(p[4], CultureInfo.InvariantCulture);
int w = int.Parse(p[5], CultureInfo.InvariantCulture);
int h = int.Parse(p[6], CultureInfo.InvariantCulture);
double pressure = double.Parse(p[7], CultureInfo.InvariantCulture);
s.SendTouch(action, pointer, x, y, w, h, pressure);
return;
}
if (type == "key" && p.Length >= 2)
{
int code = int.Parse(p[1], CultureInfo.InvariantCulture);
s.SendKey(code);
return;
}
if (type == "wake")
{
s.SendBackOrScreenOn();
return;
}
if (type == "rotate")
{
s.SendRotate();
return;
}
if (type == "resetvideo")
{
s.SendResetVideo();
Log("scrcpy video reset/keyframe requested");
return;
}
if (type == "paste" && p.Length >= 2)
{
byte[] data = Convert.FromBase64String(p[1]);
string text = Encoding.UTF8.GetString(data);
s.SendClipboardPaste(text);
return;
}
}
private static bool Authorized(HttpListenerRequest req)
{
string supplied = req.QueryString["pin"];
if (String.IsNullOrEmpty(supplied)) return false;
if (!String.IsNullOrEmpty(cfg.AccessPassword) && supplied == cfg.AccessPassword) return true;
if (!String.IsNullOrEmpty(cfg.BridgeKey) && supplied == cfg.BridgeKey) return true;
return !String.IsNullOrEmpty(cfg.Pin) && supplied == cfg.Pin;
}
private static void ServeFile(HttpListenerContext ctx, string path, string contentType)
{
if (!File.Exists(path))
{
Reply(ctx, 404, "Missing file", "text/plain; charset=utf-8");
return;
}
byte[] data = File.ReadAllBytes(path);
ctx.Response.StatusCode = 200;
ctx.Response.ContentType = contentType;
ctx.Response.Headers["Cache-Control"] = "no-store, max-age=0";
ctx.Response.ContentLength64 = data.Length;
ctx.Response.OutputStream.Write(data, 0, data.Length);
ctx.Response.OutputStream.Close();
}
private static void Reply(HttpListenerContext ctx, int status, string text, string contentType)
{
byte[] data = Encoding.UTF8.GetBytes(text ?? "");
ctx.Response.StatusCode = status;
ctx.Response.ContentType = contentType;
ctx.Response.Headers["Cache-Control"] = "no-store, max-age=0";
ctx.Response.ContentLength64 = data.Length;
ctx.Response.OutputStream.Write(data, 0, data.Length);
ctx.Response.OutputStream.Close();
}
public static void Shutdown()
{
if (stopping) return;
stopping = true;
try { if (listener != null && listener.IsListening) listener.Stop(); } catch { }
ShutdownCore();
}
private static void ShutdownCore()
{
lock (sessionGate)
{
if (session != null)
{
try { session.Dispose(); } catch { }
session = null;
}
if (activeVideoSocket != null)
{
try { activeVideoSocket.Dispose(); } catch { }
activeVideoSocket = null;
}
}
try { if (listener != null) listener.Close(); } catch { }
Log("bridge stopped");
}
private static string JsonEscape(string s)
{
if (s == null) return "";
return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
private static void Log(string text)
{
try
{
string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + text + Environment.NewLine;
File.AppendAllText(logPath, line, Encoding.UTF8);
}
catch { }
}
}
}
