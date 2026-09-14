import { signIn } from "@/server/auth";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        action={async (formData) => {
          "use server";
          await signIn("nodemailer", { email: formData.get("email"), redirectTo: "/projects" });
        }}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-surface p-8"
      >
        <h1 className="text-xl font-bold">ورود به استودیو</h1>
        <p className="text-sm text-white/60">
          ایمیل خود را وارد کنید؛ لینک ورود برایتان ارسال می‌شود.
        </p>
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg bg-surface2 px-4 py-3 text-left ltr:text-left outline-none focus:ring-2 focus:ring-accent2"
          dir="ltr"
        />
        <button
          type="submit"
          className="w-full touch-target rounded-lg bg-accent2 py-3 font-semibold text-black"
        >
          ارسال لینک ورود
        </button>
      </form>
    </main>
  );
}
