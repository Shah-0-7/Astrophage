import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/lib/ThemeProvider';

const description = 'Real-time global event monitoring: earthquakes, volcanoes, landslides, ice and tropical cyclones, with SAR/InSAR analysis for the NASA-ISRO NISAR mission.';

export const metadata: Metadata = {
  title: { default: 'Astrophage — Geospatial Telemetry Platform', template: '%s · Astrophage' },
  description,
  applicationName: 'Astrophage',
  openGraph: { title: 'Astrophage — Geospatial Telemetry Platform', description, siteName: 'Astrophage', type: 'website' },
  twitter: { card: 'summary_large_image', title: 'Astrophage — Geospatial Telemetry Platform', description },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning prevents mismatch from the inline script that
    // sets data-theme before React hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* ── Anti-flash: set data-theme BEFORE first paint ─── */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  try{
    var s=localStorage.getItem('nisar-theme');
    var t=s==='light'||s==='dark'?s:
      (window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
    document.documentElement.setAttribute('data-theme',t);
    var mc=document.querySelector('meta[name="theme-color"]');
    if(mc)mc.setAttribute('content',t==='light'?'#F8F7F4':'#09090b');
  }catch(e){}
})();`,
          }}
        />
        {/* theme-color meta (updated dynamically by ThemeProvider) */}
        <meta name="theme-color" content="#09090b" />
        {/* Google Fonts – Inter (sans) + Roboto Mono (telemetry) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600;700;800;900&family=Roboto+Mono:wght@300;400;500;600;700&family=Unbounded:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root { --font-display: 'Unbounded'; }
        `}</style>
        {/* Mapbox GL CSS */}
        <link href="https://api.mapbox.com/mapbox-gl-js/v3.2.0/mapbox-gl.css" rel="stylesheet" />
      </head>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
