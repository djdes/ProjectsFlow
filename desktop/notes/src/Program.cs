using System;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace ProjectsFlowNotes
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            // WPF на .NET Framework 4.8 масштабируется под каждый монитор только с этим переключателем.
            AppContext.SetSwitch("Switch.System.Windows.DoNotScaleForDpiChanges", false);
            bool Has(string flag) => args.Any(a => string.Equals(a, flag, StringComparison.OrdinalIgnoreCase));
            string After(string flag)
            {
                var i = Array.FindIndex(args, a => string.Equals(a, flag, StringComparison.OrdinalIgnoreCase));
                return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
            }

            try
            {
                if (After("--make-icon") is string icoPath)
                {
                    IconFactory.WriteIco(icoPath);
                    return 0;
                }
                if (After("--preview-detail") is string detailPng)
                {
                    RenderDetailPreview(detailPng);
                    return 0;
                }
                if (After("--preview") is string pngPath)
                {
                    RenderPreview(pngPath);
                    return 0;
                }
                if (Has("--uninstall"))
                {
                    SingleInstance.AskRunningToQuit();
                    var answer = MessageBox.Show("Удалить «ProjectsFlow Заметки» с этого компьютера?", "ProjectsFlow Заметки",
                        MessageBoxButton.YesNo, MessageBoxImage.Question);
                    if (answer == MessageBoxResult.Yes) Installer.Uninstall();
                    return 0;
                }

                Updater.CleanupOld();
                if (!Installer.EnsureInstalled()) return 0;

                var restarted = Has("--updated") || Has("--installed");
                if (!SingleInstance.TryAcquire(waitForPrevious: restarted))
                {
                    SingleInstance.SignalShow();
                    return 0;
                }

                var application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                application.DispatcherUnhandledException += (s, e) =>
                {
                    Log.Write("unhandled: " + e.Exception);
                    e.Handled = true;
                };
                AppDomain.CurrentDomain.UnhandledException += (s, e) => Log.Write("fatal: " + e.ExceptionObject);
                var app = new App(application);
                application.Startup += (s, e) => app.Start(welcome: Has("--installed"));
                application.Run();
                return 0;
            }
            catch (Exception e)
            {
                Log.Write("startup failed: " + e);
                MessageBox.Show("Не удалось запустить «ProjectsFlow Заметки»: " + e.Message, "ProjectsFlow Заметки",
                    MessageBoxButton.OK, MessageBoxImage.Error);
                return 1;
            }
        }

        private static void RenderDetailPreview(string path)
        {
            var note = new NoteDto
            {
                TaskId = "1", ProjectId = "p", ProjectName = "Wesetup", Title = "Исправить сохранение реквизитов клиента Wesetup",
                Status = "manual", StatusLabel = "В работе", Deadline = DateTime.Today.AddDays(5).ToString("yyyy-MM-dd"), CanEdit = true,
                StatusOptions = new System.Collections.Generic.List<System.Collections.Generic.KeyValuePair<string, string>> { new System.Collections.Generic.KeyValuePair<string, string>("manual", "В работе") },
            };
            var detail = new DetailDto
            {
                Note = note,
                AssigneeName = "Олег Боев",
                Description = @"Исправить сохранение реквизитов клиента Wesetup
Исправить сохранение реквизитов в клиенте Wesetup: введённые данные не сохраняются, **кнопка сохранения** ничего не делает.

## Что проверить
- ИНН и КПП
- Банковские реквизиты
- Подробнее: https://projectsflow.ru/docs",
                Files = { new FileDto { Id = "a", Filename = "Скриншот ошибки.png", MimeType = "image/png", Size = 120000 }, new FileDto { Id = "b", Filename = "реквизиты.pdf", MimeType = "application/pdf", Size = 340000 } },
                Comments =
                {
                    new CommentDto { Author = "Ярослав Боев", Body = "Проверь ещё форму на мобильном.", CreatedAt = DateTime.Now.AddHours(-3) },
                    new CommentDto { Author = "Ralph", IsAgent = true, Body = "Нашёл причину: запрос уходит без поля `kpp`.", CreatedAt = DateTime.Now.AddMinutes(-20) },
                },
            };
            var w = new DetailWindow(new ApiClient(), note, "yellow", (s, r) => { });
            var element = w.RenderSample(detail);
            element.Measure(new Size(480, 760));
            element.Arrange(new Rect(0, 0, 480, 760));
            element.UpdateLayout();
            const double scale = 2;
            var rtb = new RenderTargetBitmap((int)(480 * scale), (int)(760 * scale), 96 * scale, 96 * scale, PixelFormats.Pbgra32);
            rtb.Render(element);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(rtb));
            using (var fs = File.Create(path)) enc.Save(fs);
        }

        // Картинка с несколькими стикерами — проверить вид без запуска приложения.
        private static void RenderPreview(string path)
        {
            var samples = new[]
            {
                (new NoteDto { TaskId = "1", ProjectName = "Wesetup", Title = "Исправить сохранение реквизитов клиента Wesetup", Excerpt = "Исправить сохранение реквизитов в карточке клиента, сейчас сбрасывается ИНН", Status = "manual", StatusLabel = "В работе", Deadline = DateTime.Today.ToString("yyyy-MM-dd") }, "yellow"),
                (new NoteDto { TaskId = "2", ProjectName = "Личные", Title = "Обсудить выбор NVMe для сервера Dell", Excerpt = "", Status = "todo", StatusLabel = "Воркер", Deadline = DateTime.Today.AddDays(-2).ToString("yyyy-MM-dd") }, "pink"),
                (new NoteDto { TaskId = "3", ProjectName = "OrdersFlow", Title = "SEO: семантика и стратегия статей", Excerpt = "Провести SEO-анализ под Google: собрать семантику", Status = "done", StatusLabel = "Готово", Deadline = DateTime.Today.AddDays(1).ToString("yyyy-MM-dd") }, "green"),
                (new NoteDto { TaskId = "4", ProjectName = "DocsFlow", Title = "Протестировать бота DocsFlow", Excerpt = "", Status = "backlog", StatusLabel = "Черновики", Deadline = DateTime.Today.AddDays(1).ToString("yyyy-MM-dd") }, "blue"),
            };
            var options = new System.Collections.Generic.List<System.Collections.Generic.KeyValuePair<string, string>>
            {
                new System.Collections.Generic.KeyValuePair<string, string>("backlog", "Черновики"),
                new System.Collections.Generic.KeyValuePair<string, string>("manual", "В работе"),
                new System.Collections.Generic.KeyValuePair<string, string>("done", "Готово"),
            };
            foreach (var (n, _) in samples)
            {
                n.CanEdit = true;
                n.StatusOptions = options;
            }
            var row = new StackPanel { Orientation = Orientation.Horizontal, Background = new SolidColorBrush(Color.FromRgb(0x2B, 0x2D, 0x31)) };
            foreach (var (note, color) in samples)
            {
                var v = new NoteView(interactive: false) { Margin = new Thickness(16), VerticalAlignment = VerticalAlignment.Top };
                v.Render(note, color);
                if (note.TaskId == "1") v.ShowActions();
                if (note.TaskId == "4") v.Opacity = 0.6;
                row.Children.Add(v);
            }
            row.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            row.Arrange(new Rect(row.DesiredSize));
            row.UpdateLayout();
            const double scale = 2;
            var rtb = new RenderTargetBitmap((int)(row.ActualWidth * scale), (int)(row.ActualHeight * scale), 96 * scale, 96 * scale, PixelFormats.Pbgra32);
            rtb.Render(row);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(rtb));
            using (var fs = File.Create(path)) enc.Save(fs);
        }
    }
}
