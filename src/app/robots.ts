import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  // The product is not open yet. Revisit indexing as part of the launch review.
  return { rules: { userAgent: "*", disallow: "/" } };
}
