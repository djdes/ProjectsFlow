using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace ProjectsFlowNotes
{
    // Значок — жёлтый стикер с загнутым уголком. Рисуется кодом: и для трея (под размер экрана),
    // и для app.ico (`--make-icon`), чтобы не держать в репозитории набор картинок.
    internal static class IconFactory
    {
        public static Bitmap Draw(int size)
        {
            var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                float s = size;
                float pad = Math.Max(1f, s * 0.08f);
                float fold = s * 0.28f;
                var right = s - pad;
                var bottom = s - pad;

                using (var body = new GraphicsPath())
                {
                    body.AddLine(pad, pad, right, pad);
                    body.AddLine(right, pad, right, bottom - fold);
                    body.AddLine(right, bottom - fold, right - fold, bottom);
                    body.AddLine(right - fold, bottom, pad, bottom);
                    body.CloseFigure();
                    using (var fill = new SolidBrush(Color.FromArgb(0xFF, 0xD9, 0x4A)))
                        g.FillPath(fill, body);
                    using (var edge = new Pen(Color.FromArgb(0xC9, 0x9A, 0x16), Math.Max(1f, s / 32f)))
                        g.DrawPath(edge, body);
                }
                using (var corner = new GraphicsPath())
                {
                    corner.AddLine(right, bottom - fold, right - fold, bottom - fold);
                    corner.AddLine(right - fold, bottom - fold, right - fold, bottom);
                    corner.CloseFigure();
                    using (var fill = new SolidBrush(Color.FromArgb(0xE8, 0xB3, 0x24)))
                        g.FillPath(fill, corner);
                }
                if (size >= 20)
                {
                    using (var line = new Pen(Color.FromArgb(0x8A, 0x63, 0x0C), s * 0.07f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    {
                        var x0 = pad + s * 0.16f;
                        g.DrawLine(line, x0, s * 0.32f, right - s * 0.16f, s * 0.32f);
                        g.DrawLine(line, x0, s * 0.48f, right - s * 0.22f, s * 0.48f);
                        g.DrawLine(line, x0, s * 0.64f, right - fold - s * 0.06f, s * 0.64f);
                    }
                }
            }
            return bmp;
        }

        public static Icon TrayIcon()
        {
            var size = System.Windows.Forms.SystemInformation.SmallIconSize.Width;
            using (var bmp = Draw(size))
                return Icon.FromHandle(bmp.GetHicon());
        }

        private static BitmapSource wpfIcon;

        public static BitmapSource WpfIcon()
        {
            if (wpfIcon != null) return wpfIcon;
            using (var bmp = Draw(64))
            {
                var h = bmp.GetHbitmap();
                wpfIcon = Imaging.CreateBitmapSourceFromHBitmap(h, IntPtr.Zero, System.Windows.Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                DeleteObject(h);
            }
            wpfIcon.Freeze();
            return wpfIcon;
        }

        [System.Runtime.InteropServices.DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr h);

        // ICO из PNG-кадров (Windows Vista+ понимает PNG внутри .ico).
        public static void WriteIco(string path)
        {
            var sizes = new[] { 16, 20, 24, 32, 40, 48, 64, 256 };
            var frames = new byte[sizes.Length][];
            for (var i = 0; i < sizes.Length; i++)
            {
                using (var bmp = Draw(sizes[i]))
                using (var ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    frames[i] = ms.ToArray();
                }
            }
            using (var fs = File.Create(path))
            using (var w = new BinaryWriter(fs))
            {
                w.Write((short)0); w.Write((short)1); w.Write((short)sizes.Length);
                var offset = 6 + 16 * sizes.Length;
                for (var i = 0; i < sizes.Length; i++)
                {
                    w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                    w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                    w.Write((byte)0); w.Write((byte)0);
                    w.Write((short)1); w.Write((short)32);
                    w.Write(frames[i].Length);
                    w.Write(offset);
                    offset += frames[i].Length;
                }
                foreach (var f in frames) w.Write(f);
            }
        }
    }
}
