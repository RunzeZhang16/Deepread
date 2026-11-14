/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 是原生模块，不要打包进 bundle
  serverExternalPackages: ['better-sqlite3'],
  // 部署到 Vercel 时，确保 data/ 被打进 serverless 包
  outputFileTracingIncludes: {
    '/api/**': ['./data/**'],
  },
};

export default nextConfig;
