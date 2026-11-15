using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace ProjectsFlowNotes
{
    // Где приложение живёт на диске. Всё — в профиле пользователя: права администратора не нужны.
    internal static class AppPaths
    {
        private static readonly string LocalAppData =
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        public static readonly string InstallDir = Path.Combine(LocalAppData, "Programs", "ProjectsFlow Notes");
        public static readonly string InstalledExe = Path.Combine(InstallDir, "ProjectsFlowNotes.exe");
        public static readonly string DataDir = Path.Combine(LocalAppData, "ProjectsFlow", "Notes");
        public static readonly string TokenFile = Path.Combine(DataDir, "token.dat");
        public static readonly string SettingsFile = Path.Combine(DataDir, "settings.json");
        public static readonly string LogFile = Path.Combine(DataDir, "log.txt");

        public static string CurrentExe => System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName;

        public static bool SamePath(string a, string b) =>
            string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    internal static class Log
    {
        private static readonly object Gate = new object();

        public static void Write(string message)
        {
            try
            {
                lock (Gate)
                {
                    Directory.CreateDirectory(AppPaths.DataDir);
                    var info = new FileInfo(AppPaths.LogFile);
                    if (info.Exists && info.Length > 256 * 1024) info.Delete();
                    File.AppendAllText(AppPaths.LogFile, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{Environment.NewLine}", Encoding.UTF8);
                }
            }
            catch
            {
                // Журнал — подсказка для поддержки, приложение без него работает.
            }
        }
    }

    // Токен доступа к аккаунту. Зашифрован средствами Windows (DPAPI): прочитать его может
    // только этот пользователь на этом компьютере.
    internal static class TokenStore
    {
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("ProjectsFlowNotes.v1");

        public static string Load()
        {
            try
            {
                if (!File.Exists(AppPaths.TokenFile)) return null;
                var plain = ProtectedData.Unprotect(File.ReadAllBytes(AppPaths.TokenFile), Entropy, DataProtectionScope.CurrentUser);
                var token = Encoding.UTF8.GetString(plain).Trim();
                return token.Length > 0 ? token : null;
            }
            catch (Exception e)
            {
                Log.Write("token load failed: " + e.Message);
                return null;
            }
        }

        public static void Save(string token)
        {
            Directory.CreateDirectory(AppPaths.DataDir);
            var data = ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(AppPaths.TokenFile, data);
        }

        public static void Clear()
        {
            try { if (File.Exists(AppPaths.TokenFile)) File.Delete(AppPaths.TokenFile); }
            catch (Exception e) { Log.Write("token clear failed: " + e.Message); }
        }
    }

    public sealed class NotePlacement
    {
        public double X { get; set; }
        public double Y { get; set; }
        public string Color { get; set; }
    }

    public sealed class AppSettings
    {
        public Dictionary<string, NotePlacement> Notes { get; set; } = new Dictionary<string, NotePlacement>();
        public bool Hidden { get; set; }
        public bool Autostart { get; set; } = true;
        public bool HintShown { get; set; }

        public static AppSettings Load()
        {
            try
            {
                if (File.Exists(AppPaths.SettingsFile))
                {
                    var loaded = new JavaScriptSerializer().Deserialize<AppSettings>(File.ReadAllText(AppPaths.SettingsFile, Encoding.UTF8));
                    if (loaded != null)
                    {
                        if (loaded.Notes == null) loaded.Notes = new Dictionary<string, NotePlacement>();
                        return loaded;
                    }
                }
            }
            catch (Exception e)
            {
                Log.Write("settings load failed: " + e.Message);
            }
            return new AppSettings();
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(AppPaths.DataDir);
                var tmp = AppPaths.SettingsFile + ".tmp";
                File.WriteAllText(tmp, new JavaScriptSerializer().Serialize(this), Encoding.UTF8);
                if (File.Exists(AppPaths.SettingsFile)) File.Replace(tmp, AppPaths.SettingsFile, null);
                else File.Move(tmp, AppPaths.SettingsFile);
            }
            catch (Exception e)
            {
                Log.Write("settings save failed: " + e.Message);
            }
        }
    }
}
