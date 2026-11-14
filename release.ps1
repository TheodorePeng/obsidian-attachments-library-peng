<#
.SYNOPSIS
    Publish a BRAT-installable Obsidian plugin release.

.DESCRIPTION
    The whole chain lives in this script: version bump, verification, commit,
    tag, push, and the GitHub Release with the three BRAT assets (main.js,
    manifest.json, styles.css).

    The tag-triggered workflow in .github/workflows/release.yml is NOT relied
    upon. It has never produced a single workflow run for this repository, so
    the Release is created here. If a workflow ever does create the Release
    first, this script detects it and replaces the assets with the local build
    instead of failing.

    The steps are ordered so that nothing tracked is modified until every check
    has passed: validation, then notes, then verification, and only then the
    version bump, commit, tag, push and publish. A failing build therefore
    leaves the working tree untouched.

.PARAMETER Version
    New version in x.y.z semver format (e.g. 1.6.2).

.PARAMETER NotesFile
    Release notes in Markdown (English + Chinese). When omitted, a bilingual
    draft is generated from the commits since the previous tag.

.PARAMETER DryRun
    Print every command instead of running it. Nothing is written, committed,
    pushed, tagged, or published.
#>
param(
    [Parameter(Mandatory, Position = 0, HelpMessage = "New version in x.y.z semver format (e.g. 1.0.3)")]
    [string]$Version,

    [Parameter(HelpMessage = "Release notes in Markdown (English + Chinese)")]
    [string]$NotesFile = '',

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Phase 1: validate (reads only, changes nothing) ─────────────────────────

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "Version must follow x.y.z semver (e.g. 1.0.3)"
    exit 1
}

$status = git status --porcelain
if ($status) {
    Write-Error "Working tree has uncommitted changes — commit or stash first."
    exit 1
}

$existingTag = git tag --list | Where-Object { $_ -eq $Version }
if ($existingTag) {
    Write-Error "Tag '$Version' already exists — never retag an existing version."
    exit 1
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub CLI (gh) is not installed."
    exit 1
}
gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error "GitHub CLI is not authenticated — run 'gh auth login' first."
    exit 1
}

if ($NotesFile -and -not (Test-Path $NotesFile)) {
    Write-Error "Notes file not found: $NotesFile"
    exit 1
}

# ── Repository identity ──────────────────────────────────────────────────────
#
# This repository also has an 'upstream' remote, so the slug is always taken
# from 'origin' and passed explicitly via --repo. Without it gh may pick the
# wrong remote and publish to the upstream project.

