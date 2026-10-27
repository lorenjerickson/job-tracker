import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / filesystem-heavy packages must stay out of the server bundle.
  serverExternalPackages: ["better-sqlite3", "pdfkit", "unpdf", "mammoth", "jszip"],
};

export default nextConfig;
