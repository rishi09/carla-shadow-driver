# 🚀 Deploy CARLA Shadow Driver Demo to Vercel

**Goal:** Share your interactive AI driving demo at `carla-sim.vercel.app` (or custom subdomain)

**What you'll deploy:** The visual car demo - works 100% in the browser, no server needed!

**Time:** ~5 minutes
**Cost:** FREE (Vercel free tier)

---

## What Your Friends Will See

A fully interactive driving simulator where they can:
- 🚗 Drive a car with W/A/S/D or arrow keys
- 🤖 See AI predictions in real-time (blue vs green)
- 🌧️ Switch weather (rain, fog, night, clear)
- 🚧 Encounter dynamic obstacles
- 📊 View real-time stats (speed, steering, divergence)

**No downloads, no setup** - just visit the URL and drive!

---

## Prerequisites

- ✅ GitHub account
- ✅ Vercel account (free - https://vercel.com)

---

## Step 1: Prepare Files for Deployment

Create a clean deployment folder:

```bash
cd ~/side-projects/carla-shadow-driver

# Create deployment folder
mkdir -p vercel-deploy

# Copy the visual car demo as index.html
cp demo_visual_car.html vercel-deploy/index.html

# Create vercel.json configuration
cat > vercel-deploy/vercel.json << 'EOF'
{
  "version": 2,
  "name": "carla-shadow-driver",
  "builds": [
    {
      "src": "index.html",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ]
}
EOF

# Create README for the deployment
cat > vercel-deploy/README.md << 'EOF'
# CARLA Shadow Driver - Interactive Demo

An interactive autonomous driving demo showing AI vs human steering in real-time.

## Features
- Real-time AI steering predictions
- Weather effects (rain, fog, night)
- Dynamic obstacles
- Full keyboard controls

## Controls
- W/↑ - Accelerate
- S/↓ - Brake
- A/← - Steer left
- D/→ - Steer right
- SPACE - Emergency brake

## Tech Stack
- Pure HTML/CSS/JavaScript
- No backend required
- Runs entirely in browser

Built with ❤️ to demonstrate autonomous driving concepts.
EOF

echo "✅ Deployment files ready in vercel-deploy/"
```

---

## Step 2: Initialize Git Repository

```bash
cd vercel-deploy

# Initialize git
git init

# Create .gitignore
echo "node_modules" > .gitignore

# Add files
git add .

# Commit
git commit -m "Initial deployment of CARLA shadow driver demo"
```

---

## Step 3: Push to GitHub

### Option A: Using GitHub CLI (if installed)

```bash
# Create repo and push
gh repo create carla-shadow-driver-demo --public --source=. --remote=origin --push
```

### Option B: Manual GitHub Setup

1. Go to https://github.com/new
2. Repository name: `carla-shadow-driver-demo`
3. Make it **Public**
4. **Do NOT** initialize with README
5. Click **Create repository**

Then push:

```bash
# Add remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/carla-shadow-driver-demo.git

# Push
git branch -M main
git push -u origin main
```

---

## Step 4: Deploy to Vercel

### Option A: Using Vercel CLI (Recommended - Fastest)

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
vercel

# Follow prompts:
# - Set up and deploy? Yes
# - Which scope? (your account)
# - Link to existing project? No
# - Project name: carla-shadow-driver-demo
# - In which directory? ./ (current)
# - Override settings? No

# Deploy to production
vercel --prod
```

**You'll get a URL like:** `https://carla-shadow-driver-demo.vercel.app`

### Option B: Using Vercel Web Interface

1. Go to https://vercel.com
2. Click **Add New...** → **Project**
3. Click **Import** next to your `carla-shadow-driver-demo` repo
4. Click **Deploy** (no configuration needed!)
5. Wait ~30 seconds
6. Done! You'll see your live URL

---

## Step 5: Set Up Custom Subdomain (Optional)

### If you want: `carla-sim.vercel.app`

1. Go to your project on Vercel
2. Click **Settings** → **Domains**
3. Add domain: `carla-sim.vercel.app`
4. Click **Add**

**Done!** Your demo is now at `https://carla-sim.vercel.app`

### If you have your own domain:

1. Go to Settings → Domains
2. Add: `carla.yourdomain.com`
3. Follow Vercel's DNS instructions
4. Wait for DNS propagation (~5-10 mins)

---

## Step 6: Share with Friends! 🎉

Send them the link:
```
🚗 Check out my AI driving simulator!
https://carla-sim.vercel.app

Controls: W/A/S/D to drive, watch the AI (blue) vs my input (green)
Try the weather buttons! 🌧️🌫️🌙
```

---

## What They'll Experience

1. **Instant load** - No installation needed
2. **Smooth 60fps** - Runs natively in browser
3. **Interactive** - Drive immediately with keyboard
4. **Visual learning** - See AI vs human steering in real-time
5. **Weather effects** - Switch between clear/rain/fog/night
6. **Stats dashboard** - Speed, steering, divergence percentage

---

## Advanced: Add Google Analytics (Optional)

```bash
# Edit index.html and add before </head>:
cat >> vercel-deploy/index.html << 'EOF'
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
EOF

# Then redeploy
git add .
git commit -m "Add analytics"
git push
vercel --prod
```

---

## Cost Breakdown

| Item | Cost |
|------|------|
| Vercel hosting | FREE |
| Bandwidth (100GB/month) | FREE |
| Custom vercel.app subdomain | FREE |
| SSL certificate | FREE |
| **Total** | **$0/month** |

**Limits on free tier:**
- 100GB bandwidth/month (enough for 1000s of visitors)
- Unlimited projects
- Automatic SSL
- Custom subdomains included

---

## Updating Your Demo

**When you make changes:**

```bash
cd vercel-deploy

# Make changes to index.html
# Then:

git add .
git commit -m "Updated demo with X"
git push

# Auto-deploys! Or manually:
vercel --prod
```

**Vercel auto-deploys** on every push to main branch!

---

## Troubleshooting

### Demo doesn't load
- Check Vercel deployment logs
- Verify index.html is in root of repo
- Check browser console for errors

### Controls don't work
- Click on the canvas first (to focus)
- Try different browser (Chrome recommended)

### Looks different than local
- Clear browser cache
- Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

---

## Make It Viral! 🚀

### Add to your demo page:

**Share buttons** - Add to index.html:
```html
<!-- Share buttons -->
<div style="margin-top: 20px;">
  <a href="https://twitter.com/intent/tweet?text=Check%20out%20this%20AI%20driving%20simulator!&url=https://carla-sim.vercel.app" target="_blank">
    Share on Twitter
  </a>
</div>
```

**Add description meta tags** for social sharing:
```html
<meta name="description" content="Interactive AI driving simulator - See autonomous driving AI in action!">
<meta property="og:title" content="CARLA Shadow Driver - AI Driving Demo">
<meta property="og:description" content="Drive a car and see AI predictions in real-time. Includes weather effects and obstacles!">
<meta property="og:image" content="https://your-demo.vercel.app/screenshot.png">
```

---

## Next Level Additions

### Easy wins:
- [ ] Add leaderboard (high scores)
- [ ] Mobile support (touch controls)
- [ ] Screenshot/share feature
- [ ] More AI models to compare

### Advanced:
- [ ] Multiplayer (Socket.io)
- [ ] Replay mode
- [ ] AI vs AI races
- [ ] Real CARLA backend integration

---

**Your friends will be impressed! 🎮**

Show them that autonomous driving isn't magic - it's neural networks making real-time predictions!
