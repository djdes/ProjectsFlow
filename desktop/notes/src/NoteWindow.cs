using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;

namespace ProjectsFlowNotes
{
    // Бумага стикеров. Подложка и «шапка» чуть темнее — как у настоящего листка.
    internal static class Paper
    {
        public static readonly (string Key, string Name, Color Body, Color Head)[] All =
        {
            ("yellow", "Жёлтая", Rgb(0xFF, 0xF2, 0xA8), Rgb(0xF6, 0xE3, 0x86)),
            ("pink", "Розовая", Rgb(0xFF, 0xD9, 0xE2), Rgb(0xF7, 0xC3, 0xD1)),
            ("green", "Зелёная", Rgb(0xD8, 0xF3, 0xD2), Rgb(0xC0, 0xE8, 0xB8)),
            ("blue", "Голубая", Rgb(0xD6, 0xEA, 0xFF), Rgb(0xBD, 0xDB, 0xFA)),
            ("lilac", "Сиреневая", Rgb(0xE9, 0xDF, 0xFF), Rgb(0xD9, 0xCB, 0xFA)),
        };

        public static (Color Body, Color Head) Get(string key)
        {
            foreach (var p in All) if (p.Key == key) return (p.Body, p.Head);
            return (All[0].Body, All[0].Head);
        }

        public static readonly Color Ink = Rgb(0x3A, 0x32, 0x1E);
        public static readonly Color Overdue = Rgb(0xB4, 0x23, 0x18);

        private static Color Rgb(byte r, byte g, byte b) => Color.FromRgb(r, g, b);
    }

    // Один стикер: окно без рамки поверх всех окон, не видно в панели задач и в Alt+Tab.
    internal sealed class NoteWindow : Window
    {
        public const double PaperWidth = 216;
        public const double Margin_ = 12; // место под тень

        public string TaskId { get; }
        public NoteDto Note { get; private set; }
        public string ColorKey { get; private set; }

        public event Action<NoteWindow> UnpinRequested;
        public event Action<NoteWindow> Moved;
        public event Action<NoteWindow> ColorChanged;

        private readonly NoteView view;

        public NoteWindow(NoteDto note, string colorKey)
        {
            TaskId = note.TaskId;
            Note = note;
            ColorKey = colorKey ?? "yellow";

            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = false;
            ShowActivated = false;
            Topmost = true;
            SizeToContent = SizeToContent.Height;
            Width = PaperWidth + Margin_ * 2;
            Title = "ProjectsFlow — " + note.Title;
            WindowStartupLocation = WindowStartupLocation.Manual;

            view = new NoteView(interactive: true);
            view.Render(note, ColorKey);
            view.OpenClicked += OpenInBrowser;
            view.UnpinClicked += () => UnpinRequested?.Invoke(this);
            view.Margin = new Thickness(Margin_);
            Content = view;

            view.MouseLeftButtonDown += (s, e) =>
            {
                if (e.ClickCount == 2)
                {
                    OpenInBrowser();
                    return;
                }
                try { DragMove(); } catch (InvalidOperationException) { }
                Moved?.Invoke(this);
            };
            ContextMenu = BuildMenu();
            SourceInitialized += (s, e) => HideFromAltTab();
        }

        public void Update(NoteDto note)
        {
            if (note.SameAs(Note)) return;
            Note = note;
            Title = "ProjectsFlow — " + note.Title;
            view.Render(note, ColorKey);
            ContextMenu = BuildMenu();
        }

        private void SetColor(string key)
        {
            ColorKey = key;
            view.Render(Note, key);
            ContextMenu = BuildMenu();
            ColorChanged?.Invoke(this);
        }

        public void OpenInBrowser() => App.OpenUrl(ApiClient.BaseUrl + Note.Path);

