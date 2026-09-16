<#
  批量调整工具 - CEP 插件自动安装程序
  ------------------------------------------------------------------
  功能：
    1. 自动索引本机 Photoshop 版本与 CEP 扩展目录；
    2. 把 plugin-cep 安装到 CEP 扩展目录（默认建立目录联接，源码改动即时生效）；
    3. 写入 PlayerDebugMode 注册表并放置 .debug 标记，解决未签名扩展被拒绝加载的问题。

  用法：
    powershell -ExecutionPolicy Bypass -File tools\install-cep.ps1
    powershell -ExecutionPolicy Bypass -File tools\install-cep.ps1 -AllUsers     # 需管理员
    powershell -ExecutionPolicy Bypass -File tools\install-cep.ps1 -Copy        # 复制而非联接
    powershell -ExecutionPolicy Bypass -File tools\install-cep.ps1 -Uninstall
#>

[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$AllUsers,
  [switch]$Copy,
  [switch]$RemoveDebugMode
)

$ErrorActionPreference = "Stop"

$BundleId   = "com.textadjust.cep"
$PluginName = "plugin-cep"

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$PluginSrc = Join-Path $RepoRoot $PluginName

try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

function Write-Title($text) {
  Write-Host ""
  Write-Host "==============================================" -ForegroundColor DarkCyan
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host "==============================================" -ForegroundColor DarkCyan
}
function Write-Info($text) { Write-Host "  $text" }
function Write-Ok($text)   { Write-Host "  [OK] $text"  -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [!]  $text"  -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "  [X]  $text"  -ForegroundColor Red }

function Test-Admin {
  try {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

function Get-PhotoshopInfo {
  $results = @()
  $seen = @{}
  $roots = @("HKLM:\SOFTWARE\Adobe\Photoshop", "HKLM:\SOFTWARE\WOW6432Node\Adobe\Photoshop")
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($key in (Get-ChildItem $root -ErrorAction SilentlyContinue)) {
      $ver = $key.PSChildName
      if ($seen.ContainsKey($ver)) { continue }
      $seen[$ver] = $true
      $props = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
      $name = $props.ProductName
      if (-not $name) { $name = "Adobe Photoshop" }
      $path = $props.ApplicationPath
      if (-not $path) { $path = "" }
      $results += [pscustomobject]@{ Version = $ver; Name = $name; Path = $path }
    }
  }
  foreach ($base in @(${env:ProgramFiles}, ${env:ProgramFiles(x86)})) {
    if (-not $base -or -not (Test-Path $base)) { continue }
    Get-ChildItem -Path $base -Filter "Adobe Photoshop*" -Directory -ErrorAction SilentlyContinue |
      ForEach-Object {
        if (-not $seen.ContainsKey($_.Name)) {
          $seen[$_.Name] = $true
          $results += [pscustomobject]@{ Version = $_.Name; Name = $_.Name; Path = $_.FullName }
        }
      }
  }
  return $results
}

function Get-CepExtensionDirs {
  $dirs = @()
  $candidates = @()
  if ($env:APPDATA)      { $candidates += (Join-Path $env:APPDATA "Adobe\CEP\extensions") }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Adobe\CEP\extensions") }
  if (${env:ProgramFiles})      { $candidates += (Join-Path ${env:ProgramFiles} "Common Files\Adobe\CEP\extensions") }
  if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} "Common Files\Adobe\CEP\extensions") }
  foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { $dirs += $c } }
  return $dirs
}

function Get-UserExtensionDir {
  return (Join-Path $env:APPDATA "Adobe\CEP\extensions")
}

function Get-MachineExtensionDir {
  if (${env:ProgramFiles(x86)}) {
    return (Join-Path ${env:ProgramFiles(x86)} "Common Files\Adobe\CEP\extensions")
  }
  return (Join-Path ${env:ProgramFiles} "Common Files\Adobe\CEP\extensions")
}

function Set-DebugMode([bool]$enable) {
  $versions = 5..25
  $hives = @("HKCU:\Software\Adobe")
  if (Test-Admin) { $hives += @("HKLM:\SOFTWARE\Adobe", "HKLM:\SOFTWARE\WOW6432Node\Adobe") }

  foreach ($hive in $hives) {
    foreach ($n in $versions) {
      $key = Join-Path $hive "CSXS.$n"
      if ($enable) {
        if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
        New-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" `
          -PropertyType String -Force | Out-Null
      } elseif ($RemoveDebugMode -and (Test-Path $key)) {
        Remove-ItemProperty -Path $key -Name "PlayerDebugMode" -ErrorAction SilentlyContinue
      }
    }
  }
}

