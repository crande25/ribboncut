
# Increase RibbonCut Discoverability

## What we can do in-app (code changes)

### 1. Add JSON-LD Structured Data (GEO/AI optimization)
Add a `<script type="application/ld+json">` block to `index.html` with Schema.org `WebApplication` markup:
- Name, description, URL, author, applicationCategory ("FoodService"), operatingSystem ("Web")
- `areaServed`: SE Michigan
- This helps AI search engines and Google understand what the site is

### 2. Add a sitemap.xml
Create `public/sitemap.xml` with the main routes (`/`, `/settings`) pointing to `https://www.ribbon-cut.com`. This can be submitted to Google Search Console.

### 3. Update robots.txt
- Add `Sitemap: https://www.ribbon-cut.com/sitemap.xml`
- Add allowances for AI crawlers (GPTBot, Google-Extended, etc.)

### 4. Add canonical URL
Add `<link rel="canonical" href="https://www.ribbon-cut.com/" />` to `index.html` so search engines consolidate ranking signals to the custom domain.

### 5. Add og:url meta tag
Add `<meta property="og:url" content="https://www.ribbon-cut.com/" />` for proper social sharing.

## What requires manual action (not code)

These are things you'd do outside the codebase:

- **Google Search Console**: Register `ribbon-cut.com`, submit the sitemap
- **Bing Webmaster Tools**: Same as above
- **Community posts**: Share on Reddit (r/Detroit, r/AnnArbor, r/Michigan, r/foodie), Product Hunt, etc.
- **Backlinks**: Guest posts, local food blogs, local news sites
- **Social media**: Create short demo videos for TikTok/Instagram Reels showing the app in action
- **Pinterest**: Pin restaurant photos with links back to the site

## Technical Details

**Files to create:**
- `public/sitemap.xml`

**Files to edit:**
- `index.html` — add JSON-LD structured data block, canonical link, og:url
- `public/robots.txt` — add Sitemap directive and AI bot allowances

No database changes needed.
