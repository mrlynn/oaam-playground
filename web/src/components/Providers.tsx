"use client";

import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { ReactNode } from "react";

const theme = createTheme({
  cssVariables: { colorSchemeSelector: "class" },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#0f766e" },
        background: { default: "#f6f7f9", paper: "#ffffff" },
      },
    },
    dark: {
      palette: {
        primary: { main: "#2dd4bf" },
        background: { default: "#0e1116", paper: "#161b22" },
      },
    },
  },
  typography: {
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
    h1: { fontSize: "1.5rem", fontWeight: 600 },
    h2: { fontSize: "1.125rem", fontWeight: 600 },
    overline: { fontWeight: 600, letterSpacing: "0.08em" },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiPaper: { defaultProps: { variant: "outlined" } },
    MuiChip: { defaultProps: { size: "small" } },
  },
});

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme} defaultMode="system">
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
