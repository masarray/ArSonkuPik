# Chrome Web Store Eligibility Audit — ArSonKuPik v0.3.34

## Verdict

Status: **Eligible for closed/manual Chrome Web Store upload testing, with mandatory manual runtime testing before public submission.**

The extension now aligns with the main Chrome Web Store review expectations:

- Manifest V3
- Local packaged code only
- No remote scripts
- No host permissions
- No content injection
- No network calls
- Narrow single purpose
- Permissions are tied to the audio-enhancement function
- Privacy and permission disclosures are documented

## Key policy checks

| Area | Result | Notes |
|---|---:|---|
| Manifest V3 | Pass | `manifest_version: 3` |
| Remote code | Pass | No external script tags, no remote JS, no `eval()`, no `new Function()` |
| Single purpose | Pass | Local tab-audio enhancement only |
| Host permissions | Pass | Empty `host_permissions` |
| Content injection | Pass | No content scripts and no `scripting` permission |
| Network exfiltration | Pass | No `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` |
| Permission minimization | Pass with disclosure | `contentSettings` is retained only for explicit output-device unlock |
| Privacy policy | Needs external URL | Draft provided in `PRIVACY_POLICY_DRAFT.md`; Chrome Web Store requires a published URL |
| Runtime quality | Needs manual test | Must verify audio stability, output routing, and no crackling in real Chrome |

## Important Store-dashboard declarations

- Remote code: **No**
- Single purpose: use the text from `STORE_LISTING_DRAFT.md`
- Privacy policy URL: publish `PRIVACY_POLICY_DRAFT.md` as a public web page and enter its URL
- Data practices: disclose local audio handling and local settings/output preferences as required by the dashboard categories
- Permission justifications: use `CHROME_STORE_REVIEW_NOTES.md` or `STORE_LISTING_DRAFT.md`

## Manual risks to test before submission

1. `tabCapture` works only after clear user action.
2. Output routing works on System Default and does not crackle after long playback.
3. `Unlock device list…` is user-initiated and does not request/record microphone audio.
4. Custom output routing with `setSinkId()` works only where Chrome supports it.
5. Store listing screenshots accurately match the current UI.
