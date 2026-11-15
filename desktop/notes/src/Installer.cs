using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Microsoft.Win32;

namespace ProjectsFlowNotes
{
    // «Установка» — это копия exe в профиле пользователя, автозапуск, ярлык в меню «Пуск»
    // и строка в «Приложениях» Windows (чтобы удалить можно было и оттуда). Без мастера,
    // без прав администратора: человек просто запускает скачанный файл.
    internal static class Installer
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ProjectsFlowNotes";
        private const string RunValue = "ProjectsFlowNotes";

        private static string Shortcut => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs), "ProjectsFlow Заметки.lnk");

        public static bool RunningInstalled => AppPaths.SamePath(AppPaths.CurrentExe, AppPaths.InstalledExe);

        // false — копия установлена и запущена отдельным процессом, этот процесс должен выйти.
        public static bool EnsureInstalled()
        {
            if (RunningInstalled) return true;
            try
            {
                SingleInstance.AskRunningToQuit();
                Directory.CreateDirectory(AppPaths.InstallDir);
                CopyWithRetry(AppPaths.CurrentExe, AppPaths.InstalledExe);
                Process.Start(new ProcessStartInfo(AppPaths.InstalledExe, "--installed") { UseShellExecute = false });
                return false;
            }
            catch (Exception e)
            {
                // Не получилось скопировать (антивирус, нет места) — работаем из текущего места.
                Log.Write("install failed, running in place: " + e.Message);
                return true;
            }
        }

        private static void CopyWithRetry(string from, string to)
        {
            for (var i = 0; ; i++)
            {
                try
                {
                    File.Copy(from, to, overwrite: true);
                    return;
                }
                catch (IOException) when (i < 10)
                {
                    Thread.Sleep(500);
                }
            }
        }

        public static void RegisterIntegration(bool autostart)
        {
            if (!RunningInstalled) return;
            SetAutostart(autostart);
            try
            {
                using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
                {
                    key.SetValue("DisplayName", "ProjectsFlow Заметки");
                    key.SetValue("DisplayVersion", App.Version);
                    key.SetValue("Publisher", "ProjectsFlow");
                    key.SetValue("DisplayIcon", AppPaths.InstalledExe + ",0");
                    key.SetValue("InstallLocation", AppPaths.InstallDir);
                    key.SetValue("UninstallString", $"\"{AppPaths.InstalledExe}\" --uninstall");
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    key.SetValue("EstimatedSize", 200, RegistryValueKind.DWord);
                }
            }
            catch (Exception e) { Log.Write("uninstall entry failed: " + e.Message); }
            try
            {
                if (!File.Exists(Shortcut))
                {
                    var shellType = Type.GetTypeFromProgID("WScript.Shell");
                    dynamic shell = Activator.CreateInstance(shellType);
                    dynamic link = shell.CreateShortcut(Shortcut);
                    link.TargetPath = AppPaths.InstalledExe;
                    link.WorkingDirectory = AppPaths.InstallDir;
                    link.Description = "Задачи ProjectsFlow стикерами поверх окон";
                    link.IconLocation = AppPaths.InstalledExe + ",0";
                    link.Save();
                }
            }
            catch (Exception e) { Log.Write("shortcut failed: " + e.Message); }
        }

        public static void SetAutostart(bool enabled)
        {
            try
            {
                using (var key = Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (enabled) key.SetValue(RunValue, $"\"{AppPaths.CurrentExe}\" --autostart");
                    else if (key.GetValue(RunValue) != null) key.DeleteValue(RunValue);
                }
            }
            catch (Exception e) { Log.Write("autostart failed: " + e.Message); }
        }

        // Полное удаление: автозапуск, ярлык, запись в «Приложениях», токен и настройки, сам exe.
        public static void Uninstall()
        {
            SetAutostart(false);
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, throwOnMissingSubKey: false); } catch (Exception e) { Log.Write("uninstall key: " + e.Message); }
            try { if (File.Exists(Shortcut)) File.Delete(Shortcut); } catch (Exception e) { Log.Write("shortcut delete: " + e.Message); }
            try { if (Directory.Exists(AppPaths.DataDir)) Directory.Delete(AppPaths.DataDir, recursive: true); } catch { }
            try
            {
                // Свой exe, пока он запущен, удалить нельзя — это сделает cmd через пару секунд.
                Process.Start(new ProcessStartInfo("cmd.exe", $"/c ping 127.0.0.1 -n 3 > nul & rmdir /s /q \"{AppPaths.InstallDir}\"")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden,
                });
            }
            catch (Exception e) { Log.Write("dir delete: " + e.Message); }
        }
    }

    // Одна копия на пользователя. Вторая (повторный запуск) просит первую показать заметки;
    // установщик и обновление просят её закрыться.
    internal static class SingleInstance
    {
        private const string MutexName = @"Local\ProjectsFlowNotes";
        private const string ShowEventName = @"Local\ProjectsFlowNotes.Show";
        private const string QuitEventName = @"Local\ProjectsFlowNotes.Quit";

        private static Mutex mutex;
        public static EventWaitHandle ShowEvent { get; private set; }
        public static EventWaitHandle QuitEvent { get; private set; }

        public static bool TryAcquire(bool waitForPrevious)
        {
            mutex = new Mutex(false, MutexName);
            bool owned;
            try { owned = mutex.WaitOne(waitForPrevious ? 15000 : 0); }
            catch (AbandonedMutexException) { owned = true; }
            if (!owned) return false;
            ShowEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
            QuitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEventName);
            return true;
        }

        public static void Release()
        {
            try { mutex?.ReleaseMutex(); } catch { }
            mutex?.Dispose();
            mutex = null;
        }

        public static void SignalShow()
        {
            try { using (var e = EventWaitHandle.OpenExisting(ShowEventName)) e.Set(); } catch { }
        }

        public static void AskRunningToQuit()
        {
            try { using (var e = EventWaitHandle.OpenExisting(QuitEventName)) e.Set(); }
            catch { return; }
            // Ждём, пока запущенная копия освободит мьютекс (и файл exe).
            using (var m = new Mutex(false, MutexName))
            {
                try
                {
                    if (m.WaitOne(10000)) m.ReleaseMutex();
                }
                catch (AbandonedMutexException) { }
            }
        }
    }
}
