import type { NextConfig } from "next";

/**
 * Static export for GitHub Pages.
 *
 * Project pages are served from https://<user>.github.io/<repo>/, so the build
 * needs a base path. CI sets NEXT_PUBLIC_BASE_PATH (e.g. "/universal-upload");
 * leave it empty for a user/organization page or a custom domain.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  basePath: basePath || undefined,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  // Emit /index.html-style paths, which every static host serves without rewrites.
  trailingSlash: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
