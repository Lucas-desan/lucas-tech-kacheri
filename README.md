# Lucas Technologies Kacheri

## Booking API deployment

The booking form and admin dashboard use the same-origin `/api/bookings` endpoint. Netlify redirects this route to the function in `netlify/functions/bookings.mjs`, which stores bookings in Netlify Blobs.

Before deploying, add an `ADMIN_PIN` environment variable in the Netlify site settings. Set it to the PIN that administrators should enter; it is checked by the server and is not embedded in the page. Redeploy after setting the variable.

Bookings submitted before this backend is deployed remain in the browser storage where they were created and are not automatically copied to Netlify.
