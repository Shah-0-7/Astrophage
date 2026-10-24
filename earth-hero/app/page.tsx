import { EarthBlaze } from "@/components/ui/earth-blaze";
import { OutlineWordmark } from "@/components/ui/outline-wordmark";

export default function Home() {
  return (
    <main className="relative min-h-[560px] h-dvh bg-black text-zinc-100">
      <EarthBlaze
        className="!absolute inset-0"
        style={{ position: "absolute", inset: 0, height: "100%", aspectRatio: "auto" }}
      >
        <div className="relative flex h-full flex-col justify-between p-6 sm:p-10">
          <header className="pointer-events-auto flex items-center justify-between">
            <span className="text-sm font-semibold tracking-tight">Your Brand</span>
            <nav className="flex items-center gap-6 text-sm text-zinc-300">
              <a href="#about" className="transition-colors hover:text-white">About</a>
              <a href="#work" className="transition-colors hover:text-white">Work</a>
              <a href="#contact" className="transition-colors hover:text-white">Contact</a>
            </nav>
          </header>

          <div className="pointer-events-none absolute inset-0 grid place-items-center px-4">
            <OutlineWordmark
              text="ASTROPHAGE"
              style={{
                fontFamily: 'var(--font-display), "Arial Black", system-ui, sans-serif',
                fontWeight: 700,
                fontSize: "clamp(1.75rem, 8.2vw, 8rem)",
                letterSpacing: "0.01em",
              }}
            />
          </div>

          <footer className="pointer-events-auto relative flex flex-wrap items-center justify-between gap-4">
            <a
              href="#get-started"
              className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-zinc-200"
            >
              Get started
            </a>
            <a
              href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography/"
              target="_blank"
              rel="noreferrer"
              className="border-b border-zinc-600 py-2 text-xs text-zinc-300 transition-colors hover:text-white"
            >
              Earth imagery: NASA ↗
            </a>
          </footer>
        </div>
      </EarthBlaze>
    </main>
  );
}
