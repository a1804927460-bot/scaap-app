# Generated media in Cloudflare R2

The gateway can store new generated image and video results in one private R2
bucket while keeping Supabase for authentication, billing, job state and legacy
result reads. Reference uploads remain temporary in gateway memory.

Configure these server-only Railway variables:

```ini
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_MEDIA_BUCKET=
```

Use an R2 API token limited to object read/write for the selected private bucket.
Lifecycle administration uses a separate authenticated Wrangler session. Never expose it to the desktop application. When
all four variables are present, new results use `image/` and `video/` prefixes in
R2. If any variable is absent, new results continue using Supabase Storage.
Reads check R2 first and fall back to Supabase when the object is absent.
R2 outages return a service error. Historical Supabase files are not migrated
or deleted by these rules. Downloads still pass through Railway.

Apply expiration using an authenticated Wrangler session with the selected
CLOUDFLARE_ACCOUNT_ID. These additive commands preserve other lifecycle rules:

```powershell
npx wrangler r2 bucket lifecycle add messs-generated-media expire-generated-images-30d image/ --expire-days 30 --force
npx wrangler r2 bucket lifecycle add messs-generated-media expire-generated-videos-30d video/ --expire-days 30 --force
npx wrangler r2 bucket lifecycle list messs-generated-media
```

Cloud deletion may occur after the nominal expiration time. The desktop library
remains the long-term copy. A future product-level cloud retention setting must
replace this global rule before offering permanent cloud storage.
