using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;

namespace ProjectsFlowNotes
{
    // Развёрнутая заметка: полный текст задачи, срок, ответственный, файлы и комментарии,
    // поле ответа. Та же бумага, что у стикера, только большая и с прокруткой.
    internal sealed class DetailWindow : Window
    {
        private static readonly CultureInfo Ru = new CultureInfo("ru-RU");
        private static readonly FontFamily Text = new FontFamily("Segoe UI");
        private static readonly FontFamily Icons = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets");

        private readonly ApiClient api;
        private readonly string taskId;
        private readonly Action<string, bool> changeStatus;
        private readonly Border paper = new Border();
        private readonly Border head = new Border();
        private readonly TextBlock project = new TextBlock();
        private readonly StackPanel content = new StackPanel { Margin = new Thickness(16, 12, 16, 12) };
        private readonly ScrollViewer scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        private readonly TextBox composer = new TextBox();
        private readonly TextBlock placeholder = new TextBlock();
        private readonly TextBlock recipientsLine = new TextBlock();
        private readonly Button send = new Button();
        private string colorKey;
        private DetailDto detail;
        private List<Recipient> recipients;
        private DateTime loadedAt;
        private bool loading;

        public DetailWindow(ApiClient api, NoteDto note, string colorKey, Action<string, bool> changeStatus)
        {
            this.api = api;
            taskId = note.TaskId;
            this.colorKey = colorKey;
            this.changeStatus = changeStatus;

            Title = note.Title;
            Icon = IconFactory.WpfIcon();
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.CanResizeWithGrip;
            Topmost = true;
            Width = 480;
            Height = 660;
            MinWidth = 340;
            MinHeight = 320;

            BuildLayout();
            ApplyColor();
            ShowLoading(note);
            Loaded += async (s, e) => await Reload(scrollToEnd: false);
            Activated += async (s, e) =>
            {
                if (detail != null && DateTime.Now - loadedAt > TimeSpan.FromSeconds(20)) await Reload(scrollToEnd: false);
            };
            KeyDown += (s, e) => { if (e.Key == Key.Escape) Close(); };
        }

        public void SetColor(string key)
        {
            colorKey = key;
            ApplyColor();
            if (detail != null) Render();
        }

        public Task Refresh() => Reload(scrollToEnd: false);

        // Картинка-превью (--preview-detail): показать готовые данные без сервера.
        internal FrameworkElement RenderSample(DetailDto sample)
        {
            detail = sample;
            Render();
            recipientsLine.Text = "Уведомим: Ярослав Боев";
            var element = paper;
            Content = null;
            return element;
        }

        private void ApplyColor()
        {
            var (body, headColor) = Paper.Get(colorKey);
            paper.Background = new SolidColorBrush(body);
            head.Background = new SolidColorBrush(headColor);
        }

        // ——— Каркас ———

        private void BuildLayout()
        {
            var ink = new SolidColorBrush(Paper.Ink);
            project.FontFamily = Text; project.FontSize = 12; project.Foreground = ink; project.Opacity = 0.75;
            project.VerticalAlignment = VerticalAlignment.Center; project.TextTrimming = TextTrimming.CharacterEllipsis;

            var headGrid = new Grid();
            headGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            headGrid.Children.Add(project);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal };
            buttons.Children.Add(HeadButton("", "Обновить", async () => await Reload(scrollToEnd: false)));
            buttons.Children.Add(HeadButton("", "Открыть в браузере", () => App.OpenUrl(ApiClient.BaseUrl + (detail?.Note?.Path ?? "/"))));
            buttons.Children.Add(HeadButton("", "Закрыть", Close));
            Grid.SetColumn(buttons, 1);
            headGrid.Children.Add(buttons);
            head.Child = headGrid;
            head.Padding = new Thickness(14, 6, 6, 6);
            head.CornerRadius = new CornerRadius(4, 4, 0, 0);
            head.Cursor = Cursors.SizeAll;
            head.MouseLeftButtonDown += (s, e) => { try { DragMove(); } catch (InvalidOperationException) { } };

            scroll.Content = content;

            var footer = BuildComposer();

