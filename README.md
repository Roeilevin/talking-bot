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

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
