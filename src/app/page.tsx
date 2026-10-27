import { EarthBlaze } from '@/components/ui/earth-blaze';
import { OutlineWordmark } from '@/components/ui/outline-wordmark';
import Link from 'next/link';

export default function HeroPage() {
  return (
    <main className="relative min-h-[560px] h-dvh bg-black text-zinc-100">
      <EarthBlaze
        className="!absolute inset-0"
        style={{ position: 'absolute', inset: 0, height: '100%', aspectRatio: 'auto' }}
        starCount={2200}
        illumination={1.1}
      >
        <div className="relative flex h-full flex-col justify-between p-6 sm:p-10">
          <header className="pointer-events-auto flex items-center" style={{ justifyContent: 'flex-end' }}>
            <nav className="flex items-center gap-6 text-sm text-zinc-400">
              <Link href="/app" className="transition-colors hover:text-white">Platform</Link>
              <Link href="/events" className="transition-colors hover:text-white">Events</Link>
              <a href="https://github.com/Shah-0-7/Astrophage" target="_blank" rel="noreferrer" className="transition-colors hover:text-white">GitHub ↗</a>
            </nav>
          </header>

          <div className="pointer-events-none absolute inset-0 grid place-items-center px-4">
            <div className="flex flex-col items-center">
              <OutlineWordmark
                text="ASTROPHAGE"
                style={{
                  fontFamily: 'var(--font-display, "Arial Black", system-ui, sans-serif)',
                  fontWeight: 700,
                  fontSize: 'clamp(1.75rem, 7.6vw, 7.5rem)',
                  letterSpacing: '0.04em',
                }}
              />
            </div>
          </div>

          <footer className="pointer-events-auto relative flex items-center" style={{ justifyContent: 'center', paddingBottom: 8 }}>
            <Link href="/app" className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black transition-all hover:bg-zinc-200 hover:scale-105 active:scale-95">
              Launch Platform →
            </Link>
          </footer>
        </div>
      </EarthBlaze>
    </main>
  );
}
