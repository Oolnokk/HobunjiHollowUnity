# Netlify Cloud Saves

Hobunji Hollow keeps the browser save (`localStorage`) as the live gameplay save and optionally mirrors that portable save to Netlify.

## Architecture

- `docs/js/save-snapshot-core.js` captures/restores the same `hobunjiSaveMeta` + `hobunji_farm_layout_v3:*` boundary used by the existing local-folder backup.
- `docs/js/netlify-cloud-save.js` owns browser UI, account state, autosync, device/link metadata, conflict handling, and mobile-visible diagnostics.
- `netlify/functions/hobunji-auth.mjs` owns Netlify Identity login/signup/logout/confirmation/recovery/invite flows.
- `netlify/functions/hobunji-cloud-save.mjs` owns authenticated Netlify Blobs reads/writes.
- `package.json` pins the Netlify runtime packages used by the Functions.

The cloud backend never accepts a user id from the browser. Blob keys are derived only from the authenticated Netlify Identity user returned inside the Function.

## One-time Netlify setup

1. Open the Netlify project.
2. Go to **Project configuration → Identity** and choose **Enable Identity**.
3. Under Identity registration, choose whether registration is **Open** or **Invite only**.
4. Deploy the current `main` branch.

No Blob store needs to be provisioned manually. `@netlify/blobs` creates/uses the site-scoped `hobunji-cloud-saves` store automatically from the Function runtime.

## Player flow

- Save selection gets a small **Cloud Save** launcher.
- In-game Settings gets a **Netlify Cloud Save** row next to the local-folder save controls.
- The first successful push/pull arms 30-second cloud autosync for that browser/account pair.
- Browser saves continue locally when offline or signed out.
- If the server revision differs from the revision last seen by the browser, autosync stops and the player must choose:
  - **Keep This Device → Cloud**
  - **Use Cloud → This Device**

Cloud pulls reload the page after restoring the portable snapshot so onboarding/game state is rebuilt from the imported save.

## Conflict protection

The Blob store uses strong consistency. Every cloud save has:

- monotonically increasing `revision`
- `updatedAt`
- browser `deviceId`
- byte size metadata

Writes use the current Blob ETag with `onlyIfMatch` (or `onlyIfNew` for the first save). Even a forced player choice still uses an ETag guard, so a third writer racing the request produces another conflict rather than silently overwriting it.

## Mobile diagnostics

No DevTools are required.

Open the Cloud Save panel and expand **Cloud save debug** to see device id, cloud revision, local link revision, dirty state, and service availability.

The runtime also exposes:

```js
window.__hobunjiCloudSaveDebug.status()
window.__hobunjiCloudSaveDebug.captureLocal()
window.__hobunjiCloudSaveDebug.refresh()
window.__hobunjiCloudSaveDebug.sync()
window.__hobunjiCloudSaveDebug.clearLink()
```

`clearLink()` removes only this browser's cloud ancestry metadata. It does not delete either the browser save or the cloud save.

## Testing notes

Cloud authentication and Functions must be tested on a Netlify HTTPS deployment. A GitHack/static GitHub mirror can render the game and load the client module, but it cannot provide `/.netlify/functions/*`, Identity cookies, or Netlify Blobs.

Suggested smoke test:

1. Enable Identity and deploy.
2. Create/sign into an account.
3. **Save Device → Cloud** and confirm revision 1.
4. Make a small save change; wait for autosync or press **Sync Now** and confirm revision increments.
5. Open another browser/device, sign in, and choose **Use Cloud → This Device**.
6. Change both devices without syncing, then sync one and verify the other presents a conflict rather than overwriting it.
7. Disable networking temporarily and verify ordinary browser saving/gameplay still works.
