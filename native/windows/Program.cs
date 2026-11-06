using System;
using System.IO;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class HiddenTrack : Form {
    private readonly WebView2 web = new WebView2();
    private readonly List<Form> popups = new List<Form>();
    private static readonly Uri Home = new Uri("http://43.129.205.113:3000/");
    private static void StartupLog(string phase, Exception error) {
        try {
            var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"HiddenTrack","logs");
            Directory.CreateDirectory(folder);
            File.AppendAllText(Path.Combine(folder,"startup.log"),DateTime.UtcNow.ToString("o")+" stage="+phase+" type="+(error==null?"None":error.GetType().Name)+" hresult=0x"+(error==null?"00000000":error.HResult.ToString("X8"))+Environment.NewLine);
        }catch{}
    }
    [STAThread] private static void Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new HiddenTrack());
    }
    private HiddenTrack() {
        if(Environment.GetEnvironmentVariable("HIDDENTRACK_DIAGNOSTIC")=="1"){Opacity=0;ShowInTaskbar=false;}
        Text="Hidden Track"; Width=1366; Height=800; MinimumSize=new System.Drawing.Size(960,540);
        Icon=System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        web.Dock=DockStyle.Fill; Controls.Add(web); Load+=Ready;
        FormClosed+=(s,e)=>{foreach(var popup in popups.ToArray())popup.Close();web.Dispose();};
    }
    private static bool GameOrigin(Uri uri) {
        return uri.IsAbsoluteUri && uri.GetLeftPart(UriPartial.Authority)==Home.GetLeftPart(UriPartial.Authority);
    }
    private static bool Internal(Uri uri) {
        return GameOrigin(uri) || uri.Scheme=="https" && (uri.Host=="qq.com" || uri.Host.EndsWith(".qq.com",StringComparison.OrdinalIgnoreCase));
    }
    private static void OpenExternal(string address) {
        Uri uri;
        if(Uri.TryCreate(address,UriKind.Absolute,out uri) &&
           (uri.Scheme=="https" || uri.Scheme=="qqmusic" || uri.Scheme=="mqq" || uri.Scheme=="mqqapi"))
            try {Process.Start(new ProcessStartInfo(address){UseShellExecute=true});}catch{}
    }
    private static void Configure(WebView2 view) {
        view.CoreWebView2.Settings.UserAgent += " HiddenTrackWindows/1.0";
        view.CoreWebView2.Settings.IsWebMessageEnabled=false;
        view.CoreWebView2.Settings.AreDevToolsEnabled=false;
    }
    // window.open('about:blank') must receive a real shared-cookie browser: the
    // login page assigns its official URL only after the async authorization API returns.
    private async void OpenPopup(object sender, CoreWebView2NewWindowRequestedEventArgs e) {
        e.Handled=true;
        if(popups.Count>=2)return;
        var deferral=e.GetDeferral();
        Form popup=null;
        try {
            popup=new Form{Text="QQ 音乐授权",Width=1000,Height=720,StartPosition=FormStartPosition.CenterParent};
            var child=new WebView2{Dock=DockStyle.Fill}; popup.Controls.Add(child);
            popups.Add(popup);
            popup.FormClosed+=(s,args)=>{popups.Remove(popup);child.Dispose();};
            popup.Show(this);
            await child.EnsureCoreWebView2Async(web.CoreWebView2.Environment);
            Configure(child);
            child.CoreWebView2.NavigationStarting+=(s,args)=>{
                if(args.Uri=="about:blank")return;
                Uri uri;
                if(!Uri.TryCreate(args.Uri,UriKind.Absolute,out uri)){args.Cancel=true;return;}
                if(GameOrigin(uri)) {
                    args.Cancel=true;
                    web.CoreWebView2.Navigate(uri.AbsoluteUri);
                    popup.Close(); Activate();
                } else if(!Internal(uri)){args.Cancel=true;OpenExternal(args.Uri);}
            };
            child.CoreWebView2.WindowCloseRequested+=(s,args)=>popup.Close();
            child.CoreWebView2.NewWindowRequested+=(s,args)=>{args.Handled=true;OpenExternal(args.Uri);};
            e.NewWindow=child.CoreWebView2;
        } catch {if(popup!=null)popup.Close();}
        finally {deferral.Complete();}
    }
    private async void Ready(object sender, EventArgs args) {
        string phase="detect-runtime";
        try {
            CoreWebView2Environment.GetAvailableBrowserVersionString();
            phase="create-environment";
            // The override is for isolated command-line smoke tests; the server URL is fixed.
            var data=Environment.GetEnvironmentVariable("HIDDENTRACK_USER_DATA");
            if(String.IsNullOrEmpty(data))data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"HiddenTrack","WebView");
            var options=new CoreWebView2EnvironmentOptions();
            options.AdditionalBrowserArguments="--autoplay-policy=no-user-gesture-required";
            var environment=await CoreWebView2Environment.CreateAsync(null,data,options);
            phase="create-view";
            await web.EnsureCoreWebView2Async(environment); Configure(web);
            web.CoreWebView2.NavigationStarting+=(s,e)=>{
                Uri uri;
                if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out uri)||!Internal(uri)){e.Cancel=true;OpenExternal(e.Uri);}
            };
            web.CoreWebView2.WindowCloseRequested+=(s,e)=>{if(web.Source!=null && GameOrigin(web.Source))Close();};
            web.CoreWebView2.NewWindowRequested+=OpenPopup;
            web.CoreWebView2.Navigate(Home.AbsoluteUri);
            StartupLog("ready",null);
        } catch (Exception error) {
            StartupLog(phase,error);
            if(Environment.GetEnvironmentVariable("HIDDENTRACK_DIAGNOSTIC")!="1") {
                if(error is WebView2RuntimeNotFoundException) {
                    if(MessageBox.Show("未检测到 WebView2 Runtime。是否打开微软官方下载页？","Hidden Track",MessageBoxButtons.YesNo)==DialogResult.Yes)
                        OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/#download-section");
                } else MessageBox.Show("客户端初始化失败（"+error.GetType().Name+" / 0x"+error.HResult.ToString("X8")+"）。请完整解压所有文件后重试。诊断位于 %LOCALAPPDATA%/HiddenTrack/logs/startup.log。","Hidden Track");
            }
            Close();
        }
    }
}
