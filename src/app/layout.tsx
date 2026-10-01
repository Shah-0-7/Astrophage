import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NISAR SAR/InSAR Geospatial Telemetry Platform',
  description: 'Aerospace tactical platform for SAR/InSAR geospatial telemetry, phase processing, and 3D morphometric analysis using NASA-ISRO NISAR mission data.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Google Fonts – Inter (sans) + Roboto Mono (telemetry) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Roboto+Mono:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Mapbox GL CSS */}
        <link href="https://api.mapbox.com/mapbox-gl-js/v3.2.0/mapbox-gl.css" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
