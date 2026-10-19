# Bliss website demo

The Netlify build now runs entirely in the browser. It needs no Supabase connection, setup key or passwords. The pink liquid-glass design is retained.

- Open the website and choose **Try admin** or **Try resident**.
- Explore sample rents (₹8,500 / ₹6,500), residents, payments, requests and notices.
- Change advertised rent or upload a sample room image up to 1 MB. Return to the homepage to see it.
- Changes are stored only in this browser; other visitors get their own demo. **Reset demo** restores the sample data.
- Role selection is for presentation only. Use fictional names, photos and payment references. No accounts, invitations, bookings or payments are created. Password changes and invitation sending are disabled.
- Browser storage must be available to retain edits. Payment screenshots are validated but not saved.

Run locally with `npm run dev` and open http://127.0.0.1:5173. Build for Netlify with `npm run build`; publish `dist-netlify`.

The deployed API handler returns HTTP 410 and never connects to the existing Supabase project. Historical backend code and local data are preserved. Supabase environment variables are unnecessary for this demo and can be removed from Netlify settings. The old offline app is available with `npm run dev:local`.
