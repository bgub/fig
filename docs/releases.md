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

After successful `ci` on `main`, `.github/workflows/publish.yml` runs `pnpm tegami ci`:

1. Pending changelogs produce or update the Version Packages pull request.
2. Merging that pull request publishes the committed versions to JSR and npm.
3. Tegami creates one tag and GitHub release for every affected group: `fig@<version>`, `fig-tooling@<version>`, or `fig-tanstack@<version>`. Headless gets its own package tag and GitHub prerelease.

The JSR adapter publishes JSR first. It records no separate release state: Tegami's committed publish lock is authoritative, while registry metadata is used to make retries idempotent.

### Validation of version-only commits

CI uses release-focused validation for a Version Packages PR and its merge only when the diff contains version changes and an updated publish lock, plus optional changelog changes. Existing npm manifests may change their version and existing internal dependency ranges; existing JSR manifests may change their version. Scripts, exports, external dependencies, source files, configuration, new packages, file modes, and dependency lockfiles select full CI.

The exact base commit must also have a successful push-triggered `ci` run on `main`, with both the `checks` and `e2e` jobs and their test steps successful. For a PR, the base is its target commit; for a push, it is the event's previous commit. A run that skipped browser tests cannot serve as that evidence. Missing history, missing evidence, or GitHub API failures fall back to full CI.

Release validation keeps the build, static checks, and dependency audit. It runs `pnpm check:release` instead of the unit-test Node matrix and browser suite:

- Test release planning and package metadata, and dry-run the Tegami publish plan.
- Pack all public npm packages and install them into a temporary consumer outside the workspace, with strict peer dependencies and lifecycle scripts disabled.
- Typecheck the consumer and resolve and import every public entry in production and under the `fig-development` condition. Start entries requiring virtual modules are exercised through an actual Vite client/server build and server request, rather than imported directly in Node.
- Smoke-test server rendering, hydration without replacing server nodes, interaction, and development diagnostics from those installed tarballs.

Runtime and Headless declarations are checked with `skipLibCheck: false`. Tooling consumer imports use the repository's `skipLibCheck: true` setting; upstream tooling declarations reference optional bundlers that consumers do not necessarily install.

The successful `ci` result still gates publication; release validation performs no publishing. To run the same consumer checks locally, run `pnpm build` followed by `pnpm check:release`.

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
