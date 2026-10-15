# Google indexing deployment

1. Deploy the Node build with APP_ORIGIN=https://keynest.store. No SQL migration is required.
2. Run `node scripts/build-country-worker.js`, then replace the deployed Cloudflare Worker with the entire generated `deploy/cloudflare-vietnam-worker.js`. GitHub deployment of Node does not deploy this Worker.
3. Disable the old blanket non-Vietnam WAF country-block rule if present. Let the updated Worker enforce regional restrictions: public browsing is global; foreign account and transaction requests remain blocked. Other WAF security rules remain enabled. Do not add a User-Agent Googlebot bypass or a broad API security exemption.
4. Redirect www to the preferred HTTPS hostname at the edge. Ensure other Cache Rules do not override API bypass.
5. Verify the homepage, a product, /robots.txt and /sitemap.xml through Search Console Live URL Inspection. Product HTML should have its own canonical and Product JSON-LD, and public resources must not return a challenge or 403.
6. Submit https://keynest.store/sitemap.xml in Search Console. Test a product using https://search.google.com/test/rich-results, then request indexing and validate the affected issue.

Existing products generate metadata from their actual name, description, image and visible variants (price in VND and availability). Hidden variants are omitted. No invented ratings or keyword tags are added. Public pages use the same content for people and crawlers.

Private pages remain noindex. The duplicate report may concern tracking parameters or trailing slashes; inspect its example URLs before changing redirects. Crawled-but-not-indexed is not proof of a technical error, and Google does not guarantee indexing, ranking, or rich results.
