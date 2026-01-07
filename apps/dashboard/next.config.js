/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing from workspace packages
  transpilePackages: ['@xray/shared-types'],
};

module.exports = nextConfig;


