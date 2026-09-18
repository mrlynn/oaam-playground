import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";

import Providers from "@/components/Providers";
import StoreInfoChips from "@/components/StoreInfoChips";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Memory Inspector",
  description: "What an Oracle AI Agent Memory store remembers, and why.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="system" />
        <AppRouterCacheProvider>
          <Providers>
            <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
              <Toolbar sx={{ gap: 2, flexWrap: "wrap", py: { xs: 1, sm: 0 } }}>
                <Link href="/runs">
                  <Typography variant="subtitle1" component="span" sx={{ fontWeight: 700 }}>
                    Memory Inspector
                  </Typography>
                </Link>
                <Typography variant="body2" color="text.secondary" component="span" sx={{ display: { xs: "none", md: "inline" } }}>
                  Oracle AI Agent Memory
                </Typography>
                <Box component="nav" aria-label="Main" sx={{ display: "flex", gap: 2 }}>
                  <Link href="/runs">
                    <Typography variant="body2" component="span">Runs</Typography>
                  </Link>
                  <Link href="/memories">
                    <Typography variant="body2" component="span">Memory</Typography>
                  </Link>
                </Box>
                <Box sx={{ flexGrow: 1 }} />
                <Suspense fallback={null}>
                  <StoreInfoChips />
                </Suspense>
              </Toolbar>
            </AppBar>
            <Container component="main" maxWidth="xl" sx={{ py: 3, px: { xs: 2, sm: 3 } }}>
              {children}
            </Container>
          </Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
