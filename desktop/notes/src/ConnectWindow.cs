using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;

namespace ProjectsFlowNotes
{
    // Подключение аккаунта без пароля: приложение получает код, открывает браузер, человек
    // нажимает «Подключить» на сайте (где он уже вошёл) — и приложение забирает токен.
    internal sealed class ConnectWindow : Window
    {
        public event Action<string> Connected;

        private readonly ApiClient api;
        private readonly TextBlock heading = new TextBlock();
        private readonly TextBlock hint = new TextBlock();
        private readonly TextBlock code = new TextBlock();
        private readonly Button primary = new Button();
        private readonly Button secondary = new Button();
        private DeviceStart device;
        private int attempt;
        private bool finished;

        private static readonly Color Accent = Color.FromRgb(0x6D, 0x3B, 0xF5);
        private static readonly Color Ink = Color.FromRgb(0x1F, 0x1D, 0x2B);
        private static readonly Color Muted = Color.FromRgb(0x6B, 0x68, 0x7A);

        public ConnectWindow(ApiClient api)
        {
            this.api = api;
            Title = "ProjectsFlow Заметки — подключение";
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            SizeToContent = SizeToContent.WidthAndHeight;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            Topmost = true;
            Icon = IconFactory.WpfIcon();

            var font = new FontFamily("Segoe UI");
            var brand = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 16) };
            brand.Children.Add(new Image { Source = IconFactory.WpfIcon(), Width = 22, Height = 22, Margin = new Thickness(0, 0, 8, 0) });
            brand.Children.Add(new TextBlock { Text = "ProjectsFlow Заметки", FontFamily = font, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Ink), VerticalAlignment = VerticalAlignment.Center });

            heading.FontFamily = font; heading.FontSize = 19; heading.FontWeight = FontWeights.SemiBold;
            heading.Foreground = new SolidColorBrush(Ink); heading.TextWrapping = TextWrapping.Wrap;
            hint.FontFamily = font; hint.FontSize = 13; hint.Foreground = new SolidColorBrush(Muted);
            hint.TextWrapping = TextWrapping.Wrap; hint.Margin = new Thickness(0, 6, 0, 0); hint.LineHeight = 19;
            code.FontFamily = new FontFamily("Consolas"); code.FontSize = 24; code.FontWeight = FontWeights.SemiBold;
            code.Foreground = new SolidColorBrush(Ink); code.HorizontalAlignment = HorizontalAlignment.Center;
            var codeBox = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0xF3, 0xF1, 0xF8)),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(12, 10, 12, 10),
                Margin = new Thickness(0, 16, 0, 0),
                Child = code,
            };

            StyleButton(primary, filled: true);
            StyleButton(secondary, filled: false);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 20, 0, 0) };
            buttons.Children.Add(secondary);
            buttons.Children.Add(primary);

            var panel = new StackPanel { Width = 340 };
            panel.Children.Add(brand);
            panel.Children.Add(heading);
            panel.Children.Add(hint);
            panel.Children.Add(codeBox);
            panel.Children.Add(buttons);

            var card = new Border
            {
                Background = Brushes.White,
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(24, 20, 24, 20),
                Margin = new Thickness(20),
                Effect = new DropShadowEffect { BlurRadius = 24, ShadowDepth = 4, Direction = 270, Opacity = 0.25 },
                Child = panel,
            };
            card.MouseLeftButtonDown += (s, e) => { try { DragMove(); } catch (InvalidOperationException) { } };
            Content = card;

            primary.Click += (s, e) => OnPrimary();
            secondary.Click += (s, e) => Close();
            KeyDown += (s, e) => { if (e.Key == Key.Escape) Close(); };

            Loaded += async (s, e) => await Start();
        }

        private static void StyleButton(Button b, bool filled)
        {
            b.FontFamily = new FontFamily("Segoe UI");
            b.FontSize = 13;
            b.Padding = new Thickness(14, 7, 14, 7);
            b.Margin = new Thickness(8, 0, 0, 0);
            b.Cursor = Cursors.Hand;
            b.BorderThickness = new Thickness(0);
            b.Background = filled ? new SolidColorBrush(Accent) : new SolidColorBrush(Color.FromRgb(0xF1, 0xF0, 0xF5));
            b.Foreground = filled ? Brushes.White : new SolidColorBrush(Ink);
            var template = new ControlTemplate(typeof(Button));
            var border = new FrameworkElementFactory(typeof(Border));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(8));
            border.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            border.SetBinding(Border.PaddingProperty, new System.Windows.Data.Binding("Padding") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            border.AppendChild(content);
            template.VisualTree = border;
            b.Template = template;
        }

        private void Show(string head, string text, string codeText, string primaryText, string secondaryText)
        {
            heading.Text = head;
            hint.Text = text;
            code.Text = codeText ?? "";
            ((FrameworkElement)code.Parent).Visibility = string.IsNullOrEmpty(codeText) ? Visibility.Collapsed : Visibility.Visible;
            primary.Content = primaryText;
            primary.Visibility = primaryText == null ? Visibility.Collapsed : Visibility.Visible;
            secondary.Content = secondaryText;
            secondary.Visibility = secondaryText == null ? Visibility.Collapsed : Visibility.Visible;
        }

        private void OnPrimary()
        {
            if (finished) { Close(); return; }
            if (device != null) App.OpenUrl(device.VerificationUrl);
            else _ = Start();
        }

        private async Task Start()
        {
            var my = ++attempt;
            device = null;
            Show("Подключаем ваш аккаунт", "Получаем код подключения…", null, null, "Отмена");
            try
            {
                device = await api.StartDevice();
            }
            catch (Exception e)
            {
                Log.Write("device start failed: " + e.Message);
                if (my == attempt) Show("Нет связи с ProjectsFlow", "Проверьте интернет и попробуйте ещё раз.", null, "Повторить", "Отмена");
                return;
            }
            if (my != attempt) return;
            App.OpenUrl(device.VerificationUrl);
            Show(
                "Подтвердите в браузере",
                "Мы открыли ProjectsFlow в браузере. Нажмите там «Подключить» — код на странице должен совпадать с этим. Если вы не вошли, сначала войдите.",
                device.UserCode,
                "Открыть браузер ещё раз",
                "Отмена");
            await Poll(my, device);
        }

        private async Task Poll(int my, DeviceStart d)
        {
            var deadline = DateTime.UtcNow.AddSeconds(d.ExpiresInSec);
            while (my == attempt && IsLoaded && DateTime.UtcNow < deadline)
            {
                await Task.Delay(TimeSpan.FromSeconds(d.IntervalSec));
                if (my != attempt || !IsLoaded) return;
                try
                {
                    var (state, token) = await api.PollDevice(d.DeviceCode);
                    if (state == DevicePollState.Approved)
                    {
                        finished = true;
                        Show("Готово!", "Заметки подключены. Откройте задачу в ProjectsFlow и нажмите «На экран» — она появится стикером поверх окон.", null, "Понятно", null);
                        Connected?.Invoke(token);
                        return;
                    }
                    if (state == DevicePollState.Denied)
                    {
                        device = null;
                        Show("Подключение отклонено", "Можно попробовать ещё раз.", null, "Попробовать снова", "Закрыть");
                        return;
                    }
                    if (state == DevicePollState.Expired) break;
                }
                catch (Exception e)
                {
                    Log.Write("device poll failed: " + e.Message);
                }
            }
            if (my == attempt && IsLoaded)
            {
                device = null;
                Show("Код устарел", "Код подключения действует 10 минут. Получите новый.", null, "Получить новый код", "Отмена");
            }
        }

        protected override void OnClosed(EventArgs e)
        {
            attempt++;
            base.OnClosed(e);
        }
    }
}
