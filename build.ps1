# Auto CMake Flash 构建脚本（Windows PowerShell）
# 用法:
#   .\build.ps1              # 完整流程: install + compile + test + package
#   .\build.ps1 -SkipTests   # 跳过测试
#   .\build.ps1 -SkipPackage # 只编译测试，不打包
param(
    [switch]$SkipTests,
    [switch]$SkipPackage
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Step($msg) {
    Write-Host ""
    Write-Host "===== $msg =====" -ForegroundColor Cyan
}

Step "环境检查"
node --version
npm --version

Step "npm install"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }

Step "npm run compile"
npm run compile
if ($LASTEXITCODE -ne 0) { throw "编译失败" }

if (-not $SkipTests) {
    Step "npm test"
    npm test
    if ($LASTEXITCODE -ne 0) { throw "测试失败" }
}

if (-not $SkipPackage) {
    Step "vsce package"
    npx --yes @vscode/vsce package --allow-missing-repository --no-dependencies
    if ($LASTEXITCODE -ne 0) { throw "打包失败" }
    $vsix = Get-ChildItem -Path . -Filter *.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Write-Host ""
    Write-Host "VSIX 已生成: $($vsix.FullName)" -ForegroundColor Green
    Write-Host "安装到 VS Code:  code --install-extension `"$($vsix.Name)`""
    Write-Host "安装到 Trae CN:  & `"$env:LOCALAPPDATA\Programs\Trae CN\Trae CN.exe`" --install-extension `"$($vsix.Name)`""
}
