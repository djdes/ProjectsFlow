using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;

namespace ProjectsFlowNotes
{
    public sealed class FileDto
    {
        public string Id;
        public string Filename;
        public string MimeType;
        public long Size;
        public bool IsImage => MimeType != null && MimeType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
    }

    public sealed class CommentDto
    {
        public string Id;
        public string Author;
        public bool IsAgent;
        public string Body;
        public DateTime CreatedAt;
        public List<FileDto> Files = new List<FileDto>();
    }

    public sealed class DetailDto
    {
        public NoteDto Note;
        public string Description;
        public string AssigneeName;
        public List<FileDto> Files = new List<FileDto>();
        public List<CommentDto> Comments = new List<CommentDto>();
    }

    public sealed class Recipient
    {
        public string UserId;
        public string Name;
    }

    // Развёрнутая заметка: подробности задачи, комментарии, файлы.
    public sealed partial class ApiClient
    {
        private static void EnsureOk(HttpResponseMessage res)
        {
            if (res.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedException();
            res.EnsureSuccessStatusCode();
        }

        private List<FileDto> Files(Dictionary<string, object> d, string key)
        {
            var list = new List<FileDto>();
            if (d.TryGetValue(key, out var raw) && raw is object[] items)
            {
                foreach (var f in items.OfType<Dictionary<string, object>>())
                {
                    list.Add(new FileDto
                    {
                        Id = Str(f, "id"),
                        Filename = Str(f, "filename") ?? "файл",
                        MimeType = Str(f, "mimeType") ?? "",
                        Size = long.TryParse(Str(f, "sizeBytes"), out var s) ? s : 0,
                    });
                }
            }
            return list;
        }

        public async Task<DetailDto> GetDetail(string taskId)
        {
            using (var res = await http.SendAsync(Request(HttpMethod.Get, "/api/desktop-notes/" + Uri.EscapeDataString(taskId) + "/detail")))
            {
                EnsureOk(res);
                var root = Parse(await res.Content.ReadAsStringAsync());
                var detail = new DetailDto
                {
                    Note = root.TryGetValue("note", out var n) && n is Dictionary<string, object> nd ? ParseNote(nd) : null,
                    Description = Str(root, "description") ?? "",
                    AssigneeName = Str(root, "assigneeName"),
                    Files = Files(root, "attachments"),
                };
                if (root.TryGetValue("comments", out var rc) && rc is object[] comments)
                {
                    foreach (var c in comments.OfType<Dictionary<string, object>>())
                    {
                        DateTime.TryParse(Str(c, "createdAt"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var at);
                        detail.Comments.Add(new CommentDto
                        {
                            Id = Str(c, "id"),
                            Author = Str(c, "author") ?? "",
                            IsAgent = c.TryGetValue("isAgent", out var ia) && ia is bool b && b,
                            Body = Str(c, "body") ?? "",
                            CreatedAt = at.ToLocalTime(),
                            Files = Files(c, "attachments"),
                        });
                    }
                }
                return detail;
            }
        }

        // Кого уведомит новый комментарий — как в интерфейсе: руководитель задачи по умолчанию.
        public async Task<List<Recipient>> DefaultRecipients(string projectId, string taskId)
        {
            var path = $"/api/projects/{Uri.EscapeDataString(projectId)}/tasks/{Uri.EscapeDataString(taskId)}/comment-notify-candidates";
            using (var res = await http.SendAsync(Request(HttpMethod.Get, path)))
            {
                EnsureOk(res);
                var root = Parse(await res.Content.ReadAsStringAsync());
                var list = new List<Recipient>();
                if (root.TryGetValue("candidates", out var raw) && raw is object[] items)
                {
                    foreach (var c in items.OfType<Dictionary<string, object>>())
                    {
                        if (c.TryGetValue("isDefault", out var d) && d is bool isDefault && isDefault)
                            list.Add(new Recipient { UserId = Str(c, "userId"), Name = Str(c, "displayName") ?? "" });
                    }
                }
                return list;
            }
        }

        public async Task PostComment(string projectId, string taskId, string body, List<Recipient> notify)
        {
            var path = $"/api/projects/{Uri.EscapeDataString(projectId)}/tasks/{Uri.EscapeDataString(taskId)}/comments";
            var audience = notify != null && notify.Count > 0
                ? new Dictionary<string, object> { { "mode", "selected" }, { "userIds", notify.Select(r => r.UserId).ToArray() } }
                : new Dictionary<string, object> { { "mode", "none" } };
            var payload = new Dictionary<string, object> { { "body", body }, { "notify", audience } };
            using (var res = await http.SendAsync(Request(HttpMethod.Post, path, payload)))
            {
                if (res.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedException();
                if (!res.IsSuccessStatusCode)
                {
                    var root = Parse(await res.Content.ReadAsStringAsync());
                    throw new InvalidOperationException(Str(root, "message") ?? "Комментарий не отправлен");
                }
            }
        }

        public async Task<byte[]> DownloadAttachment(string id)
        {
            using (var res = await http.SendAsync(Request(HttpMethod.Get, "/api/attachments/" + Uri.EscapeDataString(id))))
            {
                EnsureOk(res);
                return await res.Content.ReadAsByteArrayAsync();
            }
        }
    }
}
