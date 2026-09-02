/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "estaovendas.com.br" },
      { protocol: "https", hostname: "nexgestaovendas.com.br" },
    ],
  },
};

export default nextConfig;
