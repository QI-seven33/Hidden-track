using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Windows.Forms;
internal static class Bootstrap {
 static string Digest(byte[] data){using(var sha=SHA256.Create())return Convert.ToBase64String(sha.ComputeHash(data));}
 [STAThread]static void Main(){
  try{
   var version=Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
   var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"HiddenTrack","client",version);
   Directory.CreateDirectory(folder);
   var names=new[]{"HiddenTrackClient.exe","Microsoft.Web.WebView2.Core.dll","Microsoft.Web.WebView2.WinForms.dll","WebView2Loader.dll","LICENSE.txt"};
   for(int i=0;i<names.Length;i++){
    byte[] data;using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload."+i))using(var memory=new MemoryStream()){stream.CopyTo(memory);data=memory.ToArray();}
    var target=Path.Combine(folder,names[i]);
    if(File.Exists(target)&&Digest(File.ReadAllBytes(target))==Digest(data))continue;
    var temp=target+".new-"+Guid.NewGuid().ToString("N");File.WriteAllBytes(temp,data);
    if(File.Exists(target))File.Replace(temp,target,null);else File.Move(temp,target);
   }
   Process.Start(new ProcessStartInfo(Path.Combine(folder,"HiddenTrackClient.exe")){WorkingDirectory=folder,UseShellExecute=false});
  }catch(Exception error){
   var code="0x"+error.HResult.ToString("X8");
   try{var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"HiddenTrack","logs");Directory.CreateDirectory(folder);File.AppendAllText(Path.Combine(folder,"startup.log"),DateTime.UtcNow.ToString("o")+" stage=unpack-client type="+error.GetType().Name+" hresult="+code+Environment.NewLine);}catch{}
   MessageBox.Show("客户端启动失败（"+code+"）。请先关闭正在运行的 Hidden Track 再重试。诊断位于 %LOCALAPPDATA%/HiddenTrack/logs/startup.log。","Hidden Track");
  }
 }
}
