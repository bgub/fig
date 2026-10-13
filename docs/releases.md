# Releases

Fig uses Tegami to version the public packages and create grouped GitHub releases. Packages that share a private protocol or implementation are versioned together; packages connected through public interfaces release independently:

| Release group | Packages |
| --- | --- |
| `fig` | `@bgub/fig`, `@bgub/fig-reconciler`, `@bgub/fig-dom`, `@bgub/fig-server` |
| `fig-tooling` | `@bgub/fig-refresh`, `@bgub/fig-vite` |
| `fig-tanstack` | `@bgub/fig-tanstack-router`, `@bgub/fig-tanstack-start` |

These three groups publish stable versions under npm's `latest` tag and synchronize version bumps among their members. Breaking changes require a major bump. The five source-distributed packages also publish to JSR; `@bgub/fig-vite` and the two TanStack adapters publish to npm only.

`@bgub/fig-headless` releases independently, outside these synchronized groups. It publishes to npm only under `alpha`, with `prerelease: "alpha"` in Tegami and `publishConfig.tag: "alpha"` in its manifest. Alpha releases may change APIs and behavior. Its Fig and Fig DOM peers require `^2.0.0`, so publish Fig 2.0 before or alongside the first Headless alpha.

The initial source version is `0.0.0`: the first minor changelog generates `0.1.0-alpha.0` on the Version Packages branch. Do not manually pre-bump that source version or the first release would advance again. Later changelogs increment the alpha sequence. Configure npm trusted publishing for the new package using the existing `publish.yml` workflow before its first release; existing packages' trust settings do not cover a new package name.

## Contributor workflow

Run `pnpm tegami` to create a changelog interactively, or add an explicit `.tegami/<description>.md` file:

```md
---
packages:
  "@bgub/fig":
    type: minor
  "@bgub/fig-dom":
    type: patch
---

## Describe the user-visible change
```

The highest requested bump is applied within each affected release group. A changelog that names packages from multiple groups advances each of those groups independently. Changes to private demos, tests, or documentation do not need a changelog unless they affect a public package.

## CI workflow

On each push to `main`, `.github/workflows/publish.yml` runs `pnpm tegami ci`:

1. Pending changelogs produce or update the Version Packages pull request.
2. Merging that pull request publishes the committed versions to JSR and npm.
3. Tegami creates one tag and GitHub release for every affected group: `fig@<version>`, `fig-tooling@<version>`, or `fig-tanstack@<version>`. Headless gets its own package tag and GitHub prerelease.

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
