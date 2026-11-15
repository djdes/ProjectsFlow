using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace ProjectsFlowNotes
{
    // Сердце приложения: значок в трее, опрос сервера, окна-стикеры, обновления.
    internal sealed class App
    {
        public static readonly string Version = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);

        private const int PollSeconds = 8;
        private static readonly TimeSpan UpdateEvery = TimeSpan.FromHours(6);

        private readonly Application app;
        private readonly ApiClient api = new ApiClient();
        private readonly AppSettings settings = AppSettings.Load();
        private readonly Dictionary<string, NoteWindow> windows = new Dictionary<string, NoteWindow>();
        private readonly Dictionary<string, DetailWindow> details = new Dictionary<string, DetailWindow>();
        private readonly DispatcherTimer pollTimer;
        private readonly DispatcherTimer updateTimer;
        private Forms.NotifyIcon tray;
        private ConnectWindow connectWindow;
        private bool syncing;
        private bool online = true;
        private bool firstSyncAfterConnect;
        private bool quitting;

        public App(Application app)
        {
            this.app = app;
            pollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(PollSeconds) };
            pollTimer.Tick += async (s, e) => await Sync();
            updateTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
            updateTimer.Tick += async (s, e) =>
            {
                updateTimer.Interval = UpdateEvery;
                await Updater.CheckAndApply(api, this);
            };
        }

        public void Start(bool welcome)
        {
            Installer.RegisterIntegration(settings.Autostart);
            CreateTray();
            ListenForSignals();
            updateTimer.Start();

            api.Token = TokenStore.Load();
            if (api.Token == null)
            {
                ShowConnect();
                return;
            }
            if (welcome) Balloon("Заметки запущены", "Значок приложения — рядом с часами. Закреплённые задачи появятся поверх окон.");
            BeginSync();
        }

        private void BeginSync()
        {
            pollTimer.Start();
            _ = Sync();
        }

        // ——— Подключение аккаунта ———

        private void ShowConnect()
        {
            if (connectWindow != null)
            {
                connectWindow.Activate();
                return;
            }
            connectWindow = new ConnectWindow(api);
            connectWindow.Connected += token =>
            {
                TokenStore.Save(token);
                api.Token = token;
                firstSyncAfterConnect = true;
                BeginSync();
                RebuildMenu();
            };
            connectWindow.Closed += (s, e) =>
            {
                connectWindow = null;
                if (api.Token == null && !quitting)
                    Balloon("Аккаунт не подключён", "Нажмите на значок заметок рядом с часами → «Подключить аккаунт».");
            };
            connectWindow.Show();
            connectWindow.Activate();
        }

        private void SignOut(bool expired)
        {
            pollTimer.Stop();
            TokenStore.Clear();
            api.Token = null;
            foreach (var w in windows.Values.ToList()) w.Close();
            windows.Clear();
            foreach (var d in details.Values.ToList()) d.Close();
            RebuildMenu();
            if (expired) Balloon("Нужно подключиться заново", "Доступ к аккаунту отозван или истёк.");
            ShowConnect();
        }

        // ——— Синхронизация ———

        private async Task Sync()
        {
            if (syncing || api.Token == null) return;
            syncing = true;
            try
            {
                var notes = await api.GetNotes();
                online = true;
                Apply(notes);
                if (firstSyncAfterConnect)
                {
                    firstSyncAfterConnect = false;
                    if (notes.Count == 0 && !settings.HintShown)
                    {
                        settings.HintShown = true;
                        settings.Save();
                        Balloon("Заметки подключены", "Откройте задачу в ProjectsFlow и нажмите «На экран».");
                    }
                }
            }
            catch (UnauthorizedException)
            {
                SignOut(expired: true);
            }
            catch (Exception e)
            {
                if (online) Log.Write("sync failed: " + e.Message);
                online = false;
            }
            finally
            {
                syncing = false;
                UpdateTrayText();
            }
        }

        private void Apply(List<NoteDto> notes)
        {
            var alive = new HashSet<string>(notes.Select(n => n.TaskId));
            foreach (var gone in windows.Keys.Where(k => !alive.Contains(k)).ToList())
            {
                windows[gone].Close();
                windows.Remove(gone);
                settings.Notes.Remove(gone);
            }
            var changed = false;
            foreach (var note in notes)
            {
                if (windows.TryGetValue(note.TaskId, out var existing))
                {
                    existing.Update(note);
                    continue;
                }
                settings.Notes.TryGetValue(note.TaskId, out var placement);
                var w = new NoteWindow(note, placement?.Color, placement?.Opacity);
                w.UnpinRequested += OnUnpin;
                w.Moved += win => Remember(win);
                w.LookChanged += win =>
                {
                    Remember(win);
                    if (details.TryGetValue(win.TaskId, out var d)) d.SetColor(win.ColorKey);
                };
                w.ApplyLookToAll += OnApplyLookToAll;
                w.StatusRequested += OnStatusRequested;
                w.ExpandRequested += OpenDetail;
                windows[note.TaskId] = w;
                Place(w, placement);
                if (!settings.Hidden) w.Show();
                Remember(w);
                changed = true;
            }
            if (changed || alive.Count != settings.Notes.Count) settings.Save();
            RebuildMenu();
        }

        private void Remember(NoteWindow w)
        {
            settings.Notes[w.TaskId] = new NotePlacement { X = w.Left, Y = w.Top, Color = w.ColorKey, Opacity = w.RestOpacity };
            settings.Save();
        }

        // Развёрнутая заметка — рядом со стикером (слева, если есть место), одна на задачу.
        private void OpenDetail(NoteWindow note)
        {
            if (details.TryGetValue(note.TaskId, out var existing))
            {
                if (existing.WindowState == WindowState.Minimized) existing.WindowState = WindowState.Normal;
                existing.Activate();
                return;
            }
            var d = new DetailWindow(api, note.Note, note.ColorKey, (status, restore) => OnStatusRequested(note, status, restore));
            var area = SystemParameters.WorkArea;
            var left = note.Left - d.Width + NoteWindow.Margin_;
            if (left < area.Left) left = Math.Min(note.Left + note.Width - NoteWindow.Margin_, area.Right - d.Width);
            d.Left = Math.Max(area.Left, left);
            d.Top = Math.Max(area.Top, Math.Min(note.Top, area.Bottom - d.Height));
            d.Closed += (s, e) => details.Remove(note.TaskId);
            details[note.TaskId] = d;
            d.Show();
            d.Activate();
        }

        private void OnApplyLookToAll(NoteWindow source)
        {
            foreach (var w in windows.Values)
            {
                if (w != source) w.SetLook(source.ColorKey, source.RestOpacity);
                settings.Notes[w.TaskId] = new NotePlacement { X = w.Left, Y = w.Top, Color = w.ColorKey, Opacity = w.RestOpacity };
            }
            settings.Save();
        }

        // Смена колонки со стикера: сразу показываем выбранное, сервер переносит задачу как на доске.
        private async void OnStatusRequested(NoteWindow w, string status, bool restore)
        {
            var label = w.Note.StatusOptions.FirstOrDefault(o => o.Key == status).Value ?? status;
            w.ShowPendingStatus(restore ? "Возвращаю" : label);
            try
            {
                var updated = await api.SetStatus(w.TaskId, status, restore);
                if (updated != null) w.Update(updated);
                else await Sync();
                if (details.TryGetValue(w.TaskId, out var d)) await d.Refresh();
            }
            catch (UnauthorizedException)
            {
                SignOut(expired: true);
            }
            catch (Exception e)
            {
                Log.Write("status failed: " + e.Message);
                Balloon("Статус не изменён", e is InvalidOperationException ? e.Message : "Нет связи с ProjectsFlow, попробуйте ещё раз.");
                w.ForceRender();
            }
        }

        // Новый стикер — в первую свободную ячейку колонки у правого края экрана.
        private void Place(NoteWindow w, NotePlacement saved)
        {
            var area = SystemParameters.WorkArea;
            if (saved != null && OnScreen(saved.X, saved.Y))
            {
                w.Left = saved.X;
                w.Top = saved.Y;
                return;
            }
            const double slotW = NoteWindow.PaperWidth + 8;
            const double slotH = 150;
            var perColumn = Math.Max(1, (int)((area.Height - 24) / slotH));
            for (var i = 0; i < 60; i++)
            {
                var col = i / perColumn;
                var row = i % perColumn;
                var x = area.Right - 16 - NoteWindow.Margin_ - (col + 1) * slotW;
                var y = area.Top + 16 + row * slotH;
                var taken = windows.Values.Any(o => o != w && o.IsVisible && Math.Abs(o.Left - x) < slotW * 0.8 && Math.Abs(o.Top - y) < slotH * 0.8)
                    || settings.Notes.Values.Any(p => Math.Abs(p.X - x) < slotW * 0.8 && Math.Abs(p.Y - y) < slotH * 0.8);
                if (!taken)
                {
                    w.Left = x;
                    w.Top = y;
                    return;
                }
            }
            w.Left = area.Right - 260;
            w.Top = area.Top + 16;
        }

        private static bool OnScreen(double x, double y) =>
            x > SystemParameters.VirtualScreenLeft - 100 && x < SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - 60 &&
            y > SystemParameters.VirtualScreenTop - 10 && y < SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - 40;

        private async void OnUnpin(NoteWindow w)
        {
            windows.Remove(w.TaskId);
            settings.Notes.Remove(w.TaskId);
            settings.Save();
            w.Close();
            RebuildMenu();
            try
            {
                await api.Unpin(w.TaskId);
            }
            catch (UnauthorizedException)
            {
                SignOut(expired: true);
            }
            catch (Exception e)
            {
                Log.Write("unpin failed: " + e.Message);
                Balloon("Не удалось убрать заметку", "Нет связи с ProjectsFlow — заметка вернётся, попробуйте ещё раз.");
                await Sync();
            }
        }

        private void SetHidden(bool hidden)
        {
            settings.Hidden = hidden;
            settings.Save();
            foreach (var w in windows.Values)
            {
                if (hidden) w.Hide();
                else
                {
                    w.Show();
                    w.Topmost = false;
                    w.Topmost = true;
                }
            }
            RebuildMenu();
        }

        // ——— Трей ———

        private void CreateTray()
        {
            tray = new Forms.NotifyIcon { Icon = IconFactory.TrayIcon(), Visible = true };
            tray.MouseClick += (s, e) =>
            {
                if (e.Button != Forms.MouseButtons.Left) return;
                if (api.Token == null) ShowConnect();
                else SetHidden(!settings.Hidden);
            };
            tray.BalloonTipClicked += (s, e) => { if (api.Token == null) ShowConnect(); };
            RebuildMenu();
            UpdateTrayText();
        }

        private string menuKey;

        // Меню пересобираем только когда что-то в нём поменялось: опрос идёт каждые несколько
        // секунд, а открытое меню не должно закрываться у человека под курсором.
        private void RebuildMenu()
        {
            if (tray == null) return;
            var key = $"{api.Token != null}|{windows.Count}|{settings.Hidden}|{settings.Autostart}";
            if (key == menuKey) return;
            menuKey = key;
            var menu = new Forms.ContextMenuStrip { ShowImageMargin = false, ShowCheckMargin = true };
            var connected = api.Token != null;
            if (connected)
            {
                menu.Items.Add(new Forms.ToolStripMenuItem(windows.Count == 0 ? "Заметок на экране нет" : $"Заметок на экране: {windows.Count}") { Enabled = false });
                menu.Items.Add(Item(settings.Hidden ? "Показать заметки" : "Скрыть заметки", () => SetHidden(!settings.Hidden)));
            }
            else
            {
                menu.Items.Add(Item("Подключить аккаунт…", ShowConnect));
            }
            menu.Items.Add(Item("Открыть ProjectsFlow", () => OpenUrl(ApiClient.BaseUrl + "/")));
            menu.Items.Add(new Forms.ToolStripSeparator());
            var autostart = Item("Запускать вместе с Windows", () =>
            {
                settings.Autostart = !settings.Autostart;
                settings.Save();
                Installer.SetAutostart(settings.Autostart);
                RebuildMenu();
            });
            autostart.Checked = settings.Autostart;
            menu.Items.Add(autostart);
            if (connected) menu.Items.Add(Item("Выйти из аккаунта", ConfirmSignOut));
            menu.Items.Add(Item("Удалить с компьютера…", ConfirmUninstall));
            menu.Items.Add(new Forms.ToolStripSeparator());
            menu.Items.Add(Item("Закрыть заметки", Quit));
            var old = tray.ContextMenuStrip;
            tray.ContextMenuStrip = menu;
            old?.Dispose();
        }

        private static Forms.ToolStripMenuItem Item(string text, Action onClick)
        {
            var item = new Forms.ToolStripMenuItem(text);
            item.Click += (s, e) => onClick();
            return item;
        }

        private void UpdateTrayText()
        {
            if (tray == null) return;
            var text = api.Token == null ? "ProjectsFlow Заметки — не подключено"
                : !online ? "ProjectsFlow Заметки — нет связи"
                : $"ProjectsFlow Заметки — на экране: {windows.Count}";
            tray.Text = text.Length > 63 ? text.Substring(0, 63) : text;
        }

        private void Balloon(string title, string text)
        {
            if (tray == null) return;
            tray.BalloonTipTitle = title;
            tray.BalloonTipText = text;
            tray.ShowBalloonTip(6000);
        }

        private void ConfirmSignOut()
        {
            var r = MessageBox.Show("Выйти из аккаунта на этом компьютере? Заметки исчезнут с экрана, в ProjectsFlow они останутся закреплёнными.",
                "ProjectsFlow Заметки", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (r == MessageBoxResult.Yes) SignOut(expired: false);
        }

        private void ConfirmUninstall()
        {
            var r = MessageBox.Show("Удалить «ProjectsFlow Заметки» с этого компьютера? Задачи в ProjectsFlow не пострадают.",
                "ProjectsFlow Заметки", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (r != MessageBoxResult.Yes) return;
            Installer.Uninstall();
            Quit();
        }

        // ——— Сигналы от других копий ———

        private void ListenForSignals()
        {
            var thread = new Thread(() =>
            {
                var handles = new WaitHandle[] { SingleInstance.ShowEvent, SingleInstance.QuitEvent };
                while (true)
                {
                    var i = WaitHandle.WaitAny(handles);
                    if (i == 0) app.Dispatcher.BeginInvoke(new Action(OnShowRequested));
                    else
                    {
                        app.Dispatcher.BeginInvoke(new Action(Quit));
                        return;
                    }
                }
            }) { IsBackground = true, Name = "signals" };
            thread.Start();
        }

        private void OnShowRequested()
        {
            if (api.Token == null)
            {
                ShowConnect();
                return;
            }
            if (settings.Hidden) SetHidden(false);
            Balloon("Заметки уже запущены", windows.Count == 0
                ? "Откройте задачу в ProjectsFlow и нажмите «На экран»."
                : "Значок приложения — рядом с часами.");
        }

        public void Quit()
        {
            if (quitting) return;
            quitting = true;
            pollTimer.Stop();
            updateTimer.Stop();
            if (tray != null)
            {
                tray.Visible = false;
                tray.Dispose();
            }
            foreach (var w in windows.Values.ToList()) w.Close();
            foreach (var d in details.Values.ToList()) d.Close();
            connectWindow?.Close();
            SingleInstance.Release();
            app.Shutdown();
        }

        public static void OpenUrl(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception e) { Log.Write("open url failed: " + e.Message); }
        }
    }

    internal static class Updater
    {
        // Новая версия скачивается рядом, старый exe переименовывается (запущенный файл
        // переименовать можно, удалить — нет), и приложение перезапускается уже новым.
        public static async Task CheckAndApply(ApiClient api, App app)
        {
            if (!Installer.RunningInstalled) return;
            try
            {
                var latest = await api.LatestVersion();
                if (latest == null || latest <= System.Version.Parse(App.Version)) return;
                var fresh = AppPaths.InstalledExe + ".new";
                await api.Download(fresh);
                var info = new FileInfo(fresh);
                using (var fs = File.OpenRead(fresh))
                {
                    if (info.Length < 30 * 1024 || fs.ReadByte() != 'M' || fs.ReadByte() != 'Z')
                        throw new InvalidDataException("downloaded file is not an exe");
                }
                var old = AppPaths.InstalledExe + ".old";
                if (File.Exists(old)) File.Delete(old);
                File.Move(AppPaths.InstalledExe, old);
                File.Move(fresh, AppPaths.InstalledExe);
                Log.Write($"updated {App.Version} -> {latest}");
                SingleInstance.Release();
                Process.Start(new ProcessStartInfo(AppPaths.InstalledExe, "--updated") { UseShellExecute = false });
                app.Quit();
            }
            catch (Exception e)
            {
                Log.Write("update failed: " + e.Message);
            }
        }

        public static void CleanupOld()
        {
            try
            {
                var old = AppPaths.InstalledExe + ".old";
                if (File.Exists(old)) File.Delete(old);
            }
            catch { }
        }
    }
}
