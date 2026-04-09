/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'logos.hunter.io',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