function Remove-LinkOrDir($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  $item = Get-Item -LiteralPath $path -Force
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    cmd.exe /c "rmdir `"$path`"" | Out-Null
  } else {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
  return $true
}

function New-Junction($link, $target) {
  Remove-LinkOrDir $link | Out-Null
  $parent = Split-Path -Parent $link
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  try {
    New-Item -ItemType Junction -Path $link -Target $target -ErrorAction Stop | Out-Null
    return $true
  } catch {}
  try {
    cmd.exe /c "mklink /J `"$link`" `"$target`"" | Out-Null
  } catch {}
  return (Test-Path -LiteralPath $link)
}

function Copy-Plugin($dest) {
  Remove-LinkOrDir $dest | Out-Null
  Copy-Item -LiteralPath $PluginSrc -Destination $dest -Recurse -Force
}

function Install-Plugin {
  if (-not (Test-Path -LiteralPath (Join-Path $PluginSrc "CSXS\manifest.xml"))) {
    Write-Err "找不到插件源目录：$PluginSrc"
    return $false
  }

  Write-Title "安装插件"
  Write-Info "插件源目录 : $PluginSrc"
  Write-Info "扩展包 ID   : $BundleId"

  Write-Info "检测 Photoshop…"
  $ps = Get-PhotoshopInfo
  if ($ps.Count -gt 0) {
    foreach ($p in $ps) { Write-Ok "$($p.Name)  [$($p.Version)]  $($p.Path)" }
  } else {
    Write-Warn "未检测到已安装的 Photoshop（不影响安装，打开 PS 后即可使用）"
  }

  Write-Info "索引 CEP 扩展目录…"
  $dirs = Get-CepExtensionDirs
  if ($dirs.Count -gt 0) {
    foreach ($d in $dirs) { Write-Ok $d }
  } else {
    Write-Warn "未发现现成的 CEP 扩展目录，将创建当前用户目录"
  }

  Write-Info "写入 PlayerDebugMode（解决未签名扩展被拒绝加载）…"
  Set-DebugMode $true
  Write-Ok "已为当前用户写入 CSXS.5 ~ CSXS.25"

  $admin = Test-Admin
  if ($admin) { Write-Ok "检测到管理员权限，已同时写入 HKLM" }
  else { Write-Warn "非管理员运行，仅写入当前用户 HKCU（这正是 Photoshop 读取的位置）" }

  $targetDir = Get-UserExtensionDir
  if ($AllUsers) {
    if ($admin) { $targetDir = Get-MachineExtensionDir }
    else { Write-Warn "-AllUsers 需要管理员权限，已回退到当前用户目录" }
  }

  $dest = Join-Path $targetDir $PluginName

  if ($Copy) {
    Copy-Plugin $dest
    Write-Ok "已复制到：$dest"
  } else {
    if (New-Junction $dest $PluginSrc) {
      Write-Ok "已创建目录联接：$dest"
      Write-Info "        -> $PluginSrc"
    } else {
      Write-Warn "目录联接创建失败，改用复制方式"
      Copy-Plugin $dest
      Write-Ok "已复制到：$dest"
    }
  }

  $debugFile = Join-Path $dest ".debug"
  New-Item -ItemType File -Path $debugFile -Force | Out-Null
  Write-Ok "已放置 .debug 标记（强制以调试模式加载，绕过签名校验）"

  Write-Title "安装完成"
  Write-Info "1) 完全退出并重启 Photoshop"
  Write-Info "2) 菜单：窗口 > 扩展(旧版) > 批量调整工具"
  return $true
}

function Uninstall-Plugin {
  Write-Title "卸载插件"

  $targets = @()
  $targets += (Join-Path (Get-UserExtensionDir) $PluginName)
  $targets += (Join-Path (Get-MachineExtensionDir) $PluginName)

  $removed = 0
  foreach ($t in $targets) {
    if (Remove-LinkOrDir $t) { Write-Ok "已移除：$t"; $removed++ }
  }
  if ($removed -eq 0) { Write-Warn "未找到已安装的插件目录" }

  if (Test-Path -LiteralPath (Join-Path $PluginSrc ".debug")) {
    Remove-Item -LiteralPath (Join-Path $PluginSrc ".debug") -Force -ErrorAction SilentlyContinue
  }

  if ($RemoveDebugMode) {
    Set-DebugMode $false
    Write-Ok "已移除 PlayerDebugMode 注册表项"
  } else {
    Write-Info "已保留 PlayerDebugMode（如需一并清除，请加 -RemoveDebugMode）"
  }

  Write-Title "卸载完成"
  Write-Info "请重启 Photoshop"
  return $true
}

if ($Uninstall) {
  Uninstall-Plugin | Out-Null
} else {
  Install-Plugin | Out-Null
}
