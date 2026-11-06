param([string]$Java=$env:JAVA_HOME)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
if(-not $Java -or $Java -match 'JDK8'){$Java='E:\Android_Studio\android_studio\jbr'}
$private=Join-Path $root 'artifacts\private-signing'
$key=Join-Path $private 'android-release.p12'
$passwordFile=Join-Path $private 'android-release.password'
if((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $passwordFile)){throw 'Release signing files already exist; reuse them, do not replace them.'}
New-Item -ItemType Directory -Force -Path $private | Out-Null
# Only this Windows user can read this private directory. Never add it to a release archive.
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $private -AclObject $acl
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
$bytes=New-Object byte[] 48
$rng.GetBytes($bytes);$rng.Dispose()
[IO.File]::WriteAllText($passwordFile,[Convert]::ToBase64String($bytes),[Text.UTF8Encoding]::new($false))
& (Join-Path $Java 'bin\keytool.exe') -genkeypair -keystore $key -storetype PKCS12 -storepass:file $passwordFile -keypass:file $passwordFile -alias hiddentrack -dname 'CN=Hidden Track' -keyalg RSA -keysize 3072 -validity 10000 *> (Join-Path $private 'generation.log')
if($LASTEXITCODE -ne 0){throw 'Signing key generation failed; see private generation.log locally.'}
Write-Output 'Release signing key created. Back up artifacts/private-signing privately; password and key are never printed or packaged.'
