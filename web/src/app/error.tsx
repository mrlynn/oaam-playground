"use client";

import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Paper sx={{ p: 4 }}>
      <Typography variant="h1" gutterBottom>
        Could not read the memory store
      </Typography>
      <Typography variant="body2" color="text.secondary" component="div">
        Likely causes:
        <ul>
          <li>The database container isn&apos;t running: <code>docker compose -f infra/docker-compose.yml up -d</code></li>
          <li>The views don&apos;t exist yet: <code>cd agent &amp;&amp; uv run python scripts/apply_sql.py</code></li>
          <li><code>web/.env.local</code> is missing or has the wrong AIM_WEB password</li>
        </ul>
      </Typography>
      <Typography variant="caption" color="text.secondary" component="pre" sx={{ whiteSpace: "pre-wrap", mb: 2 }}>
        {error.message}
        {error.digest ? ` (digest ${error.digest})` : ""}
      </Typography>
      <Button variant="outlined" onClick={reset}>
        Try again
      </Button>
    </Paper>
  );
}
