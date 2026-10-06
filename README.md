This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Dashboard access

The admin pages (`/dashboard`, `/allowed-numbers`, `/users`) sit behind Supabase
Auth email + password. `proxy.ts` gates them and refreshes the session; each page
and API route re-checks independently.

Requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (sign-in) and
`SUPABASE_SERVICE_ROLE_KEY` (user administration) — see `.env.example`.

Accounts are managed from the **Users** page: adding a user there creates a
confirmed Supabase account and stamps `dashboard_access: true` into its
`app_metadata`. Sign-in requires that flag, so an account created any other way
— including one self-registered against Supabase's public signup endpoint —
cannot reach the dashboard. There is deliberately no signup route in the app.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Guide no-show alert

When an order is marked no-show — by the assistant's `mark_noshow` tool, or
automatically after the customer misses `MAX_CALL_ATTEMPTS` calls — the guide
running that day's tour gets a WhatsApp message naming the order and the
traveller, with a **"התייר הצטרף"** quick-reply button for the case where the
traveller did board after all.

The guide's phone comes from `order_details` → `days[].guide.phone` (matched to
the tour date, see `guideForDate` in `lib/bein-harim.ts`). It is often empty —
then nobody is messaged and the ops update says so; the no-show itself is
unaffected. Nothing here can fail a no-show: `lib/guide-alert.ts` never throws.

The message is business-initiated, so it goes out as the approved template
`guide_noshow_alert` (Hebrew, params: guide name / order number / traveller),
falling back to free text if the template is rejected. Create it once with:

```bash
node scripts/create-guide-noshow-template.mjs
```

Send yourself a real one first — same channel, same payload, same template as
production (creates the template if it is missing):

```bash
node scripts/send-guide-noshow-test.mjs 0504425422
```


A tap on the button comes back through `/api/webhooks/converto` as an ordinary
inbound message carrying the button's text. The order it refers to is resolved
from the alert we sent that number (looked up in `talking_bot_whatsapp_sends` by
`kind = guide_noshow_alert`, within 24h) — so guides need no allowlist entry and
no state is tracked. The reply then: corrects the call outcome to `coming`,
posts a back-office message on the order asking to reverse the no-show, and
tells the ops number. The correction itself is `change_order_status` →
`approved` (`BH_SHOW_STATUS`), the same call the office makes by hand; the
back-office message is the audit trail, and asks for manual handling if that
call failed.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
