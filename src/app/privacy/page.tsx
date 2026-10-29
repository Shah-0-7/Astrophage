import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Astrophage stores when you sign in with Google to get email alerts, and how to delete it.',
};

const h2 = 'mt-10 mb-3 font-mono text-[11px] tracking-[0.2em] uppercase text-white/50';
const p = 'text-[15px] leading-7 text-white/75';

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-black text-white">
      <article className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/app" className="font-mono text-[11px] tracking-[0.2em] text-white/50 hover:text-white">← ASTROPHAGE</Link>
        <h1 className="mt-6 text-4xl font-bold">Privacy</h1>
        <p className={`${p} mt-4`}>
          Astrophage works without an account. Signing in is optional and only exists so we can email you when
          something matches a watchlist rule while the app is closed.
        </p>

        <h2 className={h2}>What we store if you sign in</h2>
        <ul className={`${p} list-disc pl-5 space-y-1`}>
          <li>Your Google account&apos;s email address, display name and profile picture URL.</li>
          <li>The watchlist rules you create (event types, regions, thresholds, places you follow).</li>
          <li>Whether email alerts are switched on.</li>
          <li>A log of which events we have already emailed you about, so you are not emailed twice. Entries are removed after a few days.</li>
        </ul>
        <p className={`${p} mt-3`}>
          We ask Google only for the <em>openid</em>, <em>email</em> and <em>profile</em> scopes. We do not read your
          mail, contacts, calendar or any other Google data, and we do not keep Google access tokens.
        </p>

        <h2 className={h2}>How it is used</h2>
        <p className={p}>
          A scheduled job checks public earthquake, volcano, storm and hazard feeds every few minutes, compares them with
          your rules, and sends you an email through our email provider when there is something new. Your email address is
          shared with that provider only to deliver those messages. We do not sell your data, show ads, or use it for anything else.
        </p>

        <h2 className={h2}>Cookies and browser storage</h2>
        <p className={p}>
          Signing in sets one signed, HTTP-only session cookie. Your rules, last-read alerts and theme are also kept in this
          browser&apos;s local storage, which never leaves your device unless you are signed in, in which case the rules are saved to your account.
        </p>

        <h2 className={h2}>Control and deletion</h2>
        <p className={p}>
          Open the alerts panel to switch email alerts off, sign out, or choose <b>Delete my account &amp; data</b>, which removes
          your profile, rules and email log immediately. Every alert email also has an unsubscribe link, and the same
          control is in the email header of mail clients that support one-click unsubscribe.
        </p>
      </article>
    </main>
  );
}
