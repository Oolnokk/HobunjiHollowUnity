# Hobunji Hollow Hosting

Hobunji Hollow is a static browser game published from the repository's `docs/` directory with GitHub Pages.

## Production deployment

- Production URL: `https://oolnokk.github.io/HobunjiHollowUnity/`
- Deployment workflow: `.github/workflows/deploy-pages.yml`
- Published source: `docs/`
- No build step, package install, application server, or hosted function runtime is required.
- A push to `main` that changes `docs/**` or the Pages workflow publishes a new production build.
- The Pages workflow can also be run manually with `workflow_dispatch`.

## One-time repository setting

After the deployment workflow reaches `main`, open **Repository Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. This is a repository setting, not a file in the game tree.

## Google Drive cloud-save origin

The production site uses this OAuth JavaScript origin:

`https://oolnokk.github.io`

The Google Picker API key should allow this production referrer:

`https://oolnokk.github.io/HobunjiHollowUnity/*`

The more detailed Drive/Picker setup remains in `GOOGLE_DRIVE_CLOUD_SAVES.md`.

## Test builds

Commit-pinned GitHack URLs remain useful for branch/PR testing because they do not require changing production deployment. Google Drive authorization on a GitHack build requires deliberately adding that test origin/referrer to the Google Cloud configuration; production credentials should not be broadened merely to make ordinary visual/gameplay previews work.
