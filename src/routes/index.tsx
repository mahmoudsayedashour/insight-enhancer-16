import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Greko Egypt – YTD Sales Dashboard" },
      { name: "description", content: "Greko Egypt sales analytics dashboard with executive KPIs, SKU performance, customer, channel and year-over-year comparisons." },
      { property: "og:title", content: "Greko Egypt – YTD Sales Dashboard" },
      { property: "og:description", content: "Greko Egypt sales analytics dashboard with executive KPIs, SKU performance, customer, channel and year-over-year comparisons." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardRedirect,
});

function DashboardRedirect() {
  useEffect(() => {
    window.location.replace("/dashboard/index.html");
  }, []);
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#060e24", color: "#f0f4ff", fontFamily: "Inter, sans-serif" }}>
      Loading dashboard…
    </div>
  );
}
