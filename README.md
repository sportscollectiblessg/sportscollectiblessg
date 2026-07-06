# Sports Collectibles SG — website

This is your consignment app as a real, standalone website. It works the
same way as the version you've been using: you (the owner) add consignors
and cards with photos, and each consignor gets their own link where they
can view (but not edit) their cards.

The only thing that changed under the hood: instead of Claude's built-in
`window.storage` (which only works inside Claude), this version uses
**Supabase** — a free database + file storage + login service — so it can
run as a real, independent website.

## What you'll set up (all free)

1. A **Supabase** project — your database, photo storage, and login.
2. A **GitHub** repository — where your code lives.
3. **Vercel** (or Cloudflare Pages / Netlify) — hosts the actual website
   and auto-deploys whenever you push changes to GitHub.

---

## Step 1 — Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free).
2. Click **New project**. Pick any name/region, set a database password
   (save it somewhere), and wait ~2 minutes for it to spin up.
3. In the left sidebar, go to **SQL Editor** → **New query**.
4. Open `supabase/schema.sql` from this project, copy the whole thing,
   paste it into the SQL editor, and click **Run**. This creates all your
   tables, the photo storage bucket, and the security rules in one go.
5. Go to **Settings → API**. You'll need two values from this page in
   Step 3: the **Project URL** and the **anon public** key.

### Create your owner login

Since this is now a real public website, a simple PIN isn't real security
anymore — anyone could find it by inspecting the page. Instead, you get a
proper login:

1. In Supabase, go to **Authentication → Users → Add user**.
2. Enter your own email and a password. Leave "Auto Confirm User" checked.
3. That's it — this is what you'll type in at `/owner` on your live site.

You can add a second owner/staff account the same way later if needed.

---

## Step 2 — Get the code running on your computer

You'll need [Node.js](https://nodejs.org) installed (get the LTS version).

1. Download/unzip this project folder somewhere on your computer.
2. Open a terminal in that folder and run:
   ```
   npm install
   ```
3. Copy `.env.example` to a new file named `.env`, and fill in the two
   values from Supabase's **Settings → API** page:
   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
4. Start it locally:
   ```
   npm run dev
   ```
5. Open the link it gives you (usually `http://localhost:5173`). You
   should see the landing page. Go to `/owner`, sign in with the account
   you made above, and try adding a consignor and a card — this is a
   fully working preview on your own machine before it's public.

---

## Step 3 — Put the code on GitHub

1. Create a free account at [github.com](https://github.com) if you don't
   have one.
2. Create a new repository (keep it private if you'd like).
3. From your project folder, run:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
   (GitHub shows you these exact commands with your repo's real URL when
   you create it — just copy them from there.)

---

## Step 4 — Deploy it for free with Vercel

1. Go to [vercel.com](https://vercel.com) and sign up using your GitHub
   account.
2. Click **Add New → Project**, and pick the repository you just pushed.
3. Vercel auto-detects it's a Vite project — you don't need to change any
   build settings.
4. Before clicking Deploy, add your environment variables (same two as
   your `.env` file): open **Environment Variables** and add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with your real values.
5. Click **Deploy**. In about a minute, you'll get a live URL like
   `sports-collectibles-sg.vercel.app`.

From now on, any time you `git push` a change, Vercel automatically
rebuilds and redeploys your site — no extra steps.

### Optional: a real domain

If you want `sportscollectiblessg.com` instead of a `.vercel.app`
address, buy the domain anywhere (Namecheap, GoDaddy, Cloudflare — usually
$10–15/year), then in Vercel go to **Project → Settings → Domains** and
follow the instructions to point it at your site.

---

## How links work

- **You (owner):** `yoursite.com/owner`
- **Each consignor:** `yoursite.com/their-telegram-username` — this is
  generated automatically when you add them, and you can copy it straight
  from the consignor list (the copy icon next to their name).

## What's different from the Claude version, on purpose

- **Login** is a real email/password instead of a PIN — more appropriate
  for a public website.
- **Photos** are stored properly in Supabase Storage instead of as text
  blobs — better for larger images and faster loading.
- The **AI-powered auto-sync / screenshot-reading features are not
  included** here, since those depend on Claude's own infrastructure and
  don't carry over to a plain website. Everything else — cards, statuses,
  countdowns, earnings breakdown, FX auto-refresh — works the same.

## If you get stuck

Come back to this chat any time with a screenshot of an error and I can
help you debug it, whether it's a Supabase setting, a deployment error,
or something in the code.
