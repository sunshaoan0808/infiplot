import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dada/engine", "@dada/ai-client", "@dada/types"],
  serverExternalPackages: ["sharp"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default config;
