import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Link from "next/link";

export default function RunNotFound() {
  return (
    <Paper sx={{ p: 4 }}>
      <Typography variant="h1" gutterBottom>
        Thread not found
      </Typography>
      <Typography variant="body2" color="text.secondary">
        No thread with that id. It may have been deleted (thread deletes cascade to messages and memories).{" "}
        <Link href="/runs" style={{ textDecoration: "underline" }}>
          Back to runs
        </Link>
      </Typography>
    </Paper>
  );
}