        private ContextMenu BuildMenu()
        {
            var menu = new ContextMenu();
            var open = new MenuItem { Header = "Открыть задачу" };
            open.Click += (s, e) => OpenInBrowser();
            menu.Items.Add(open);
            var color = new MenuItem { Header = "Цвет" };
            foreach (var p in Paper.All)
            {
                var item = new MenuItem
                {
                    Header = p.Name,
                    IsCheckable = true,
                    IsChecked = p.Key == ColorKey,
                    Icon = new Border { Width = 12, Height = 12, CornerRadius = new CornerRadius(2), Background = new SolidColorBrush(p.Body), BorderBrush = new SolidColorBrush(p.Head), BorderThickness = new Thickness(1) },
                };
                var key = p.Key;
                item.Click += (s, e) => SetColor(key);
                color.Items.Add(item);
            }
            menu.Items.Add(color);
            menu.Items.Add(new Separator());
            var unpin = new MenuItem { Header = "Убрать с экрана" };
            unpin.Click += (s, e) => UnpinRequested?.Invoke(this);
            menu.Items.Add(unpin);
            return menu;
        }

        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TOOLWINDOW = 0x80;
        private const int WS_EX_APPWINDOW = 0x40000;

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")] private static extern IntPtr GetWindowLongPtr64(IntPtr h, int i);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")] private static extern IntPtr SetWindowLongPtr64(IntPtr h, int i, IntPtr v);
        [DllImport("user32.dll", EntryPoint = "GetWindowLong")] private static extern int GetWindowLong32(IntPtr h, int i);
        [DllImport("user32.dll", EntryPoint = "SetWindowLong")] private static extern int SetWindowLong32(IntPtr h, int i, int v);

        private void HideFromAltTab()
        {
            var h = new WindowInteropHelper(this).Handle;
            if (IntPtr.Size == 8)
            {
                var style = GetWindowLongPtr64(h, GWL_EXSTYLE).ToInt64();
                SetWindowLongPtr64(h, GWL_EXSTYLE, new IntPtr((style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW));
            }
            else
            {
                var style = GetWindowLong32(h, GWL_EXSTYLE);
                SetWindowLong32(h, GWL_EXSTYLE, (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
            }
        }
    }

    // Содержимое стикера. Отдельно от окна — чтобы этот же вид рисовать в картинку (--preview).
    internal sealed class NoteView : Border
    {
        public event Action OpenClicked;
        public event Action UnpinClicked;

        private static readonly CultureInfo Ru = new CultureInfo("ru-RU");
        private static readonly FontFamily Text = new FontFamily("Segoe UI");
        private static readonly FontFamily Icons = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets");

        private readonly bool interactive;
        private readonly Border head = new Border();
        private readonly TextBlock project = new TextBlock();
        private readonly TextBlock title = new TextBlock();
        private readonly TextBlock excerpt = new TextBlock();
        private readonly TextBlock deadline = new TextBlock();
        private readonly TextBlock status = new TextBlock();
        private readonly StackPanel actions = new StackPanel { Orientation = Orientation.Horizontal };

        public NoteView(bool interactive)
        {
            this.interactive = interactive;
            Width = NoteWindow.PaperWidth;
            CornerRadius = new CornerRadius(3);
            Effect = new DropShadowEffect { BlurRadius = 14, ShadowDepth = 3, Direction = 270, Opacity = 0.28, Color = Colors.Black };
            Cursor = Cursors.SizeAll;

            var ink = new SolidColorBrush(Paper.Ink);
            foreach (var t in new[] { project, title, excerpt, deadline, status })
            {
                t.FontFamily = Text;
                t.Foreground = ink;
                t.TextWrapping = TextWrapping.Wrap;
                t.TextTrimming = TextTrimming.CharacterEllipsis;
                t.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
            }
            project.FontSize = 11; project.LineHeight = 15; project.Opacity = 0.7;
            project.TextWrapping = TextWrapping.NoWrap; project.VerticalAlignment = VerticalAlignment.Center;
            title.FontSize = 13.5; title.LineHeight = 18; title.FontWeight = FontWeights.SemiBold; title.MaxHeight = 18 * 4;
            excerpt.FontSize = 11.5; excerpt.LineHeight = 15; excerpt.Opacity = 0.72; excerpt.MaxHeight = 15 * 3; excerpt.Margin = new Thickness(0, 4, 0, 0);
            deadline.FontSize = 11; deadline.LineHeight = 15; deadline.TextWrapping = TextWrapping.NoWrap;
            status.FontSize = 11; status.LineHeight = 15; status.Opacity = 0.7; status.TextWrapping = TextWrapping.NoWrap;
            status.HorizontalAlignment = HorizontalAlignment.Right;

            actions.Children.Add(IconButton("", "Открыть задачу", () => OpenClicked?.Invoke()));
            actions.Children.Add(IconButton("", "Убрать с экрана", () => UnpinClicked?.Invoke()));
            actions.Opacity = interactive ? 0 : 0;
            actions.VerticalAlignment = VerticalAlignment.Center;

            var headGrid = new Grid();
            headGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            headGrid.Children.Add(project);
            Grid.SetColumn(actions, 1);
            headGrid.Children.Add(actions);
            head.Child = headGrid;
            head.Padding = new Thickness(10, 4, 4, 4);
            head.MinHeight = 26;
            head.CornerRadius = new CornerRadius(3, 3, 0, 0);

            var foot = new Grid { Margin = new Thickness(0, 8, 0, 0) };
            foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            foot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            foot.Children.Add(deadline);
            Grid.SetColumn(status, 1);
            foot.Children.Add(status);

            var body = new StackPanel { Margin = new Thickness(10, 8, 10, 10) };
            body.Children.Add(title);
            body.Children.Add(excerpt);
            body.Children.Add(foot);

            var root = new DockPanel { LastChildFill = true };
            DockPanel.SetDock(head, Dock.Top);
            root.Children.Add(head);
            root.Children.Add(body);
            Child = root;

            if (interactive)
            {
                MouseEnter += (s, e) => actions.Opacity = 1;
                MouseLeave += (s, e) => actions.Opacity = 0;
            }
        }

        public void Render(NoteDto note, string colorKey)
        {
            var (bodyColor, headColor) = Paper.Get(colorKey);
            Background = new SolidColorBrush(bodyColor);
            head.Background = new SolidColorBrush(headColor);

            project.Text = note.ProjectName;
            title.Text = note.Title;
            var done = note.Status == "done";
            title.TextDecorations = done ? TextDecorations.Strikethrough : null;
            title.Opacity = done ? 0.6 : 1;
            excerpt.Text = note.Excerpt;
            excerpt.Visibility = string.IsNullOrWhiteSpace(note.Excerpt) ? Visibility.Collapsed : Visibility.Visible;

            var (label, overdue) = DeadlineLabel(note.Deadline, done);
            deadline.Text = label;
            deadline.Visibility = label.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
            deadline.Foreground = new SolidColorBrush(overdue ? Paper.Overdue : Paper.Ink);
            deadline.FontWeight = overdue ? FontWeights.SemiBold : FontWeights.Normal;
            status.Text = done ? "✓ Готово" : note.StatusLabel;
            status.Margin = new Thickness(label.Length > 0 ? 8 : 0, 0, 0, 0);
        }

        private static (string label, bool overdue) DeadlineLabel(string deadline, bool done)
        {
            if (string.IsNullOrEmpty(deadline) ||
                !DateTime.TryParseExact(deadline, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
                return ("", false);
            var days = (day.Date - DateTime.Today).Days;
            if (done) return (day.ToString("d MMMM", Ru), false);
            if (days < 0) return ("просрочено · " + day.ToString("d MMM", Ru).TrimEnd('.'), true);
            if (days == 0) return ("сегодня", false);
            if (days == 1) return ("завтра", false);
            return (day.ToString("d MMMM", Ru), false);
        }

        private Border IconButton(string glyph, string tip, Action onClick)
        {
            var hover = new SolidColorBrush(Color.FromArgb(0x22, 0, 0, 0));
            var b = new Border
            {
                Width = 22,
                Height = 22,
                CornerRadius = new CornerRadius(4),
                Background = Brushes.Transparent,
                Cursor = Cursors.Hand,
                ToolTip = tip,
                Child = new TextBlock
                {
                    Text = glyph,
                    FontFamily = Icons,
                    FontSize = 11,
                    Foreground = new SolidColorBrush(Paper.Ink),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                },
            };
            b.MouseEnter += (s, e) => b.Background = hover;
            b.MouseLeave += (s, e) => b.Background = Brushes.Transparent;
            // Клик по кнопке не должен начинать перетаскивание стикера.
            b.MouseLeftButtonDown += (s, e) => e.Handled = true;
            b.MouseLeftButtonUp += (s, e) =>
            {
                e.Handled = true;
                onClick();
            };
            return b;
        }
    }
}
