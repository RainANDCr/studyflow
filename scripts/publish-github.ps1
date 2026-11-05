#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$repository = 'RainANDCr/studyflow'
$tag = 'mobile-fixes-20261105-r2'
$baseline = '77b3d68be3b45a1debff99a950e2a1af9c77ae89'
$sourceRoot = Split-Path $PSScriptRoot -Parent

# Hashes identify the source and binaries verified for this release.
$sourceHashes = @{
    'src/app/App.tsx' = '687E8A9A5B58A9B000E91DCB30785539CD97A55B0E2013A10B6256D18ADB14DA'
    'src/app/useMobileTabSwipe.ts' = '201A244DD2C2165036DD0798F95F70D9FC146857E5643CFC4784FE7448FF24F5'
    'src/features/today/TodayPage.tsx' = '54EE7DBADB21DD7A5A0B133E3BCC423D5EE2DF6DC12811EAC1C94CFC0E510965'
    'src/features/weekly/WeeklyPage.tsx' = 'ABE8BEC1C773B199BD4EAEC72CBE9A44417153A0D3245D72FB559A475276B32F'
    'src/features/generic/Workspace.tsx' = 'A761A139DF6D6F6D7865D56765684580F38D1F03408A9D722807E0ADD5EB8195'
    'src/features/settings/SettingsPage.tsx' = '8A2DB23AEE02A83B4D800B743D9639F6FB2AD2C64A37F8AB74866F8F206F641E'
    'src/storage/sqlite.ts' = '97166DE53AD3E9BD21E4DD95C59C5B231E5B64FDDF836028E5D545449C6326EB'
    'src/tests/mobile-swipe.test.tsx' = '990B8D55D00F6CD89E29D6FE58664B4604BFE66FE74A6A62DB4DCDF502FF01BC'
    'src-tauri/Cargo.toml' = 'F195BE6786019739BD6FF408035DF09582AD7F4086BF9E61178AF66B0E7EE138'
    'src-tauri/Cargo.lock' = 'EBDDA3AE1311B10AE7BEFBEFBB0820882D1E887D1BCC6C5F75507F2D4B634EE5'
    'src-tauri/src/lib.rs' = '7B77C27AC965D2D5473308402D9693CDE42BCC582AE470C44918A740FB91971A'
    'src-tauri/android/MainActivity.kt' = 'CA79C2CD12058774CEAD477C911B85AB404E2FA4A6B52FCE8DD196A88E3A3543'
    'scripts/prepare-android.mjs' = 'E48A5AD8CFFE03E93EFB1EF628A194BA07F62742A08BA37CABD65006A81D0E6C'
    'package.json' = '223336D1FC6287BA3C86479650CF89D64D0DB479BA5C4010B5F53EEBA4A2C737'
}
$assetHashes = @{
    'StudyFlow-Android-arm64-20261105-r2.apk' = '41757A95A08F356DD4366B28376D875203C7C42CE2F2DD7DE07783F5F440934F'
    'StudyFlow-Windows-x64-20261105-r2.exe' = 'FB76C7D5236447123F18B5708B70802E9E6A1D5D85203A6B591AF36055825B0B'
}

function Invoke-Checked {
    param([string]$Executable, [string[]]$CommandArgs)
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Executable @CommandArgs
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -ne 0) {
        throw "Command failed (exit $exitCode): $Executable $($CommandArgs[0])"
    }
}

$git = Get-Command git -ErrorAction SilentlyContinue
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (!$git) { throw 'Install Git for Windows before running this script.' }
if (!$gh) { throw 'Install GitHub CLI: winget install --id GitHub.cli --exact. Then reopen PowerShell.' }

foreach ($entry in $sourceHashes.GetEnumerator()) {
    $path = Join-Path $sourceRoot $entry.Key
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.Value) {
        throw "Source changed since r2 was built: $($entry.Key)"
    }
}
foreach ($entry in $assetHashes.GetEnumerator()) {
    $path = Join-Path $sourceRoot ('release-artifacts/' + $entry.Key)
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.Value) {
        throw "Release file differs from verified r2: $($entry.Key)"
    }
}

try {
    Invoke-Checked $gh.Source @('auth', 'status', '--hostname', 'github.com') | Out-Host
} catch {
    throw 'First run: gh auth login --hostname github.com --git-protocol https --web --scopes workflow'
}
$account = ((Invoke-Checked $gh.Source @('api', 'user')) -join "`n") | ConvertFrom-Json
$canPush = (Invoke-Checked $gh.Source @('api', "repos/$repository", '--jq', '.permissions.push')) -join ''
if ($canPush.Trim() -ne 'true') { throw "The logged-in account cannot push to $repository." }

