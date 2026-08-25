"use client";

import { signIn } from "next-auth/react";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const honeypot = String(form.get("_master_hp") ?? "");

    const res = await signIn("credentials", {
      password,
      honeypot,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      if (res.error.startsWith("RATE_LIMIT:")) {
        const sec = res.error.split(":")[1];
        setError(`Trop de tentatives. Réessayez dans ${sec} secondes.`);
      } else {
        setError("Identifiants incorrects");
      }
      return;
    }

    window.location.href = "/";
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.08),_transparent_50%)]" />
      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-surface-border bg-surface-raised/90 p-8 shadow-2xl backdrop-blur-xl"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-400/80">
          Pixel Brain
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Master Panel</h1>

        {/* Honeypot — nom volontairement non standard pour éviter l'autofill Safari */}
        <input
          type="text"
          name="_master_hp"
          tabIndex={-1}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          className="absolute -left-[9999px] h-0 w-0 opacity-0 pointer-events-none"
          aria-hidden
        />

        <label className="mt-8 block text-sm text-zinc-400" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full rounded-xl border border-surface-border bg-surface px-4 py-3 text-white outline-none transition focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20"
        />

        {error && (
          <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400 ring-1 ring-red-500/20">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          className="mt-6 w-full rounded-xl bg-blue-600 py-3 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Vérification…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
