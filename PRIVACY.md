# Privacy Policy

Last updated: March 10, 2026

## Overview

PlanMyPeak Importer is a browser extension for reading TrainingPeaks data and
exporting it to supported destinations. The extension runs locally in your
browser and talks directly to third-party services that you use.

This project is not affiliated with TrainingPeaks, PlanMyPeak, or Intervals.icu.

## Data Stored Locally

Depending on which features you use, the extension may store the following in
`chrome.storage.local`:

- TrainingPeaks bearer token and timestamp
- PlanMyPeak auth token and timestamp
- PlanMyPeak Supabase API key observed from browser requests
- Intervals.icu API key that you enter manually
- Export progress state, connection toggles, and local development port settings
- Debug logs that you explicitly generate while troubleshooting

This data is stored in the extension's local browser storage within your Chrome
profile. The extension does not add a separate application-level encryption
layer on top of `chrome.storage.local`.

## Network Requests

The extension makes direct requests to the following services:

- TrainingPeaks web and API endpoints to capture auth and read workout data
- `api.peakswaresb.com` (sandbox: `api.uat.peakswaresb.com`) for TrainingPeaks RxBuilder structured workout data
- PlanMyPeak APIs when PlanMyPeak features or auth validation are used
- PlanMyPeak Supabase auth endpoint to validate PlanMyPeak auth state
- Intervals.icu APIs when that integration is enabled and an API key is present

This repository does not include a separate telemetry or analytics backend.

## What We Do Not Do

- We do not sell your data
- We do not run analytics or ad trackers in the extension
- We do not ask you to paste TrainingPeaks session tokens manually
- We do not send your data to unrelated third-party services

## Permissions

The extension requests:

- `storage` to persist credentials, settings, and export progress locally
- `tabs` to find and focus TrainingPeaks or PlanMyPeak tabs for re-auth flows
- `notifications` to show export progress and completion state
- Host permissions for TrainingPeaks, PlanMyPeak, Intervals.icu, Supabase, and
  local development endpoints used by the app

See [docs/PRIVACY_AND_PERMISSIONS.md](./docs/PRIVACY_AND_PERMISSIONS.md) for a
full permission and host breakdown.

## User Control

You can:

- Remove stored credentials by clearing connection state in the extension UI
- Remove all extension data by uninstalling the extension
- Revoke provider access by rotating or revoking tokens and API keys on the
  provider side

## Security Notes

- Treat auth tokens and API keys as secrets
- Do not include raw tokens, API keys, or personal training data in public bug
  reports
- For sensitive disclosures, follow [SECURITY.md](./SECURITY.md)

## Contact

- General questions and bug reports:
  `https://github.com/PlanMyPeak/cycling_coach_browser_plugin/issues`
- Sensitive security matters: follow [SECURITY.md](./SECURITY.md)