$work = Join-Path $env:TEMP ('StudyFlow-publish-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
Write-Host "Working copy: $work"
# Configure credentials for these commands only, using the user's gh login.
$credentialArgs = @('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential')
Invoke-Checked $git.Source ($credentialArgs + @('clone', '--branch', 'main', '--single-branch', "https://github.com/$repository.git", $work)) | Out-Host

function Invoke-PublishGit {
    param([string[]]$CommandArgs)
    Invoke-Checked $git.Source ($credentialArgs + @('-C', $work) + $CommandArgs)
}

$remoteHead = (Invoke-PublishGit @('rev-parse', 'origin/main')) -join ''
$remoteTree = (Invoke-PublishGit @('rev-parse', 'origin/main:')) -join ''
Invoke-PublishGit @('checkout', '--detach', $baseline) | Out-Host
$files = @($sourceHashes.Keys) + @('.github/workflows/release.yml', 'scripts/publish-github.ps1')
foreach ($name in $files) {
    $target = Join-Path $work $name
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $target -Force
}
Invoke-PublishGit (@('add', '--') + $files) | Out-Host
$expectedTree = (Invoke-PublishGit @('write-tree')) -join ''
if ($remoteTree -eq $expectedTree) {
    $commit = $remoteHead
    Write-Host 'Matching source is already uploaded.'
} elseif ($remoteHead -eq $baseline) {
    Invoke-PublishGit @('config', 'user.name', $account.login) | Out-Host
    Invoke-PublishGit @('config', 'user.email', "$($account.id)+$($account.login)@users.noreply.github.com") | Out-Host
    Invoke-PublishGit @('commit', '-m', 'fix: mobile layouts, JSON imports, swipe transitions and release automation') | Out-Host
    $commit = (Invoke-PublishGit @('rev-parse', 'HEAD')) -join ''
    Invoke-PublishGit @('push', 'origin', 'HEAD:refs/heads/main') | Out-Host
} else {
    throw 'Remote main has other changes. Reconcile them before publishing this snapshot.'
}

$releases = ((Invoke-Checked $gh.Source @('api', "repos/$repository/releases?per_page=100")) -join "`n") | ConvertFrom-Json
$release = @($releases | Where-Object tag_name -EQ $tag | Select-Object -First 1)
if ($release.Count) { $release = $release[0] } else { $release = $null }
if (!$release) {
    $notes = Join-Path $work 'release-notes.md'
    @'
- Fix Android JSON imports and support v1-v4 backups.
- Fix mobile headings, weekly date navigation and system-theme button layout.
- Respect Android status bars, display cutouts and keyboard insets.
- Add left/right navigation with directional 240 ms transitions.
- Verified with 179 tests and mobile browser layout/animation checks.

Downloads
- Android ARM64 APK, signed with the same certificate as the previous APK.
- Windows x64 portable EXE.

The application version remains 0.2.0. This is the 2026-11-05 r2 build.
'@ | Set-Content -LiteralPath $notes -Encoding UTF8
    Invoke-Checked $gh.Source @('release', 'create', $tag, '--repo', $repository, '--target', $commit, '--draft', '--title', 'StudyFlow mobile fixes - 2026-11-05 r2', '--notes-file', $notes) | Out-Host
    $release = ((Invoke-Checked $gh.Source @('api', "repos/$repository/releases/tags/$tag")) -join "`n") | ConvertFrom-Json
}
if ($release.target_commitish -ne $commit) { throw 'The existing release points to a different commit.' }

$downloadDir = Join-Path $work 'verify-release'
New-Item -ItemType Directory -Path $downloadDir | Out-Null
foreach ($entry in $assetHashes.GetEnumerator()) {
    $release = ((Invoke-Checked $gh.Source @('api', "repos/$repository/releases/$($release.id)")) -join "`n") | ConvertFrom-Json
    $existing = @($release.assets | Where-Object name -EQ $entry.Key)
    if (!$existing.Count) {
        Invoke-Checked $gh.Source @('release', 'upload', $tag, (Join-Path $sourceRoot ('release-artifacts/' + $entry.Key)), '--repo', $repository) | Out-Host
    }
    # Download to verify bytes, including assets retained after an interrupted run.
    Invoke-Checked $gh.Source @('release', 'download', $tag, '--repo', $repository, '--pattern', $entry.Key, '--dir', $downloadDir) | Out-Host
    if ((Get-FileHash -LiteralPath (Join-Path $downloadDir $entry.Key) -Algorithm SHA256).Hash -ne $entry.Value) {
        throw "Uploaded asset checksum differs: $($entry.Key)"
    }
}
if ($release.draft) {
    Invoke-Checked $gh.Source @('release', 'edit', $tag, '--repo', $repository, '--draft=false', '--latest') | Out-Host
}
$published = ((Invoke-Checked $gh.Source @('api', "repos/$repository/releases/tags/$tag")) -join "`n") | ConvertFrom-Json
if ($published.draft -or @($published.assets | Where-Object name -In @($assetHashes.Keys)).Count -ne 2) {
    throw 'Release publication is incomplete.'
}
Write-Host 'Published successfully.'
Write-Host "Source: https://github.com/$repository/commit/$commit"
Write-Host "Release: $($published.html_url)"
Write-Host "Website deployment: https://github.com/$repository/actions/workflows/pages.yml"
