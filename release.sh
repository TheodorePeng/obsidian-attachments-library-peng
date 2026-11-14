#!/usr/bin/env bash
set -euo pipefail

# Publish a BRAT-installable Obsidian plugin release.
#
# The whole chain lives in this script: version bump, verification, commit,
# tag, push, and the GitHub Release with the three BRAT assets (main.js,
# manifest.json, styles.css).
#
# The tag-triggered workflow in .github/workflows/release.yml is NOT relied
# upon. It has never produced a single workflow run for this repository, so
# the Release is created here. If a workflow ever does create the Release
# first, this script detects it and replaces the assets with the local build
# instead of failing.

usage() {
    cat <<'EOF'
Usage: release.sh <version> [options]

  <version>            New version in x.y.z semver format (e.g. 1.6.2)

Options:
  --notes-file FILE    Release notes in Markdown (English + Chinese). When
                       omitted, a bilingual draft is generated from the
                       commits since the previous tag.
  --dry-run            Print every command instead of running it. Nothing is
                       written, committed, pushed, tagged, or published.
  -h, --help           Show this help.

Steps: bump versions -> lint / test / build -> commit -> tag -> push -> Release.
EOF
}

VERSION=""
NOTES_FILE=""
DRY_RUN=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --notes-file)
            if [ "$#" -lt 2 ]; then echo "Error: --notes-file needs a path" >&2; exit 1; fi
            NOTES_FILE="$2"; shift 2 ;;
        --notes-file=*) NOTES_FILE="${1#*=}"; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -*) echo "Error: unknown option $1" >&2; usage; exit 1 ;;
        *)
            if [ -n "$VERSION" ]; then echo "Error: only one version may be given" >&2; exit 1; fi
            VERSION="$1"; shift ;;
    esac
done

# ── Validate ────────────────────────────────────────────────────────────────

if [ -z "$VERSION" ]; then
    echo "Error: version is required" >&2
    usage
    exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: version must follow x.y.z semver (e.g. 1.0.3)" >&2
    exit 1
fi

if ! git diff --quiet || ! git diff --staged --quiet; then
    echo "Error: working tree has uncommitted changes — commit or stash first" >&2
    exit 1
fi

if git tag --list | grep -qx "$VERSION"; then
    echo "Error: tag '$VERSION' already exists — never retag an existing version" >&2
    exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
    echo "Error: GitHub CLI is not authenticated — run 'gh auth login' first" >&2
    exit 1
fi

# ── Repository identity ─────────────────────────────────────────────────────
#
# This repository also has an 'upstream' remote, so the slug is always taken
# from 'origin' and passed explicitly via --repo. Without it gh may pick the
# wrong remote and publish to the upstream project.

SLUG="$(git remote get-url origin | sed -E 's#^https?://[^/]+/##; s#^git@[^:]+:##; s#\.git$##')"
if [ -z "$SLUG" ] || [ "$SLUG" = "origin" ]; then
    echo "Error: cannot resolve owner/repo from the 'origin' remote" >&2
    exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
PREV_TAG="$( { git tag | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' || true; } | sort -V | tail -n 1)"
if [ -n "$PREV_TAG" ]; then
    LOG_RANGE="$PREV_TAG..HEAD"
else
    LOG_RANGE="HEAD"
fi

run() {
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '    + %s\n' "$*"
    else
        "$@"
    fi
}

# ── Bump versions ───────────────────────────────────────────────────────────

echo "==> Updating version to $VERSION"

if [ "$DRY_RUN" -eq 1 ]; then
    echo "    + node: set manifest.json version = $VERSION, versions.json[\"$VERSION\"] = minAppVersion"
    echo "    + npm version $VERSION --no-git-tag-version"
else
    node -e "
const fs = require('fs');
const version = '$VERSION';
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
"
    npm version "$VERSION" --no-git-tag-version --silent
fi

# ── Build & test ─────────────────────────────────────────────────────────────

echo "==> Running pipeline (lint + tests + build)"
run npm run pipeline

echo "==> Running acceptance scripts"
run node --experimental-strip-types --test tests/file-policy.acceptance.mjs tests/base-formulas.acceptance.mjs tests/gallery-config.acceptance.mjs tests/target-selection.acceptance.mjs

# ── Commit, tag, push ───────────────────────────────────────────────────────

echo "==> Committing release metadata"
run git add -- manifest.json package.json package-lock.json versions.json
run git commit -m "chore: release $VERSION"

