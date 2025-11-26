# Railway Deployment Fix - Cache Conflict Resolution

## Problem Summary

The Agnes-21 app was failing to deploy on Railway with the following error:

```
npm error code EBUSY
npm error syscall rmdir
npm error path /app/node_modules/.cache
npm error errno -16
npm error EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'
```

## Root Cause

Railway's Nixpacks builder mounts a cache volume at `/app/node_modules/.cache` to speed up builds. However, this was conflicting with npm's cache management operations during the build process, causing the "resource busy or locked" error.

## Solution Implemented

### 1. Created `.dockerignore` file
Excludes cache directories from the Docker build context:
- `node_modules/.cache`
- `.cache`
- `.vite`
- Other temporary and cache directories

### 2. Created `.npmrc` file
Configures npm to use a custom cache location that doesn't conflict with Railway's mounts:
```
cache=/tmp/npm-cache
prefer-offline=false
audit=false
fund=false
```

### 3. Created `nixpacks.toml` file
Explicitly configures the Railway build process:
- Sets Node.js version to 22.x
- Separates install and build phases
- Cleans cache directories before build
- Uses custom npm cache location

### 4. Updated `railway.json`
Modified the build command to:
- Clean cache directories: `rm -rf node_modules/.cache .vite`
- Use `npm ci` instead of `npm install` for deterministic installs
- Specify custom cache location: `--cache=/tmp/npm-cache`
- Disable offline mode: `--prefer-offline=false`

## Technical Details

**Build Command (Before):**
```bash
npm install && npm run build
```

**Build Command (After):**
```bash
rm -rf node_modules/.cache .vite && npm ci --cache=/tmp/npm-cache --prefer-offline=false && npm run build
```

## Why This Works

1. **Cache Isolation**: By moving npm's cache to `/tmp/npm-cache`, we avoid conflicts with Railway's mounted cache
2. **Clean State**: Removing cache directories before build ensures no stale or locked files
3. **Deterministic Installs**: Using `npm ci` instead of `npm install` ensures consistent dependency resolution
4. **Explicit Configuration**: The `nixpacks.toml` file gives us full control over the build phases

## Deployment Instructions

The fix has been committed. To deploy:

```bash
cd "/Users/a21/Downloads/Lite Training"
git push origin main
```

Railway will automatically detect the push and start a new deployment. The build should now complete successfully in 2-3 minutes.

## Monitoring the Deployment

1. Watch the Railway dashboard for the new deployment
2. Check the build logs to confirm no EBUSY errors
3. Verify the app is accessible at https://a21.up.railway.app

## Files Modified

- `.dockerignore` (created)
- `.npmrc` (created)
- `nixpacks.toml` (created)
- `railway.json` (modified build command)

## Expected Outcome

- Clean, successful builds on Railway
- No EBUSY or cache-related errors
- Consistent deployment times (2-3 minutes)
- Stable production environment

## Rollback Plan

If issues occur, the previous working state can be restored:

```bash
git revert HEAD
git push origin main
```

However, this fix addresses the root cause and should resolve the deployment issues permanently.

---

**Date**: November 24, 2025
**Status**: Ready to deploy
**Commit**: f1965ba
