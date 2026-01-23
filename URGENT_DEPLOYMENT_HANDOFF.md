# 🚨 URGENT: Railway Deployment Handoff

**Date:** January 21, 2026
**Deadline:** TOMORROW - Team needs this working
**Project:** Lite Training v2
**URL:** https://lite-training-v2-production.up.railway.app

---

## THE PROBLEM

Videos are NOT loading on the deployed app. The Railway deployment is using **CLI uploads** (`railway up`) instead of **GitHub auto-deploy**. CLI uploads fail because:
1. Video files total ~190MB
2. Railway CLI upload limit causes failures or excludes videos
3. The active deployment has NO videos in `/assets/training/videos/`

## WHAT WORKS

- **GitHub repo has ALL videos** (verified): `Roof-ER21/lite-training` main branch
- **Videos on GitHub are correct sizes:**
  - `module8-damage-id.mp4` = 32.8MB (combined Part 1+2) ✅
  - `reeses-pitch-cassidy.mp4` = 20.7MB (new Reese video) ✅
  - All 9 videos present and correct
- **GitHub raw URLs work:** `https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/[filename].mp4`

## WHAT'S BROKEN

- Railway keeps using cached CLI deployments
- GitHub auto-deploy triggers but gets overridden by CLI deployments
- Even "redeploy" reuses old cached builds

---

## SOLUTION OPTIONS (Pick One)

### Option A: Force GitHub-Only Deployment (RECOMMENDED)
1. Go to Railway dashboard: https://railway.com
2. Open **lite-training-v2** service
3. Go to **Settings** tab
4. Find **Source** section
5. **Disconnect CLI** or set source to **GitHub only**
6. Trigger a fresh deploy from GitHub

### Option B: Use GitHub Raw URLs (ALREADY IMPLEMENTED)
The latest code (commit `05eea95`) already points videos to GitHub raw URLs:
```
https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/[filename].mp4
```

**BUT** this code hasn't deployed yet. Need to:
1. Get Railway to deploy the LATEST GitHub commit
2. NOT the cached old builds

### Option C: Create Fresh Railway Service
1. Delete current `lite-training-v2` service
2. Create new service connected to GitHub ONLY (no CLI)
3. Connect to `Roof-ER21/lite-training` repo, `main` branch
4. Set environment variables:
   - `DATABASE_URL` = (get from current service)
   - `GEMINI_API_KEY`
   - `OPENAI_API_KEY`
   - `MANAGER_CODE`

### Option D: Use External Video Hosting
1. Upload videos to Cloudflare R2, AWS S3, or similar
2. Update video URLs in `index.tsx` to point to CDN
3. Deploy (videos won't be part of the build)

---

## KEY FILES

| File | Purpose |
|------|---------|
| `/Users/a21/Desktop/Lite Training Fresh/index.tsx` | Main app - video URLs on lines 1955, 2047, 2187, 2235, 2383, 2480, 2714, 3562, 4442 |
| `/Users/a21/Desktop/Lite Training Fresh/public/sw.js` | Service worker - current version is v7 |
| `/Users/a21/Desktop/Lite Training Fresh/.railwayignore` | Railway upload exclusions |
| `/Users/a21/Desktop/Lite Training Fresh/nixpacks.toml` | Railway build config |

---

## RECENT CHANGES MADE (Not Yet Deployed)

1. **Videos now use GitHub raw URLs** (commit `0c4b83b`)
2. **Module 11 updates:**
   - Added note: "You will be issued company iPads for field use"
   - Added note: "If the above claim methods do not work/not available, then proceed to phone call"
3. **Service worker bumped to v7**

---

## RAILWAY PROJECT INFO

- **Project ID:** `61d0164f-ce11-44cc-bf4d-b9eb22075cb3`
- **Service ID:** `9c3ab228-d447-4502-a42f-90066140fed4`
- **Production URL:** `lite-training-v2-production.up.railway.app`
- **GitHub Repo:** `Roof-ER21/lite-training`
- **Branch:** `main`

---

## VERIFICATION STEPS

After deployment, verify:

1. **Check service worker version:**
```bash
curl -s "https://lite-training-v2-production.up.railway.app/sw.js" | head -3
# Should show: roofer-training-v7
```

2. **Check videos load:**
```bash
curl -sI "https://lite-training-v2-production.up.railway.app/assets/training/videos/module8-damage-id.mp4" | head -5
# Should show: content-type: video/mp4 (NOT text/html)
```

3. **Or if using GitHub URLs, check HTML contains:**
```bash
curl -s "https://lite-training-v2-production.up.railway.app/" | grep "raw.githubusercontent.com"
# Should find GitHub video URLs
```

---

## COMMANDS FOR AGENTS

```bash
# Check current deployment
cd "/Users/a21/Desktop/Lite Training Fresh"
railway deployment list

# Check GitHub has latest
git log --oneline -5

# Verify videos on GitHub
gh api repos/Roof-ER21/lite-training/contents/public/assets/training/videos --jq '.[].name'

# Test GitHub raw URL
curl -I "https://raw.githubusercontent.com/Roof-ER21/lite-training/main/public/assets/training/videos/module8-damage-id.mp4"
```

---

## DO NOT

- ❌ Do NOT use `railway up` - it excludes videos
- ❌ Do NOT use `railway redeploy` alone - it reuses cached builds
- ❌ Do NOT modify video files - they're correct on GitHub

---

## PRIORITY

🔴 **CRITICAL** - Team needs this working by tomorrow morning

The app works perfectly locally. The ONLY issue is Railway deployment not including videos.

---

**Created by:** Claude Opus 4.5
**For:** Grok/Codex/Qwen/Squad/Agent21/NEXUS
