param(
  [string]$AndroidSdk=$env:ANDROID_SDK_ROOT,
  [string]$Java=$env:JAVA_HOME,
  [string]$SigningKey,
  [string]$SigningPasswordFile
)
$ErrorActionPreference='Stop'
# 原生工具（javac/aapt2/d8）会把进度与弃用提示写到 stderr，
# 在 PS5.1 的 Stop 策略下会被当成致命错误，这里只降级原生命令的 stderr。
try{$PSNativeCommandUseErrorActionPreference=$false}catch{}
$root=Split-Path $PSScriptRoot
Set-Location -LiteralPath $root
$version=(Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
if($version -notmatch '^(\d+)\.(\d+)\.(\d+)$'){throw 'Expected a numeric release version'}
$versionCode=([int]$Matches[1])*10000+([int]$Matches[2])*100+[int]$Matches[3]
[xml]$manifest=Get-Content -LiteralPath 'native/android/AndroidManifest.xml'
$ns='http://schemas.android.com/apk/res/android'
if($manifest.manifest.GetAttribute('versionName',$ns) -ne $version -or [int]$manifest.manifest.GetAttribute('versionCode',$ns) -ne $versionCode){throw 'Android versionName/versionCode must match package.json'}
if(-not $AndroidSdk){$AndroidSdk='E:\Android_Studio\SDK'}
if(-not $Java -or $Java -match 'JDK8'){$Java='E:\Android_Studio\android_studio\jbr'}
if(-not $SigningKey){$SigningKey=Join-Path $root 'artifacts/private-signing/android-release.p12'}
if(-not $SigningPasswordFile){$SigningPasswordFile=Join-Path $root 'artifacts/private-signing/android-release.password'}
if(-not(Test-Path -LiteralPath $SigningKey) -or -not(Test-Path -LiteralPath $SigningPasswordFile)){throw 'A release keystore/password file is required; initialize it once using scripts/init-android-signing.ps1'}
$tools=Join-Path $AndroidSdk 'build-tools/36.0.0'
$androidJar=Join-Path $AndroidSdk 'platforms/android-37.0/android.jar'
$out=Join-Path $root ('artifacts/native-build/'+$version+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$android=Join-Path $out 'android'
$windows=Join-Path $out 'HiddenTrack-Windows'
foreach($folder in @($android,$windows,"$android/classes")){New-Item -ItemType Directory -Force -Path $folder|Out-Null}
function Run([string]$program,[string[]]$arguments){
  $priorJava=$env:JAVA_HOME
  $priorEA=$ErrorActionPreference
  try{
    $env:JAVA_HOME=$Java
    # 原生工具把警告/进度写到 stderr，PS5.1 在 Stop 策略下会当成致命错误终止，
    # 这里临时放宽，只看真实退出码。
    $ErrorActionPreference='Continue'
    & $program @arguments 2>&1 | ForEach-Object { Write-Host $_ }
    if($LASTEXITCODE -ne 0){throw "Build step failed: $program"}
  } finally {$env:JAVA_HOME=$priorJava;$ErrorActionPreference=$priorEA}
}
Run (Join-Path $tools 'aapt2.exe') @('compile','--dir','native/android/res','-o',"$android/resources.zip")
Run (Join-Path $tools 'aapt2.exe') @('link','-o',"$android/unsigned.apk",'-I',$androidJar,'--manifest','native/android/AndroidManifest.xml',"$android/resources.zip")
Run (Join-Path $Java 'bin/javac.exe') @('-nowarn','-encoding','UTF-8','--release','8','-cp',$androidJar,'-d',"$android/classes",'native/android/MainActivity.java')
$classFiles=@(Get-ChildItem -LiteralPath "$android/classes" -Recurse -Filter '*.class'|Select-Object -ExpandProperty FullName)
Run (Join-Path $tools 'd8.bat') (@('--lib',$androidJar,'--min-api','26','--output',$android)+$classFiles)
Push-Location -LiteralPath $android
try{Run (Join-Path $Java 'bin/jar.exe') @('uf','unsigned.apk','classes.dex')}finally{Pop-Location}
Run (Join-Path $tools 'zipalign.exe') @('-f','4',"$android/unsigned.apk","$android/aligned.apk")
$apk=Join-Path $out "HiddenTrack-Android-$version.apk"
Run (Join-Path $tools 'apksigner.bat') @('sign','--ks',$SigningKey,'--ks-key-alias','hiddentrack','--ks-pass',"file:$SigningPasswordFile",'--out',$apk,"$android/aligned.apk")
Run (Join-Path $tools 'apksigner.bat') @('verify','--verbose','--print-certs',$apk)
Run (Join-Path $tools 'aapt2.exe') @('dump','badging',$apk)
# Wrap the existing PNG icon in an ICO container without changing the artwork.
$png=[IO.File]::ReadAllBytes((Join-Path $root 'public/icons/icon-192.png'))
$icon=Join-Path $out 'icon.ico'
$writer=[IO.BinaryWriter]::new([IO.File]::Create($icon))
try{$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]1);$writer.Write([byte]192);$writer.Write([byte]192);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$png.Length);$writer.Write([uint32]22);$writer.Write($png)}finally{$writer.Dispose()}
$versionInfo=Join-Path $out 'VersionInfo.cs'
"using System.Reflection;[assembly:AssemblyTitle(`"Hidden Track`")][assembly:AssemblyProduct(`"Hidden Track`")][assembly:AssemblyVersion(`"$version.0`")][assembly:AssemblyFileVersion(`"$version.0`")]"|Set-Content -LiteralPath $versionInfo -Encoding utf8
$sdk=Join-Path $root 'artifacts/native-deps/webview2'
if(-not(Test-Path -LiteralPath "$sdk/lib/net462/Microsoft.Web.WebView2.WinForms.dll")){throw 'Official WebView2 SDK is required in artifacts/native-deps/webview2'}
$framework='C:\Windows\Microsoft.NET\Framework64\v4.0.30319'
Run "$framework/csc.exe" @('/nologo','/target:winexe','/platform:x64',"/win32icon:$icon","/win32manifest:$(Join-Path $root 'native\windows\app.manifest')","/out:$windows/HiddenTrack.exe",'/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll',"/reference:$sdk/lib/net462/Microsoft.Web.WebView2.Core.dll","/reference:$sdk/lib/net462/Microsoft.Web.WebView2.WinForms.dll",(Join-Path $root 'native\windows\Program.cs'),$versionInfo)
foreach($file in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')){Copy-Item -LiteralPath "$sdk/lib/net462/$file" -Destination "$windows/$file"}
Copy-Item -LiteralPath "$sdk/runtimes/win-x64/native/WebView2Loader.dll" -Destination "$windows/WebView2Loader.dll"
Get-ChildItem -LiteralPath $sdk -Filter '*LICENSE*'|Copy-Item -Destination $windows
Copy-Item -LiteralPath 'native/windows/使用说明.txt' -Destination "$windows/使用说明.txt"
$launcher=Join-Path $out "HiddenTrack-Windows-$version-x64.exe"
$resources=@()
$payload=@('HiddenTrack.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','LICENSE.txt')
for($i=0;$i -lt $payload.Count;$i++){$resources+="/resource:$(Join-Path $windows $payload[$i]),payload.$i"}
Run "$framework/csc.exe" (@('/nologo','/target:winexe','/platform:x64',"/win32icon:$icon","/win32manifest:$(Join-Path $root 'native\windows\app.manifest')","/out:$launcher",'/reference:System.Windows.Forms.dll',(Join-Path $root 'native\windows\Bootstrap.cs'),$versionInfo)+$resources)
$zip=Join-Path $out "HiddenTrack-Windows-$version-x64.zip"
Compress-Archive -LiteralPath $windows -DestinationPath $zip
@{version=$version;versionCode=$versionCode;output=$out;apk=$apk;windows=$zip;launcher=$launcher;entry='http://43.129.205.113:3000/';signing='release'}|ConvertTo-Json|Set-Content 'artifacts/native-build-result.json' -Encoding utf8
Write-Output "Built release clients: $out"
