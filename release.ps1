param(
    [Parameter(Mandatory, Position = 0, HelpMessage = "New version in x.y.z semver format (e.g. 1.0.3)")]
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Validate ─────────────────────────────────────────────────────────────────

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

# ── Bump versions ─────────────────────────────────────────────────────────────

Write-Host "==> Updating version to $Version"

$manifest = Get-Content manifest.json -Raw | ConvertFrom-Json
$manifest.version = $Version
$manifest | ConvertTo-Json -Depth 10 | Set-Content manifest.json -Encoding UTF8 -NoNewline
Add-Content manifest.json "`n"

if (Test-Path versions.json) {
    $versions = Get-Content versions.json -Raw | ConvertFrom-Json
    $versions | Add-Member -NotePropertyName $Version -NotePropertyValue $manifest.minAppVersion -Force
    $versions | ConvertTo-Json -Depth 10 | Set-Content versions.json -Encoding UTF8 -NoNewline
    Add-Content versions.json "`n"
}

npm version $Version --no-git-tag-version --silent

# ── Build & test ──────────────────────────────────────────────────────────────

Write-Host "==> Running pipeline (lint + tests + build)"
npm run pipeline
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# ── Commit, tag, push ─────────────────────────────────────────────────────────

Write-Host "==> Committing version bump"
git add manifest.json package.json package-lock.json versions.json
git commit -m "Bump version to $Version"

Write-Host "==> Creating tag $Version"
git tag $Version

Write-Host "==> Pushing commit and tag"
git push
git push origin $Version

# ── GitHub release ────────────────────────────────────────────────────────────
#
# The Release itself is created by .github/workflows/release.yml, which runs on
# the tag push above and uploads main.js, manifest.json and styles.css.
# Do not run `gh release create` here: it would race that workflow and the
# manual asset list would omit styles.css.

Write-Host "==> GitHub release is created by .github/workflows/release.yml"
Write-Host "    Watch:  gh run watch"
Write-Host "    Check:  gh release view $Version"

Write-Host ""
Write-Host "Tagged & pushed $Version — GitHub Release 由 release workflow 创建。"
