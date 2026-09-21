# Privacy Policy Setup for Chrome Web Store

You need a publicly accessible privacy policy URL for Chrome Web Store submission.

## Quick Steps

### Step 1: Push Your Code to GitHub

```bash
git push origin main
```

This will upload PRIVACY.md to your GitHub repository.

### Step 2: Use GitHub Raw URL (Immediate - Recommended)

Once pushed, use this URL in your Chrome Web Store submission:

```
https://raw.githubusercontent.com/PlanMyPeak/cycling_coach_browser_plugin/main/PRIVACY.md
```

**Test it**: Open that URL in your browser after pushing. It should show the privacy policy text.

---

## Alternative: Enable GitHub Pages (Optional)

If you want a nicer-looking URL:

### Step 1: Push Your Code

```bash
git push origin main
```

### Step 2: Enable GitHub Pages

1. Go to: https://github.com/PlanMyPeak/cycling_coach_browser_plugin/settings/pages
2. Under "Source", select: **main** branch
3. Click **Save**
4. Wait 1-2 minutes for deployment

### Step 3: Access Your Privacy Policy

After GitHub Pages is enabled, your privacy policy will be at:

```
https://planmypeak.github.io/cycling_coach_browser_plugin/PRIVACY.md
```

Or create a prettier version at:

```
https://planmypeak.github.io/cycling_coach_browser_plugin/privacy
```

---

## Recommended Approach

**Use GitHub Raw URL** - It works immediately after pushing:

```
https://raw.githubusercontent.com/PlanMyPeak/cycling_coach_browser_plugin/main/PRIVACY.md
```

**Advantages**:

- ✅ Works immediately after `git push`
- ✅ No configuration needed
- ✅ Always shows latest version
- ✅ Accepted by Chrome Web Store

**To use it**:

1. Run: `git push origin main`
2. Copy the URL above
3. Paste it in Chrome Web Store privacy policy field
4. Done!

---

## Verify It Works

After pushing, test the URL in your browser:

```bash
# Push your code
git push origin main

# Wait 10 seconds, then open in browser:
# https://raw.githubusercontent.com/PlanMyPeak/cycling_coach_browser_plugin/main/PRIVACY.md
```

If you see your privacy policy text, you're all set!

---

## Update Submission Checklist

Use this privacy policy URL in your Chrome Web Store submission:

**Privacy Policy URL**:

```
https://raw.githubusercontent.com/PlanMyPeak/cycling_coach_browser_plugin/main/PRIVACY.md
```

Copy this URL and paste it in the "Privacy Policy URL" field when submitting to Chrome Web Store.
