import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Smart Commute",
    short_name: "Commute",
    description: "Decision-first journey guidance for Singapore commuters.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f5f7",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }
    ]
  };
}
