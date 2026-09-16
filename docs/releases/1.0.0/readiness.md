# 1.0.0 Readiness Record

Release decision: NOT READY
Source commit: 2915687ebd656444054387fa474e0393bf420d7b (branch `fix/1.0-export-integrity`, local `main` clean before branching)
Runtime: Node v24.16.0, npm 11.13.0, macOS 27.0 (26A428, arm64); Obsidian version not yet measured — native acceptance pending (T6)

| Gate | Status | Source commit / artifact SHA-256 | Evidence | Remaining action |
|---|---|---|---|---|
| Baseline | PASS | 2915687ebd656444054387fa474e0393bf420d7b | 2026-09-15 local run: `npm run check:version` ("Version metadata is consistent: 0.7.4"), `npm run lint:obsidian-warnings`, `npm run build`, `npm test` (20 files, 360 tests passed) — all exit 0. Remote read-only: 0 open issues, 0 open PRs; release 0.7.4 (published 2026-08-26) with `main.js`, `manifest.json`, `styles.css`; latest `verify` runs green including HEAD 2915687. No vault plugin symlink present, so builds cannot update a live plugin. | T0 complete |
| Output integrity | PASS | this branch's `fix: preserve existing export documents and assets` commit | T1 reproduced the overwrite corruption as required (expected `[1]`, received `[2]` in `src/export/ExportIntegrity.test.ts`). T2 added directory isolation, exclusive writes (`wx` external / create-only vault), report-name protection and a 10-case regression matrix. 2026-09-16: five export suites 145/145, full suite 378/378, lint and build exit 0. | T6 reruns the two-run case through the native export dialog |
| Outcomes | NOT RUN | Unmeasured | No run recorded | Execute T3-T4 |
| Headless artifacts | NOT RUN | Unmeasured | No run recorded | Execute T5 |
| Native artifacts | NOT RUN | Unmeasured | No run recorded | Execute T6 |
| Platforms | NOT RUN | Unmeasured | No run recorded | Execute T6 |
| Documentation | NOT RUN | Unmeasured | No review recorded | Execute T7 |
| Release gate | NOT RUN | Unmeasured | No run recorded | Execute T8 |
| Upgrade / candidate | NOT RUN | Unmeasured | No run recorded | Execute T9 |
| Published assets | NOT RUN | Unmeasured | Not published | Execute T10 |
