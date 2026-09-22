---
fingerprint: d0904df1
slug: website-preview-applies-retired-rendering-effect
title: Website preview applies retired rendering effects and implies live work
surface: world
severity: P2
status: open
found: 2026-09-22
lane: agent/website-demo-0921
fix:
origin: owner
report: Owner screenshot and website request, 2026-09-21
affected: starnetos.com production on 2026-09-21
family: website-preview
installer: unverified
recovery: unconfirmed
---

# Website preview applies retired rendering effects and implies live work

## Symptom

Owner reports an ugly, inaccurate website demo. The deployed starter room appears muddy and colour-fringed, with a live-preview caption although no backend executes tasks. It also contains one desk instead of the current starter factory's eight props and uses obsolete floor/wall/hull materials.

## Repro

1. Open https://starnetos.com/#station before deployment of this lane.
2. Observe the embedded station and its live-preview caption.
3. Compare website/app/demo-boot.js overrides to frontend/app/worldrenderer.js PHOSPHOR settings.

## Evidence

Owner screenshot 2026-09-21; live browser reproduction on production and local staged source. test/website-live-preview.test.js verifies the versioned save refresh and current geometry; test/website-deploy-staging.test.js verifies the exact upload. Live local camera DOM measured 960x660; desktop and 390px mobile document widths stayed within the viewport.

## Verdict

Source changes: 4d22a0576 and ca30418c0. Removed retired CRT overrides and duplicate page glass, framed the complete hull with the actual renderer camera, and labeled the offline starter layout. Full gate and production deployment remain pending. Owner visual acceptance remains unconfirmed.

## Regression

Before: executing the trunk demo fixture produces one prop and null floor/wall/hull materials. The current WorldModel.starterDoc() produces eight props with resin/panelled/bone materials. test/website-live-preview.test.js now compares the entire generated station to that actual factory, including prop placement and workstation ownership. The same test covers one-time revision upgrades and preservation after the upgrade.



## Sibling coverage