$originUrl = (git remote get-url origin).Trim()
$slug = $originUrl -replace '^https?://[^/]+/', '' -replace '^git@[^:]+:', '' -replace '\.git$', ''
if (-not $slug -or $slug -eq 'origin') {
    Write-Error "Cannot resolve owner/repo from the 'origin' remote."
    exit 1
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$semverTags = @(git tag | Where-Object { $_ -match '^\d+\.\d+\.\d+$' })
$prevTag = $null
if ($semverTags.Count -gt 0) {
    $prevTag = ($semverTags | Sort-Object { [version]$_ } | Select-Object -Last 1)
}
if ($prevTag) { $logRange = "$prevTag..HEAD" } else { $logRange = 'HEAD' }

function Invoke-Step {
    param([string]$Command)
    if ($DryRun) {
        Write-Host "    + $Command"
    }
    else {
        # Out-Host keeps command output out of the pipeline, so it cannot leak
        # into a function's return value.
        Invoke-Expression $Command | Out-Host
    }
}

# ── Phase 2: release notes (written to a temp file, never to the tree) ───────

function Get-NoteBody {
    param([ValidateSet('en', 'zh')][string]$Mode)
    $subjects = @(git log --no-merges --pretty=format:'%s' $logRange)
    foreach ($subject in $subjects) {
        if (-not $subject) { continue }
        $clean = $subject -replace '^[a-z]+(\([^)]*\))?:\s*', ''
        if ($Mode -eq 'zh') {
            if ($subject -match '^feat') { "- 新功能：$clean" }
            elseif ($subject -match '^fix') { "- 修复：$clean" }
            elseif ($subject -match '^docs') { "- 文档：$clean" }
            else { "- 维护：$subject" }
        }
        else {
            if ($subject -match '^feat') { "- Feature: $clean" }
            elseif ($subject -match '^fix') { "- Fix: $clean" }
            elseif ($subject -match '^docs') { "- Documentation: $clean" }
            else { "- Maintenance: $subject" }
        }
    }
}

$generatedNotes = $null
if ($NotesFile) {
    $notesOut = (Resolve-Path $NotesFile).Path
    Write-Host "==> Using release notes from $notesOut"
}
elseif ($DryRun) {
    $notesOut = "(auto-generated from $logRange)"
    Write-Host "==> Would generate bilingual notes from $logRange"
}
else {
    $generatedNotes = Join-Path ([System.IO.Path]::GetTempPath()) ("brat-release-notes-" + [System.IO.Path]::GetRandomFileName())
    $minApp = (Get-Content manifest.json -Raw | ConvertFrom-Json).minAppVersion
    $body = @(
        '## Changes'
        (Get-NoteBody -Mode en)
        ''
        '## 变更说明'
        (Get-NoteBody -Mode zh)
        ''
        '## Requirements'
        "- Minimum Obsidian version is unchanged: ``$minApp``."
        "- Installed through BRAT from ``$slug``; each release ships ``main.js``, ``manifest.json`` and ``styles.css``."
    ) -join "`n"
    [System.IO.File]::WriteAllText($generatedNotes, $body, (New-Object System.Text.UTF8Encoding $false))
    $notesOut = $generatedNotes
    Write-Host "==> Generated release notes at $notesOut"
}

# ── Phase 3: verify (only touches gitignored build output) ───────────────────

Write-Host "==> Running pipeline (lint + tests + build)"
Invoke-Step 'npm run pipeline'
if (-not $DryRun -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Running acceptance scripts"
Invoke-Step 'node --experimental-strip-types --test tests/file-policy.acceptance.mjs tests/base-formulas.acceptance.mjs tests/gallery-config.acceptance.mjs tests/target-selection.acceptance.mjs'
if (-not $DryRun -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# ── Phase 4: bump, commit, tag, push (changes tracked files) ────────────────
#
# Node edits manifest.json and versions.json so both scripts produce
# byte-identical JSON. PowerShell's ConvertTo-Json would reorder keys and
# Set-Content -Encoding UTF8 on Windows PowerShell 5.1 writes a BOM, which
# breaks manifest.json parsing in Obsidian and BRAT.

Write-Host "==> Updating version to $Version"

if ($DryRun) {
    Write-Host "    + node: set manifest.json version = $Version, versions.json[`"$Version`"] = minAppVersion"
    Write-Host "    + npm version $Version --no-git-tag-version"
}
else {
    $bumpScript = @"
const fs = require('fs');
const version = '$Version';
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
if (typeof manifest.minAppVersion !== 'string' || !manifest.minAppVersion) {
    throw new Error('manifest.json is missing a minAppVersion string');
}
manifest.version = version;
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
if (fs.existsSync('versions.json')) {
    const versions = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
    versions[version] = manifest.minAppVersion;
    fs.writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');
}
"@
    node -e $bumpScript
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm version $Version --no-git-tag-version --silent
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "==> Committing release metadata"
Invoke-Step 'git add -- manifest.json package.json package-lock.json versions.json'
if (-not $DryRun -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Invoke-Step "git commit -m `"chore: release $Version`""
if (-not $DryRun -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Creating tag $Version"
Invoke-Step "git tag $Version"
if (-not $DryRun -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Pushing commit and tag"
Invoke-Step "git push origin $branch"
if (-not $DryRun -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Invoke-Step "git push origin $Version"
if (-not $DryRun -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# ── Phase 5: GitHub release ──────────────────────────────────────────────────
#
# The Release is the BRAT distribution source: BRAT downloads main.js,
# manifest.json and styles.css from it, so all three must be uploaded.

Write-Host "==> Publishing GitHub Release $Version"

function Publish-Release {
    gh release view $Version --repo $slug *> $null
    if ($LASTEXITCODE -eq 0) {
        # A workflow or an earlier attempt already created it: replace the
        # assets with the local build and (re)apply the notes.
        Invoke-Step "gh release upload $Version main.js manifest.json styles.css --repo $slug --clobber"
        Invoke-Step "gh release edit $Version --repo $slug --notes-file `"$notesOut`" --draft=false --latest"
        return 0
    }
    Invoke-Step "gh release create $Version --repo $slug --verify-tag --title $Version --notes-file `"$notesOut`" --latest main.js manifest.json styles.css"
    if ($DryRun) { return 0 }
    if ($LASTEXITCODE -eq 0) { return 0 }
    Write-Host "==> 'gh release create' failed — checking whether a Release already exists" -ForegroundColor Yellow
    gh release view $Version --repo $slug *> $null
    if ($LASTEXITCODE -eq 0) {
        Invoke-Step "gh release upload $Version main.js manifest.json styles.css --repo $slug --clobber"
        Invoke-Step "gh release edit $Version --repo $slug --notes-file `"$notesOut`" --draft=false --latest"
        return 0
    }
    return 1
}

if ((Publish-Release) -ne 0) {
    Write-Error "Could not publish the GitHub Release."
    exit 1
}

# Post-condition: BRAT cannot install without all three assets.
$requiredAssets = @('main.js', 'manifest.json')
if (Test-Path styles.css) { $requiredAssets += 'styles.css' }

if (-not $DryRun) {
    Write-Host "==> Checking the published assets"
    $published = @(gh release view $Version --repo $slug --json assets --jq '.assets[].name')
    $missing = @($requiredAssets | Where-Object { $published -notcontains $_ })
    if ($missing.Count -gt 0) {
        Write-Error "The published Release is missing assets: $($missing -join ', ')"
        exit 1
    }
    Write-Host "    all required assets present: $($requiredAssets -join ', ')"
}

Invoke-Step "gh release view $Version --repo $slug"

if ($generatedNotes -and (Test-Path $generatedNotes)) {
    Remove-Item $generatedNotes -Force
}

Write-Host ""
if ($DryRun) {
    Write-Host "✓ dry run only — nothing was written, committed, pushed, tagged or published."
}
else {
    Write-Host "✓ $Version tagged, pushed and published — BRAT 用户可直接安装或更新。"
}
