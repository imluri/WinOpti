using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyDescription("WinOpti disposable test window")]

internal static class DisposableWindow
{
    [STAThread]
    private static void Main(string[] args)
    {
        // Give the fixture the same ancestry shape as an independently opened
        // app. The temporary launcher exits before the capture starts.
        if (args.Length == 2 && args[0] == "launch")
        {
            using (var child = Process.Start(Application.ExecutablePath, args[1]))
                File.WriteAllText("window.pid", child.Id.ToString());
            return;
        }

        Application.EnableVisualStyles();
        using (var window = new Form())
        using (var timeout = new Timer())
        {
            window.Text = "WinOpti disposable test window";
            window.ClientSize = new Size(320, 88);
            window.Controls.Add(new Label
            {
                Text = "Temporary window for the WinOpti close test.",
                AutoSize = true,
                Location = new Point(16, 25)
            });
            int lifetime;
            timeout.Interval = args.Length == 1 && Int32.TryParse(args[0], out lifetime) ? lifetime : 30000;
            timeout.Tick += delegate { window.Close(); };
            timeout.Start();
            Application.Run(window);
            File.WriteAllText("window.closed", Process.GetCurrentProcess().Id.ToString());
        }
    }
}