echo "==> Creating tag $VERSION"
run git tag "$VERSION"

echo "==> Pushing commit and tag"
run git push origin "$BRANCH"
run git push origin "$VERSION"

# ── Release notes ───────────────────────────────────────────────────────────

GENERATED_NOTES=""
notes_body() {
    local mode="$1" subject clean
    git log --no-merges --pretty=tformat:'%s' "$LOG_RANGE" | while IFS= read -r subject; do
        [ -n "$subject" ] || continue
        clean="${subject#*: }"
        case "$subject" in
            feat*|fix*|docs*) ;;
            *) clean="$subject" ;;
        esac
        if [ "$mode" = "zh" ]; then
            case "$subject" in
                feat*) printf -- '- 新功能：%s\n' "$clean" ;;
                fix*)  printf -- '- 修复：%s\n' "$clean" ;;
                docs*) printf -- '- 文档：%s\n' "$clean" ;;
                *)     printf -- '- 维护：%s\n' "$clean" ;;
            esac
        else
            case "$subject" in
                feat*) printf -- '- Feature: %s\n' "$clean" ;;
                fix*)  printf -- '- Fix: %s\n' "$clean" ;;
                docs*) printf -- '- Documentation: %s\n' "$clean" ;;
                *)     printf -- '- Maintenance: %s\n' "$clean" ;;
            esac
        fi
    done
}

if [ -n "$NOTES_FILE" ]; then
    if [ ! -f "$NOTES_FILE" ]; then
        echo "Error: notes file not found: $NOTES_FILE" >&2
        exit 1
    fi
    NOTES_OUT="$NOTES_FILE"
    echo "==> Using release notes from $NOTES_OUT"
elif [ "$DRY_RUN" -eq 1 ]; then
    NOTES_OUT="(auto-generated from $LOG_RANGE)"
    echo "==> Would generate bilingual notes from $LOG_RANGE"
else
    NOTES_OUT="$(mktemp -t brat-release-notes)"
    GENERATED_NOTES="$NOTES_OUT"
    {
        echo "## Changes"
        notes_body en
        echo
        echo "## 变更说明"
        notes_body zh
        echo
        echo "## Requirements"
        echo "- Minimum Obsidian version is unchanged: \`$(node -p "require('./manifest.json').minAppVersion")\`."
        echo "- Installed through BRAT from \`$SLUG\`; each release ships \`main.js\`, \`manifest.json\` and \`styles.css\`."
    } > "$NOTES_OUT"
    echo "==> Generated release notes at $NOTES_OUT"
fi

# ── GitHub release ───────────────────────────────────────────────────────────
#
# The Release is the BRAT distribution source: BRAT downloads main.js,
# manifest.json and styles.css from it, so all three must be uploaded.

echo "==> Publishing GitHub Release $VERSION"

publish_release() {
    if gh release view "$VERSION" --repo "$SLUG" >/dev/null 2>&1; then
        # A workflow or an earlier attempt already created it: replace the
        # assets with the local build and (re)apply the notes.
        run gh release upload "$VERSION" main.js manifest.json styles.css --repo "$SLUG" --clobber
        run gh release edit "$VERSION" --repo "$SLUG" --notes-file "$NOTES_OUT" --draft=false --latest
        return 0
    fi
    if run gh release create "$VERSION" --repo "$SLUG" --verify-tag --title "$VERSION" \
        --notes-file "$NOTES_OUT" --latest main.js manifest.json styles.css; then
        return 0
    fi
    echo "==> 'gh release create' failed — checking whether a Release already exists" >&2
    if gh release view "$VERSION" --repo "$SLUG" >/dev/null 2>&1; then
        run gh release upload "$VERSION" main.js manifest.json styles.css --repo "$SLUG" --clobber
        run gh release edit "$VERSION" --repo "$SLUG" --notes-file "$NOTES_OUT" --draft=false --latest
        return 0
    fi
    return 1
}

publish_release || { echo "Error: could not publish the GitHub Release" >&2; exit 1; }

run gh release view "$VERSION" --repo "$SLUG"

if [ -n "$GENERATED_NOTES" ] && [ -f "$GENERATED_NOTES" ]; then
    rm -f "$GENERATED_NOTES"
fi

echo ""
echo "✓ $VERSION tagged, pushed and published — BRAT 用户可直接安装或更新。"
