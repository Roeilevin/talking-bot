import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DASH_COOKIE, isValidDashCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  if (isValidDashCookie(cookieStore.get(DASH_COOKIE)?.value)) {
    redirect("/dashboard");
  }

  const next = sp.next && sp.next.startsWith("/") ? sp.next : "/dashboard";

  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <form
        method="POST"
        action="/api/login"
        style={{
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          border: "1px solid #8884",
          borderRadius: 12,
          padding: "2rem",
        }}
      >
        <h1 style={{ fontSize: "1.25rem" }}>Talking Bot — Dashboard</h1>
        <p style={{ fontSize: "0.85rem", opacity: 0.7 }}>
          Enter the dashboard password to continue.
        </p>
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          required
          style={{
            padding: "0.6rem 0.75rem",
            borderRadius: 8,
            border: "1px solid #8886",
            background: "transparent",
            color: "inherit",
            fontSize: "1rem",
          }}
        />
        {sp.error ? (
          <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>
            Incorrect password. Try again.
          </p>
        ) : null}
        <button
          type="submit"
          style={{
            padding: "0.6rem 0.75rem",
            borderRadius: 8,
            border: "none",
            background: "#0070f3",
            color: "#fff",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
