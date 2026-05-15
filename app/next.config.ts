import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      // Промежуточные «хабы» без своих страниц — редиректим на ближайший живой родитель,
      // чтобы клики по крошкам не уводили в 404
      { source: "/crm", destination: "/", permanent: false },
      { source: "/finance", destination: "/", permanent: false },
      { source: "/reports/crm", destination: "/reports", permanent: false },
      { source: "/reports/finance", destination: "/reports", permanent: false },
      { source: "/reports/churn", destination: "/reports", permanent: false },
      { source: "/reports/attendance", destination: "/reports", permanent: false },
      { source: "/reports/salary", destination: "/reports", permanent: false },
      { source: "/reports/schedule", destination: "/reports", permanent: false },
    ];
  },
};

export default nextConfig;
