using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace ProjectsFlowNotes
{
    public sealed class NoteDto
    {
        public string TaskId;
        public string ProjectName;
        public string Title;
        public string Excerpt;
        public string Status;
        public string StatusLabel;
        public string Deadline; // YYYY-MM-DD или null
        public string Path;
        public bool CanEdit;
        public List<KeyValuePair<string, string>> StatusOptions = new List<KeyValuePair<string, string>>(); // status → подпись

        private string OptionsKey => string.Join(";", StatusOptions.Select(o => o.Key + "=" + o.Value));

        public bool SameAs(NoteDto other) =>
            other != null && TaskId == other.TaskId && ProjectName == other.ProjectName && Title == other.Title &&
            Excerpt == other.Excerpt && Status == other.Status && StatusLabel == other.StatusLabel &&
            Deadline == other.Deadline && Path == other.Path && CanEdit == other.CanEdit && OptionsKey == other.OptionsKey;
    }

    public sealed class DeviceStart
    {
        public string DeviceCode;
        public string UserCode;
        public string VerificationUrl;
        public int IntervalSec;
        public int ExpiresInSec;
    }

    public enum DevicePollState { Pending, Approved, Expired, Denied }

    public sealed class UnauthorizedException : Exception
    {
        public UnauthorizedException() : base("unauthorized") { }
    }

    // Всё общение с ProjectsFlow: заметки, подключение по коду, обновления.
    public sealed class ApiClient
    {
        public static readonly string BaseUrl =
            (Environment.GetEnvironmentVariable("PF_NOTES_URL") ?? "https://projectsflow.ru").TrimEnd('/');

        private readonly HttpClient http;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        public string Token { get; set; }

        public ApiClient()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            http = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("ProjectsFlowNotes/" + App.Version);
            http.DefaultRequestHeaders.Add("X-PF-Notes-Version", App.Version);
        }

        private HttpRequestMessage Request(HttpMethod method, string path, object body = null)
        {
            var req = new HttpRequestMessage(method, BaseUrl + path);
            if (!string.IsNullOrEmpty(Token)) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            if (body != null) req.Content = new StringContent(json.Serialize(body), Encoding.UTF8, "application/json");
            return req;
        }

        private Dictionary<string, object> Parse(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return new Dictionary<string, object>();
            return json.DeserializeObject(text) as Dictionary<string, object> ?? new Dictionary<string, object>();
        }

        private static string Str(Dictionary<string, object> d, string key) =>
            d.TryGetValue(key, out var v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : null;

        public async Task<List<NoteDto>> GetNotes()
        {
            using (var res = await http.SendAsync(Request(HttpMethod.Get, "/api/desktop-notes")))
            {
                if (res.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedException();
                res.EnsureSuccessStatusCode();
                var root = Parse(await res.Content.ReadAsStringAsync());
                var list = new List<NoteDto>();
                if (root.TryGetValue("notes", out var raw) && raw is object[] items)
                {
                    foreach (var item in items.OfType<Dictionary<string, object>>()) list.Add(ParseNote(item));
                }
                return list.Where(n => !string.IsNullOrEmpty(n.TaskId)).ToList();
            }
        }

        private NoteDto ParseNote(Dictionary<string, object> item)
        {
            var note = new NoteDto
            {
                TaskId = Str(item, "taskId"),
                ProjectName = Str(item, "projectName") ?? "",
                Title = Str(item, "title") ?? "Без названия",
                Excerpt = Str(item, "excerpt") ?? "",
                Status = Str(item, "status") ?? "",
                StatusLabel = Str(item, "statusLabel") ?? "",
                Deadline = Str(item, "deadline"),
                Path = Str(item, "path") ?? "/",
                CanEdit = item.TryGetValue("canEdit", out var ce) && ce is bool b && b,
            };
            if (item.TryGetValue("statusOptions", out var raw) && raw is object[] opts)
            {
                foreach (var o in opts.OfType<Dictionary<string, object>>())
                {
                    var status = Str(o, "status");
                    if (!string.IsNullOrEmpty(status)) note.StatusOptions.Add(new KeyValuePair<string, string>(status, Str(o, "label") ?? status));
                }
            }
            return note;
        }

        // Перенос задачи в другую колонку прямо со стикера. Возвращает обновлённую заметку.
        public async Task<NoteDto> SetStatus(string taskId, string status, bool restore)
        {
            var body = new Dictionary<string, object> { { "status", status }, { "restore", restore } };
            using (var res = await http.SendAsync(Request(HttpMethod.Post, "/api/desktop-notes/" + Uri.EscapeDataString(taskId) + "/status", body)))
            {
                if (res.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedException();
                var root = Parse(await res.Content.ReadAsStringAsync());
                if (!res.IsSuccessStatusCode) throw new InvalidOperationException(Str(root, "message") ?? "Не удалось сменить статус");
                return root.TryGetValue("note", out var n) && n is Dictionary<string, object> d ? ParseNote(d) : null;
            }
        }

        public async Task Unpin(string taskId)
        {
            using (var res = await http.SendAsync(Request(HttpMethod.Delete, "/api/desktop-notes/" + Uri.EscapeDataString(taskId))))
            {
                if (res.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedException();
                res.EnsureSuccessStatusCode();
            }
        }

        public async Task<DeviceStart> StartDevice()
        {
            using (var res = await http.SendAsync(Request(HttpMethod.Post, "/api/agent/device/authorize", new Dictionary<string, object>())))
            {
                res.EnsureSuccessStatusCode();
                var d = Parse(await res.Content.ReadAsStringAsync());
                var url = Str(d, "verificationUriComplete");
                var device = Uri.EscapeDataString(Environment.MachineName ?? "");
                return new DeviceStart
                {
                    DeviceCode = Str(d, "deviceCode"),
                    UserCode = Str(d, "userCode"),
                    VerificationUrl = url + (url.Contains("?") ? "&" : "?") + "client=notes&device=" + device,
                    IntervalSec = Math.Max(2, int.TryParse(Str(d, "interval"), out var i) ? i : 3),
                    ExpiresInSec = int.TryParse(Str(d, "expiresIn"), out var e) ? e : 600,
                };
            }
        }

        // Возвращает токен, когда человек нажал «Подключить», иначе — состояние ожидания.
        public async Task<(DevicePollState state, string token)> PollDevice(string deviceCode)
        {
            var body = new Dictionary<string, object> { { "deviceCode", deviceCode } };
            using (var res = await http.SendAsync(Request(HttpMethod.Post, "/api/agent/device/token", body)))
            {
                if (res.StatusCode == HttpStatusCode.Accepted) return (DevicePollState.Pending, null);
                if (res.StatusCode == HttpStatusCode.Forbidden) return (DevicePollState.Denied, null);
                if (res.StatusCode == HttpStatusCode.NotFound || (int)res.StatusCode == 410) return (DevicePollState.Expired, null);
                res.EnsureSuccessStatusCode();
                var token = Str(Parse(await res.Content.ReadAsStringAsync()), "accessToken");
                return string.IsNullOrEmpty(token) ? (DevicePollState.Pending, null) : (DevicePollState.Approved, token);
            }
        }

        public async Task<Version> LatestVersion()
        {
            var text = await http.GetStringAsync(BaseUrl + "/downloads/notes-version.txt?t=" + DateTime.UtcNow.Ticks);
            return Version.TryParse(text.Trim(), out var v) ? v : null;
        }

        public async Task Download(string path)
        {
            using (var res = await http.GetAsync(BaseUrl + "/downloads/ProjectsFlowNotes.exe?t=" + DateTime.UtcNow.Ticks, HttpCompletionOption.ResponseHeadersRead))
            {
                res.EnsureSuccessStatusCode();
                using (var src = await res.Content.ReadAsStreamAsync())
                using (var dst = File.Create(path))
                {
                    await src.CopyToAsync(dst);
                }
            }
        }
    }
}