            var root = new DockPanel();
            DockPanel.SetDock(head, Dock.Top);
            DockPanel.SetDock(footer, Dock.Bottom);
            root.Children.Add(head);
            root.Children.Add(footer);
            root.Children.Add(scroll);

            paper.Child = root;
            paper.CornerRadius = new CornerRadius(4);
            paper.Margin = new Thickness(12);
            paper.Effect = new DropShadowEffect { BlurRadius = 18, ShadowDepth = 4, Direction = 270, Opacity = 0.3 };
            Content = paper;
        }

        private UIElement BuildComposer()
        {
            var ink = new SolidColorBrush(Paper.Ink);
            composer.FontFamily = Text; composer.FontSize = 13; composer.Foreground = ink;
            composer.AcceptsReturn = true; composer.TextWrapping = TextWrapping.Wrap;
            composer.MinHeight = 56; composer.MaxHeight = 160;
            composer.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
            composer.Padding = new Thickness(8, 6, 8, 6);
            composer.Background = new SolidColorBrush(Color.FromArgb(0xB0, 0xFF, 0xFF, 0xFF));
            composer.BorderBrush = new SolidColorBrush(Color.FromArgb(0x30, 0, 0, 0));
            composer.BorderThickness = new Thickness(1);
            composer.TextChanged += (s, e) =>
            {
                placeholder.Visibility = composer.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
                send.IsEnabled = composer.Text.Trim().Length > 0;
            };
            composer.PreviewKeyDown += async (s, e) =>
            {
                if (e.Key == Key.Enter && Keyboard.Modifiers == ModifierKeys.Control)
                {
                    e.Handled = true;
                    await Send();
                }
            };
            placeholder.Text = "Написать комментарий…";
            placeholder.FontFamily = Text; placeholder.FontSize = 13; placeholder.Foreground = ink; placeholder.Opacity = 0.45;
            placeholder.Margin = new Thickness(11, 7, 0, 0); placeholder.IsHitTestVisible = false;
            var box = new Grid();
            box.Children.Add(composer);
            box.Children.Add(placeholder);

            recipientsLine.FontFamily = Text; recipientsLine.FontSize = 11; recipientsLine.Foreground = ink; recipientsLine.Opacity = 0.65;
            recipientsLine.VerticalAlignment = VerticalAlignment.Center; recipientsLine.TextTrimming = TextTrimming.CharacterEllipsis;
            send.Content = "Отправить";
            send.ToolTip = "Ctrl+Enter";
            send.IsEnabled = false;
            ConnectWindow.StyleButton(send, filled: true);
            send.Margin = new Thickness(8, 0, 0, 0);
            send.Opacity = 0.45;
            send.IsEnabledChanged += (s2, e2) => send.Opacity = send.IsEnabled ? 1 : 0.45;
            send.Click += async (s, e) => await Send();

            var row = new Grid { Margin = new Thickness(0, 6, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(recipientsLine);
            Grid.SetColumn(send, 1);
            row.Children.Add(send);

            var panel = new StackPanel { Margin = new Thickness(14, 8, 22, 14) };
            panel.Children.Add(box);
            panel.Children.Add(row);
            return new Border
            {
                Child = panel,
                BorderBrush = new SolidColorBrush(Color.FromArgb(0x22, 0, 0, 0)),
                BorderThickness = new Thickness(0, 1, 0, 0),
            };
        }

        private Border HeadButton(string glyph, string tip, Action onClick)
        {
            var hover = new SolidColorBrush(Color.FromArgb(0x22, 0, 0, 0));
            var b = new Border
            {
                Width = 26, Height = 26, CornerRadius = new CornerRadius(4), Background = Brushes.Transparent,
                Cursor = Cursors.Hand, ToolTip = tip,
                Child = new TextBlock { Text = glyph, FontFamily = Icons, FontSize = 12, Foreground = new SolidColorBrush(Paper.Ink), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
            };
            b.MouseEnter += (s, e) => b.Background = hover;
            b.MouseLeave += (s, e) => b.Background = Brushes.Transparent;
            b.MouseLeftButtonDown += (s, e) => e.Handled = true;
            b.MouseLeftButtonUp += (s, e) => { e.Handled = true; onClick(); };
            return b;
        }

        // ——— Данные ———

        private void ShowLoading(NoteDto note)
        {
            project.Text = note.ProjectName;
            content.Children.Clear();
            content.Children.Add(TitleBox(note.Title));
            content.Children.Add(Muted("Загружаю задачу…", 12, new Thickness(0, 8, 0, 0)));
        }

        private async Task Reload(bool scrollToEnd)
        {
            if (loading) return;
            loading = true;
            try
            {
                var fresh = await api.GetDetail(taskId);
                detail = fresh;
                loadedAt = DateTime.Now;
                if (detail.Note != null) Title = detail.Note.Title;
                Render();
                if (scrollToEnd) scroll.ScrollToEnd();
                if (recipients == null && detail.Note != null) await LoadRecipients();
            }
            catch (UnauthorizedException)
            {
                content.Children.Add(Muted("Нужно заново подключить аккаунт — значок заметок у часов.", 12, new Thickness(0, 8, 0, 0)));
            }
            catch (Exception e)
            {
                Log.Write("detail failed: " + e.Message);
                if (detail == null)
                {
                    content.Children.Clear();
                    content.Children.Add(Muted("Не удалось загрузить задачу. Проверьте интернет и нажмите «Обновить» вверху.", 13, new Thickness(0, 4, 0, 0)));
                }
            }
            finally
            {
                loading = false;
            }
        }

        private async Task LoadRecipients()
        {
            try
            {
                recipients = await api.DefaultRecipients(detail.Note.ProjectId, taskId);
                recipientsLine.Text = recipients.Count > 0
                    ? "Уведомим: " + string.Join(", ", recipients.Select(r => r.Name))
                    : "Без уведомлений — комментарий увидят в задаче";
            }
            catch (Exception e)
            {
                Log.Write("recipients failed: " + e.Message);
                recipients = new List<Recipient>();
                recipientsLine.Text = "";
            }
        }

        private async Task Send()
        {
            var text = composer.Text.Trim();
            if (text.Length == 0 || detail?.Note == null || !send.IsEnabled) return;
            send.IsEnabled = false;
            composer.IsReadOnly = true;
            send.Content = "Отправляю…";
            try
            {
                if (recipients == null) await LoadRecipients();
                await api.PostComment(detail.Note.ProjectId, taskId, text, recipients);
                composer.Text = "";
                await Reload(scrollToEnd: true);
            }
            catch (UnauthorizedException)
            {
                MessageBox.Show(this, "Нужно заново подключить аккаунт — значок заметок у часов.", "ProjectsFlow Заметки");
            }
            catch (Exception e)
            {
                Log.Write("comment failed: " + e.Message);
                MessageBox.Show(this, e is InvalidOperationException ? e.Message : "Комментарий не отправлен: нет связи с ProjectsFlow. Текст сохранён — попробуйте ещё раз.", "ProjectsFlow Заметки");
            }
            finally
            {
                composer.IsReadOnly = false;
                send.Content = "Отправить";
                send.IsEnabled = composer.Text.Trim().Length > 0;
                composer.Focus();
            }
        }

        // ——— Отрисовка ———

        private void Render()
        {
            var note = detail.Note;
            project.Text = note.ProjectName;
            content.Children.Clear();
            content.Children.Add(TitleBox(note.Title));
            content.Children.Add(MetaRow(note));

            if (!string.IsNullOrWhiteSpace(detail.Description))
            {
                // Первая строка описания — это заголовок, второй раз его не показываем.
                var body = string.Join("\n", detail.Description.Replace("\r", "").Split('\n').Skip(1)).Trim();
                if (body.Length > 0) content.Children.Add(Rich(body, 13.5, new Thickness(0, 12, 0, 0)));
            }

            if (detail.Files.Count > 0)
            {
                content.Children.Add(Section($"Файлы · {detail.Files.Count}"));
                content.Children.Add(FilesPanel(detail.Files));
            }

            content.Children.Add(Section(detail.Comments.Count > 0 ? $"Комментарии · {detail.Comments.Count}" : "Комментариев пока нет"));
            foreach (var c in detail.Comments) content.Children.Add(CommentCard(c));
        }

        private UIElement TitleBox(string title) => new TextBox
        {
            Text = title,
            IsReadOnly = true,
            BorderThickness = new Thickness(0),
            Background = Brushes.Transparent,
            TextWrapping = TextWrapping.Wrap,
            FontFamily = Text,
            FontSize = 18,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Paper.Ink),
            Padding = new Thickness(-2, 0, 0, 0),
        };

        private UIElement MetaRow(NoteDto note)
        {
            var row = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
            var editable = note.CanEdit && note.StatusOptions.Count > 0;
            var status = Chip((note.Status == "done" ? "✓ " : "") + note.StatusLabel + (editable ? "  ▾" : ""), bold: true);
            if (editable)
            {
                status.Cursor = Cursors.Hand;
                status.ToolTip = "Сменить статус";
                status.MouseLeftButtonUp += (s, e) =>
                {
                    var menu = new ContextMenu { PlacementTarget = status, Placement = PlacementMode.Bottom };
                    foreach (var o in note.StatusOptions)
                    {
                        var item = new MenuItem { Header = o.Value, IsCheckable = true, IsChecked = o.Key == note.Status };
                        var key = o.Key;
                        item.Click += async (_, __) =>
                        {
                            if (key == note.Status) return;
                            changeStatus(key, false);
                            await Task.Delay(1200);
                            await Reload(scrollToEnd: false);
                        };
                        menu.Items.Add(item);
                    }
                    menu.IsOpen = true;
                };
            }
            row.Children.Add(status);
            var (deadline, overdue) = NoteView.DeadlineLabel(note.Deadline, note.Status == "done");
            if (deadline.Length > 0)
            {
                var chip = Chip("Срок: " + deadline);
                if (overdue) ((TextBlock)chip.Child).Foreground = new SolidColorBrush(Paper.Overdue);
                row.Children.Add(chip);
            }
            if (!string.IsNullOrEmpty(detail.AssigneeName)) row.Children.Add(Chip("Ответственный: " + detail.AssigneeName));
            return row;
        }

        private Border Chip(string text, bool bold = false) => new Border
        {
            Background = new SolidColorBrush(Color.FromArgb(0x1C, 0, 0, 0)),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(9, 3, 9, 3),
            Margin = new Thickness(0, 0, 6, 6),
            Child = new TextBlock { Text = text, FontFamily = Text, FontSize = 12, FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal, Foreground = new SolidColorBrush(Paper.Ink) },
        };

        private UIElement Section(string text) => new TextBlock
        {
            Text = text,
            FontFamily = Text,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Paper.Ink),
            Opacity = 0.7,
            Margin = new Thickness(0, 18, 0, 6),
        };

        private TextBlock Muted(string text, double size, Thickness margin) => new TextBlock
        {
            Text = text, FontFamily = Text, FontSize = size, Foreground = new SolidColorBrush(Paper.Ink),
            Opacity = 0.65, TextWrapping = TextWrapping.Wrap, Margin = margin,
        };

        private UIElement CommentCard(CommentDto c)
        {
            var header = new TextBlock { FontFamily = Text, FontSize = 12, Foreground = new SolidColorBrush(Paper.Ink) };
            header.Inlines.Add(new Bold(new Run(c.Author)));
            header.Inlines.Add(new Run("  " + WhenLabel(c.CreatedAt)) { Foreground = new SolidColorBrush(Color.FromArgb(0x99, Paper.Ink.R, Paper.Ink.G, Paper.Ink.B)) });
            var stack = new StackPanel();
            stack.Children.Add(header);
            if (!string.IsNullOrWhiteSpace(c.Body)) stack.Children.Add(Rich(c.Body, 13, new Thickness(0, 3, 0, 0)));
            if (c.Files.Count > 0) stack.Children.Add(FilesPanel(c.Files));
            return new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(c.IsAgent ? (byte)0x10 : (byte)0x55, 0xFF, 0xFF, 0xFF)),
                BorderBrush = new SolidColorBrush(Color.FromArgb(0x18, 0, 0, 0)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10, 7, 10, 8),
                Margin = new Thickness(0, 0, 0, 6),
                Child = stack,
            };
        }

        private static string WhenLabel(DateTime at)
        {
            if (at == DateTime.MinValue) return "";
            var days = (DateTime.Today - at.Date).Days;
            var time = at.ToString("HH:mm", Ru);
            if (days == 0) return "сегодня " + time;
            if (days == 1) return "вчера " + time;
            return at.ToString(at.Year == DateTime.Today.Year ? "d MMM" : "d MMM yyyy", Ru) + " " + time;
        }

        // ——— Файлы ———

        private UIElement FilesPanel(List<FileDto> files)
        {
            var panel = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) };
            foreach (var f in files)
            {
                var file = f;
                Border item;
                if (file.IsImage)
                {
                    var image = new Image { Stretch = Stretch.UniformToFill };
                    item = new Border
                    {
                        Width = 120, Height = 84, CornerRadius = new CornerRadius(4), ClipToBounds = true,
                        Background = new SolidColorBrush(Color.FromArgb(0x22, 0, 0, 0)),
                        Child = image,
                    };
                    _ = LoadThumb(file, image);
                }
                else
                {
                    item = new Border
                    {
                        Background = new SolidColorBrush(Color.FromArgb(0x1C, 0, 0, 0)),
                        CornerRadius = new CornerRadius(6),
                        Padding = new Thickness(8, 5, 10, 5),
                        MaxWidth = 260,
                        Child = new TextBlock
                        {
                            Text = "  " + file.Filename + "  ·  " + SizeLabel(file.Size),
                            FontFamily = new FontFamily("Segoe UI, Segoe MDL2 Assets"),
                            FontSize = 12,
                            Foreground = new SolidColorBrush(Paper.Ink),
                            TextTrimming = TextTrimming.CharacterEllipsis,
                        },
                    };
                }
                item.Margin = new Thickness(0, 0, 6, 6);
                item.VerticalAlignment = VerticalAlignment.Top;
                item.Cursor = Cursors.Hand;
                item.ToolTip = file.Filename;
                item.MouseLeftButtonUp += async (s, e) => await OpenFile(file);
                panel.Children.Add(item);
            }
            return panel;
        }

        private static string SizeLabel(long bytes) =>
            bytes >= 1024 * 1024 ? $"{bytes / 1024.0 / 1024.0:0.#} МБ" : $"{Math.Max(1, bytes / 1024)} КБ";

        private async Task LoadThumb(FileDto file, Image target)
        {
            try
            {
                var data = await api.DownloadAttachment(file.Id);
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.DecodePixelWidth = 240;
                bmp.StreamSource = new MemoryStream(data);
                bmp.EndInit();
                bmp.Freeze();
                target.Source = bmp;
            }
            catch (Exception e)
            {
                Log.Write("thumb failed: " + e.Message);
            }
        }

        // Файл скачивается во временную папку и открывается программой Windows по умолчанию.
        private async Task OpenFile(FileDto file)
        {
            try
            {
                var dir = Path.Combine(Path.GetTempPath(), "ProjectsFlowNotes");
                Directory.CreateDirectory(dir);
                var safe = string.Concat(file.Filename.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '_' : ch));
                var path = Path.Combine(dir, file.Id.Substring(0, Math.Min(8, file.Id.Length)) + "_" + safe);
                if (!File.Exists(path)) File.WriteAllBytes(path, await api.DownloadAttachment(file.Id));
                App.OpenUrl(path);
            }
            catch (Exception e)
            {
                Log.Write("open file failed: " + e.Message);
                MessageBox.Show(this, "Не удалось открыть файл: " + e.Message, "ProjectsFlow Заметки");
            }
        }

        // ——— Текст с простой разметкой ———

        private static readonly Regex InlineRe = new Regex(@"(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|https?://[^\s)]+)", RegexOptions.Compiled);
        private static readonly Regex LinkRe = new Regex(@"^\[([^\]]+)\]\(([^)\s]+)\)$", RegexOptions.Compiled);

        // Заголовки «#», списки «-»/«1.», цитаты «>», **жирный**, `код`, ссылки. Текст можно выделить и скопировать.
        private RichTextBox Rich(string text, double size, Thickness margin)
        {
            var doc = new FlowDocument { FontFamily = Text, FontSize = size, Foreground = new SolidColorBrush(Paper.Ink), PagePadding = new Thickness(0) };
            Paragraph current = null;
            foreach (var rawLine in text.Replace("\r", "").Split('\n'))
            {
                var line = rawLine.TrimEnd();
                if (line.Trim().Length == 0)
                {
                    current = null;
                    continue;
                }
                var heading = Regex.Match(line, @"^\s*(#{1,6})\s+(.*)$");
                var bullet = Regex.Match(line, @"^(\s*)([-*•]|\d+[.)])\s+(.*)$");
                var quote = Regex.Match(line, @"^\s*>\s?(.*)$");
                if (heading.Success)
                {
                    var p = new Paragraph { Margin = new Thickness(0, 8, 0, 2), FontWeight = FontWeights.SemiBold, FontSize = size + (heading.Groups[1].Length <= 2 ? 2 : 1) };
                    AddInlines(p, heading.Groups[2].Value);
                    doc.Blocks.Add(p);
                    current = null;
                }
                else if (bullet.Success)
                {
                    var marker = bullet.Groups[2].Value;
                    var indent = 6 + Math.Min(4, bullet.Groups[1].Value.Length / 2) * 12;
                    var p = new Paragraph { Margin = new Thickness(indent + 12, 1, 0, 1), TextIndent = -12 };
                    p.Inlines.Add(new Run((char.IsDigit(marker[0]) ? marker : "•") + " "));
                    AddInlines(p, bullet.Groups[3].Value);
                    doc.Blocks.Add(p);
                    current = null;
                }
                else if (quote.Success)
                {
                    var p = new Paragraph { Margin = new Thickness(10, 2, 0, 2), FontStyle = FontStyles.Italic, Foreground = new SolidColorBrush(Color.FromArgb(0xB0, Paper.Ink.R, Paper.Ink.G, Paper.Ink.B)) };
                    AddInlines(p, quote.Groups[1].Value);
                    doc.Blocks.Add(p);
                    current = null;
                }
                else
                {
                    if (current == null)
                    {
                        current = new Paragraph { Margin = new Thickness(0, 4, 0, 4) };
                        doc.Blocks.Add(current);
                    }
                    else current.Inlines.Add(new LineBreak());
                    AddInlines(current, line);
                }
            }
            return new RichTextBox
            {
                Document = doc,
                IsReadOnly = true,
                IsDocumentEnabled = true,
                BorderThickness = new Thickness(0),
                Background = Brushes.Transparent,
                Padding = new Thickness(-4, 0, 0, 0),
                Margin = margin,
                VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            };
        }

        private static void AddInlines(Paragraph p, string text)
        {
            var pos = 0;
            foreach (Match m in InlineRe.Matches(text))
            {
                if (m.Index > pos) p.Inlines.Add(new Run(text.Substring(pos, m.Index - pos)));
                var token = m.Value;
                if (token.StartsWith("**")) p.Inlines.Add(new Bold(new Run(token.Substring(2, token.Length - 4))));
                else if (token.StartsWith("`")) p.Inlines.Add(new Run(token.Substring(1, token.Length - 2)) { FontFamily = new FontFamily("Consolas"), Background = new SolidColorBrush(Color.FromArgb(0x1C, 0, 0, 0)) });
                else
                {
                    var link = LinkRe.Match(token);
                    var label = link.Success ? link.Groups[1].Value : token;
                    var url = link.Success ? link.Groups[2].Value : token;
                    if (url.StartsWith("/")) url = ApiClient.BaseUrl + url;
                    var h = new Hyperlink(new Run(label)) { Foreground = new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8)), Cursor = Cursors.Hand };
                    h.Click += (s, e) => App.OpenUrl(url);
                    p.Inlines.Add(h);
                }
                pos = m.Index + m.Length;
            }
            if (pos < text.Length) p.Inlines.Add(new Run(text.Substring(pos)));
        }
    }
}
