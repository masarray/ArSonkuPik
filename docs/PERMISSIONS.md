# Permissions

ArSonKuPik uses a narrow Manifest V3 permission set.

## `activeTab`

Used only after a direct user action to identify the active tab for audio enhancement.

## `tabCapture`

Required to capture the active tab's audio stream for local Web Audio processing.

## `offscreen`

Required because Manifest V3 service workers cannot host a persistent Web Audio graph. The offscreen document runs the local audio engine.

## `storage`

Used for local presets and UI settings.

## `contentSettings`

Used for local output-device unlock/routing behavior after explicit user action. It is not used to collect browsing history or website content.

## Not used

ArSonKuPik does not use:

- host permissions,
- content scripts,
- remote scripts,
- webRequest,
- scripting permission,
- tabs permission.
