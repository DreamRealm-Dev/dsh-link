$ErrorActionPreference = "Stop"
# T52 world builder (frozen path, promoted from .tmp/r108-world.ps1 in R115).
# EVERY RUN DELETES AND REBUILDS THE WHOLE WORLD, so two callers must never run this concurrently:
# a second run removes the first one world under its feet and produces a false red. Serialise callers.
# Roots and inputs are derived or explicit, never hard-coded and never silently defaulted:
#   T52_PROJECT       default: the repository root, inferred from this script own location
#   T52_WORLD_ROOT    default: <project>/.tmp/r115-world
#   T52_LIVE_PROFILE  default: the live kernel profile under %APPDATA% (must exist: this world mirrors
#                     one real profile, so a missing one is a precondition failure, not a driver crash)
#   T52_MANIFEST      optional explicit manifest path; otherwise the local mounted manifest if present,
#                     otherwise the live profile manifest. Whichever is used, the world manifest MUST
#                     end up bundling dsh-link-compat: the plugin under test has to be in the world, and
#                     the live manifest does not carry that row (R115-F: the silent fallback hid this).
$project = $env:T52_PROJECT
if (-not $project) { $project = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }
$root = $env:T52_WORLD_ROOT
if (-not $root) { $root = Join-Path $project ".tmp\r115-world" }
$live = $env:T52_LIVE_PROFILE
if (-not $live) { $live = Join-Path $env:APPDATA "dev.dshlink.client\dsh-link\kernel-home\profiles\web" }
if (-not (Test-Path $live)) { "LIVE_PROFILE_MISSING: " + $live + " - this gate needs one real profile to mirror; set T52_LIVE_PROFILE"; exit 3 }
if (Test-Path $root) { Remove-Item $root -Recurse -Force }
$pw = Join-Path $root "home\profiles\web"
New-Item -ItemType Directory -Force -Path $pw | Out-Null
foreach ($f in "cordis.yml","compatibility.json") { $src = Join-Path $live $f; if (Test-Path $src) { Copy-Item $src (Join-Path $pw $f) } }
$mounted = Join-Path $project ".tmp\r91-home\profiles\web\package.json.mounted"
$manifestSource = $null
$manifestWhy = ""
if ($env:T52_MANIFEST) { $manifestSource = $env:T52_MANIFEST; $manifestWhy = "T52_MANIFEST" }
elseif (Test-Path $mounted) { $manifestSource = $mounted; $manifestWhy = "mounted" }
elseif (Test-Path (Join-Path $live "package.json")) { $manifestSource = Join-Path $live "package.json"; $manifestWhy = "live" }
if (-not $manifestSource) { "MANIFEST_MISSING: set T52_MANIFEST, or provide " + $mounted + ", or a live profile carrying package.json"; exit 3 }
$manifestTarget = Join-Path $pw "package.json"
Copy-Item $manifestSource $manifestTarget -Force
$manifest = Get-Content $manifestTarget -Raw | ConvertFrom-Json
$bundles = @($manifest.dsh.profile.bundles)
"BUNDLES_BEFORE=" + ($bundles -join ",")
if ($bundles -notcontains "dsh-link-compat") {
  $manifest.dsh.profile.bundles = @($bundles) + "dsh-link-compat"
  [System.IO.File]::WriteAllText($manifestTarget, ($manifest | ConvertTo-Json -Depth 40), (New-Object System.Text.UTF8Encoding($false)))
  "BUNDLES_APPENDED=1 (source=" + $manifestWhy + ")"
} else { "BUNDLES_APPENDED=0 (source=" + $manifestWhy + ")" }
$check = @((Get-Content $manifestTarget -Raw | ConvertFrom-Json).dsh.profile.bundles)
"BUNDLES_AFTER=" + ($check -join ",")
if ($check -notcontains "dsh-link-compat") { "MANIFEST_ASSERT_FAILED: dsh.profile.bundles still lacks dsh-link-compat after the append"; exit 2 }
"MANIFEST_OK=" + $manifestWhy
$nodes = Join-Path $pw "node_modules"
New-Item -ItemType Directory -Force -Path $nodes | Out-Null
Get-ChildItem $live\node_modules -Force | Where-Object { $_.Name -ne "dsh-link-compat" } | ForEach-Object { try { New-Item -ItemType Junction -Path (Join-Path $nodes $_.Name) -Target $_.FullName | Out-Null } catch { } }
"links=" + (Get-ChildItem $nodes -Force | Measure-Object).Count
$patched = Join-Path $root "patched-compat"
# R197: the shipped plugin now carries its OWN node_modules - a junction to the kernel's vendored schemastery.
# Windows PowerShell 5.1 Copy-Item -Recurse CHASES reparse points: inside that vendored tree it met
# node_modules/@deepseek-ai/cosmokit, whose target is a RELATIVE link (../../../cosmokit) that only resolves at
# the place it really lives, and the copy aborted with "Could not find a part of the path" - leaving a
# half-written patched copy and no world at all. So the patched copy holds the plugin's OWN files and REACHES
# its dependencies through a junction: it stays identical to the shipped plugin except for the one line below.
$source = Join-Path $project "plugins\dsh-link-compat"
New-Item -ItemType Directory -Force -Path $patched | Out-Null
Get-ChildItem $source -Force | Where-Object { $_.Name -ne "node_modules" } | ForEach-Object { Copy-Item -Path $_.FullName -Destination (Join-Path $patched $_.Name) -Recurse -Force }
if (Test-Path (Join-Path $source "node_modules")) { New-Item -ItemType Junction -Path (Join-Path $patched "node_modules") -Target (Join-Path $source "node_modules") | Out-Null }
$lib = Join-Path $patched "lib\index.js"
$text = Get-Content $lib -Raw
$repl = "spec.output ?? { type: " + [char]39 + "json" + [char]39 + " }"
$patchedText = $text -replace "spec\.output \?\? \{\}", $repl
if ($patchedText -eq $text) { "PATCH_MISS"; exit 2 }
# UTF-8 WITHOUT a BOM: PowerShell 5.1 Set-Content -Encoding UTF8 writes a BOM, and the patched file
# is byte-compared by the gate, so a BOM would be a silent difference in what the control is.
[System.IO.File]::WriteAllText($lib, $patchedText, (New-Object System.Text.UTF8Encoding($false)))
"PATCHED (default forced back to json)"
New-Item -ItemType Junction -Path (Join-Path $nodes "dsh-link-compat") -Target $patched | Out-Null
"world_ready=" + $pw
