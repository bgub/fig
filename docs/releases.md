# Releases

Fig uses Tegami to version the public packages and create grouped GitHub releases. All seven public packages belong to one `fig` release group, use the `alpha` prerelease channel, and receive the same version bump. The five renderer/core packages publish to npm and JSR; the two TanStack adapters publish to npm only. npm publishes prerelease versions under `latest`, so the default install always resolves to the newest Fig release even while its SemVer version includes an `alpha` prerelease suffix.

## Contributor workflow

Run `pnpm tegami` to create a changelog interactively, or add an explicit `.tegami/<description>.md` file:

```md
---
packages:
  "@bgub/fig": minor
  "@bgub/fig-dom": patch
---

## Describe the user-visible change
```

The highest requested bump is applied to the entire release group. Changes to private demos, tooling, tests, or documentation do not need a changelog unless they affect a public package.

## CI workflow

On each push to `main`, `.github/workflows/publish.yml` runs `pnpm tegami ci`:

1. Pending changelogs produce or update the Version Packages pull request.
2. Merging that pull request publishes the committed versions to JSR and npm.
3. Tegami creates one `fig@<version>` tag and grouped GitHub release.

The JSR adapter publishes JSR first. It records no separate release state: Tegami's committed publish lock is authoritative, while registry metadata is used to make retries idempotent.

## One-time registry setup

Before merging the first Version Packages pull request:

1. Create `fig`, `fig-dom`, `fig-reconciler`, `fig-refresh`, and `fig-server` in the `@bgub` scope on JSR.
2. Link every JSR package to `bgub/fig` in its package settings. This enables GitHub Actions OIDC publishing.
3. Check out the Version Packages branch, which contains `.tegami/publish-lock.yaml`.
4. Authenticate to npm, then preview and configure trusted publishing:

   ```bash
   npm login
   pnpm tegami npm pretrust --dry-run
   pnpm tegami npm pretrust
   ```

5. Commit the updated publish lock to the Version Packages branch before merging it.

## Verification and recovery

From a clean Version Packages checkout, validate both the Tegami plan and each JSR source package without publishing:

```bash
pnpm build
pnpm tegami publish --dry-run
```

The publish lock and registry checks make the workflow retry-safe. Re-run the failed GitHub Actions job after resolving a registry or authentication issue; already-published package versions are skipped.
