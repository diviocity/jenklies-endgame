# Hosting options

The app is currently published to GitHub Pages from a public repo. This note collects the alternatives for later. Nothing here is set up yet.

## What's public today

- **Your data is private either way.** Everything lives only in the phone's browser storage and is never sent anywhere. Someone opening the URL gets an empty copy of the app.
- **What's public:** the code (the repo) and the fact that the app exists at its address.

The app is static files only (no server code), so any host that serves files over **HTTPS** works. HTTPS is required for offline support and for installing to the iPhone Home Screen.

## Options

| Option | Cost | Code private? | Updates |
|---|---|---|---|
| GitHub Pages, public repo (current) | Free | No | Automatic on merge |
| GitHub Pages, private repo | GitHub Pro (~$4/mo) | Yes (site still reachable by URL) | Automatic on merge |
| Cloudflare Pages or Netlify, private repo | Free | Yes | Automatic on merge |
| Own hosting (e.g. Namecheap cPanel) | Already paid for | Yes, if the repo is private | Manual upload, or automatic via FTP from GitHub Actions |

## Moving to Namecheap cPanel hosting

### In cPanel (one time)
1. **Subdomain:** create one, e.g. `endgame.yourbusiness.com` (Domains → Create a new domain). Its folder holds the app's files.
2. **HTTPS:** SSL/TLS Status → select the subdomain → run AutoSSL. It's free with Namecheap hosting and can take up to an hour. Then turn on Force HTTPS Redirect for the subdomain under Domains.
3. **FTP account:** create one just for the app (FTP Accounts), with its home directory set to the subdomain's folder, so uploads can't touch the business site.

### In GitHub (one time)
4. **Secrets:** add the FTP server, username and password under Settings → Secrets and variables → Actions.
5. **Optionally make the repo private.** Private repos get 2,000 free Actions minutes a month, and a deploy takes about a minute.

### Repo changes
- Build with `BASE_PATH=/`, since the app would live at the root of the subdomain instead of `/jenklies-endgame/`.
- Change `.github/workflows/deploy.yml` to upload `dist/` over FTPS after the tests pass, instead of publishing to GitHub Pages.
- Add a `.htaccess` that:
  - stops `sw.js`, `index.html` and `manifest.webmanifest` from being cached, so updates aren't delayed;
  - lets the hashed files in `assets/` cache long-term;
  - serves `.webmanifest` as `application/manifest+json`.
- Update the README's deploy notes.

## Moving the app to a new address

Data is tied to the app's address, so a new address starts empty:

1. In the current app, export a backup (More → Backup).
2. Open the new address in Safari and add it to the Home Screen.
3. In the new app, import the backup.
4. Delete the old Home Screen app.
5. Turn off GitHub Pages in the repo settings once everything works.

Until you delete it, the old app keeps working with its data, so nothing is lost if the new setup has a problem.

## Password protection

Hosts can put a login prompt in front of a site, but installed iPhone web apps handle these poorly. They can ask for the password repeatedly or fail to fetch updates in the background. Since the data never leaves the phone, an unlisted address is usually enough. If a login gate is wanted, Cloudflare Access (cookie-based) behaves better than cPanel's directory password (HTTP basic auth), but check it on the phone before relying on it.
