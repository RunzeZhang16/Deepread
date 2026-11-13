/** @type {import('next').NextConfig} */
const nextConfig = {
  // 部署到 Vercel 时，确保 data/ 被打进 serverless 包
  outputFileTracingIncludes: {
    '/api/**': ['./data/**'],
  },
};

export default nextConfig;
