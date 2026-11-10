const BASE_URL = "https://genbooks.uk";

export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/support"],
      disallow: ["/api/", "/books", "/login", "/register", "/forgot-password"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
