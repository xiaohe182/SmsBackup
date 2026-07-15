# Android Resilient Location Tracking Implementation Plan

**Goal:** Add user-controlled three-minute background location sampling, local route analysis, protected contacts, and device diagnostics across Android 8+ devices.

**Architecture:** A native location foreground service persists raw points in a dedicated SQLite database. TypeScript adapters parse native data, a pure domain module cleans and analyzes routes, and a uni-app page controls permissions, tracking, diagnostics and visualization.

## Tasks

1. Add failing route-analysis tests for distance, accuracy, jumps and sessions; implement `src/domain/route-analysis.ts`.
2. Add failing TypeScript service tests; implement `src/services/location-tracking.ts` and native declarations/stubs.
3. Add failing native contracts; implement manifest permissions, `LocationDatabase.kt`, `LocationRepository.kt`, `LocationTrackingService.kt`, notification stop receiver and UTS bridge methods.
4. Add failing contacts/device service and native contracts; implement explicit contact permission, protected contact reading, battery, memory, storage, network and device diagnostics.
5. Add failing page contracts; implement a protected device-data page with route, contacts and diagnostics tabs, page registration and home entry.
6. Update Android test checklist and privacy documentation.
7. Run focused tests, full tests, type checking and app-plus build.
